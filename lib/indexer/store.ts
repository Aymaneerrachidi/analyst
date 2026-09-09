import "server-only";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { CHAIN_ID, INDEXER_VERSION } from "@/lib/v2/config";
import { rawEventId, type RawLog } from "./events";

export type IndexedBlock = { number: number; hash: string; parentHash: string; timestamp: Date; logs: RawLog[]; swaps: (typeof schema.chainSwaps.$inferInsert)[]; transfers: (typeof schema.chainTransfers.$inferInsert)[] };
export const CURSOR = "robinhood-confirmed";
export async function readCursor() {
  const db = await getDb();
  const [row] = await db.select().from(schema.chainCursors).where(eq(schema.chainCursors.name, CURSOR));
  return row ?? null;
}

export async function initializeCursor(startBlock: number, precedingHash: string | null) {
  const db = await getDb();
  await db.insert(schema.chainCursors).values({ name: CURSOR, chainId: CHAIN_ID, startBlock, blockNumber: startBlock - 1, blockHash: precedingHash }).onConflictDoNothing();
  return readCursor();
}

/** The cursor, canonical block and decoded events commit together or not at all. */
export async function persistBlock(block: IndexedBlock) {
  return persistBlocks([block]);
}

/** Commit a bounded contiguous batch under one cursor lock. */
export async function persistBlocks(blocks: IndexedBlock[]) {
  const db = await getDb();
  return db.transaction(async tx => {
    const [saved] = await tx.select().from(schema.chainCursors).where(eq(schema.chainCursors.name, CURSOR)).for("update");
    if (!saved) throw new Error("Indexer cursor is not initialized");
    const cursor = { ...saved };
    let changed = false;
    for (const block of blocks) {
    if (cursor.blockNumber >= block.number) {
      if (cursor.blockNumber === block.number && cursor.blockHash !== block.hash) throw new Error("Reorg must be reconciled before persistence");
      continue;
    }
    if (block.number !== cursor.blockNumber + 1 || (cursor.blockHash && block.parentHash !== cursor.blockHash)) throw new Error("Non-contiguous block: recovery required");
    await tx.insert(schema.chainBlocks).values({ id: `${CHAIN_ID}:${block.hash}`, chainId: CHAIN_ID, number: block.number, hash: block.hash, parentHash: block.parentHash, timestamp: block.timestamp, canonical: true })
      .onConflictDoUpdate({ target: schema.chainBlocks.id, set: { canonical: true } });
    for (let i = 0; i < block.logs.length; i += 100) {
      const logs = block.logs.slice(i, i + 100);
      if (logs.some(l => Number(l.blockNumber) !== block.number || l.blockHash !== block.hash)) throw new Error("Log block identity mismatch");
      await tx.insert(schema.rawChainEvents).values(logs.map(l => ({ id: rawEventId(l), chainId: CHAIN_ID, blockNumber: block.number, blockHash: block.hash, txHash: l.transactionHash, logIndex: l.logIndex, contract: l.address.toLowerCase(), topics: l.topics, rawData: l.data, timestamp: block.timestamp, ingestionVersion: INDEXER_VERSION }))).onConflictDoNothing();
    }
    for (let i = 0; i < block.swaps.length; i += 100) await tx.insert(schema.chainSwaps).values(block.swaps.slice(i, i + 100)).onConflictDoNothing();
    const activeTokens = [...new Set(block.swaps.map(s => s.tokenAddress))];
    if (activeTokens.length) await tx.update(schema.tokens).set({ lastActivityAt: sql`greatest(${schema.tokens.lastActivityAt}, ${block.timestamp.toISOString()}::timestamptz)` }).where(inArray(schema.tokens.address, activeTokens));
    for (let i = 0; i < block.transfers.length; i += 100) await tx.insert(schema.chainTransfers).values(block.transfers.slice(i, i + 100)).onConflictDoNothing();
    const addresses = [...new Set(block.swaps.map(s => s.walletAddress))];
    if (addresses.length) await tx.insert(schema.wallets).values(addresses.map(address => ({ address, firstSeen: block.timestamp, lastSeen: block.timestamp }))).onConflictDoUpdate({ target: schema.wallets.address, set: { lastSeen: sql`greatest(${schema.wallets.lastSeen}, excluded.last_seen)` } });
    await tx.update(schema.chainCursors).set({ blockNumber: block.number, blockHash: block.hash, status: "indexing", updatedAt: new Date() }).where(eq(schema.chainCursors.name, CURSOR));
    cursor.blockNumber = block.number; cursor.blockHash = block.hash; changed = true;
    }
    return changed;
  });
}

/** Reorgs invalidate derived rows but preserve every raw observation and original signal input. */
export async function rewindTo(number: number, hash: string) {
  const db = await getDb();
  return db.transaction(async tx => {
    const [cursor] = await tx.select().from(schema.chainCursors).where(eq(schema.chainCursors.name, CURSOR)).for("update");
    if (!cursor || number < cursor.startBlock - 1 || number > cursor.blockNumber) throw new Error("Reorg exceeds indexed coverage");
    const orphanSwaps = await tx.select({ wallet: schema.chainSwaps.walletAddress }).from(schema.chainSwaps).where(and(eq(schema.chainSwaps.chainId, CHAIN_ID), gt(schema.chainSwaps.blockNumber, number)));
    const affected = [...new Set(orphanSwaps.map(s => s.wallet))];
    await tx.update(schema.chainBlocks).set({ canonical: false }).where(and(eq(schema.chainBlocks.chainId, CHAIN_ID), gt(schema.chainBlocks.number, number)));
    await tx.delete(schema.chainSwaps).where(and(eq(schema.chainSwaps.chainId, CHAIN_ID), gt(schema.chainSwaps.blockNumber, number)));
    await tx.delete(schema.chainTransfers).where(and(eq(schema.chainTransfers.chainId, CHAIN_ID), gt(schema.chainTransfers.blockNumber, number)));
    if (affected.length) {
      await tx.delete(schema.walletMetrics).where(inArray(schema.walletMetrics.walletAddress, affected));
      await tx.delete(schema.walletTokenPositions).where(inArray(schema.walletTokenPositions.wallet, affected));
    }
    // Relationship evidence and risk will be recomputed from canonical transfers.
    await tx.delete(schema.walletEdges);
    await tx.delete(schema.riskAssessments);
    await tx.delete(schema.appMeta).where(sql`${schema.appMeta.key} like 'shared:risk:%' or ${schema.appMeta.key} like 'shared:detective:%'`);
    const [anchor] = await tx.select({ timestamp: schema.chainBlocks.timestamp }).from(schema.chainBlocks).where(and(eq(schema.chainBlocks.number, number), eq(schema.chainBlocks.hash, hash))).limit(1);
    if (anchor) await tx.update(schema.tokenProfiles).set({ createdAtChain: null, deployerAddress: null }).where(gt(schema.tokenProfiles.createdAtChain, anchor.timestamp));
    await tx.update(schema.userPositions).set({ currentAmount: null, updatedAt: new Date(), thesis: sql`jsonb_set(${schema.userPositions.thesis}, '{receiptNeedsRecheck}', 'true'::jsonb)` }).where(gt(schema.userPositions.receiptBlock, number));
    await tx.update(schema.chainCursors).set({ blockNumber: number, blockHash: hash, status: "recovering", updatedAt: new Date(), details: { reorgAt: new Date().toISOString(), rewindFrom: cursor.blockNumber } }).where(eq(schema.chainCursors.name, CURSOR));
  });
}

export async function recentCanonicalBlocks(limit = 128) {
  const db = await getDb();
  return db.select().from(schema.chainBlocks).where(and(eq(schema.chainBlocks.chainId, CHAIN_ID), eq(schema.chainBlocks.canonical, true))).orderBy(desc(schema.chainBlocks.number)).limit(limit);
}
