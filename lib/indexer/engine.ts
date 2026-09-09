import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { decodeEventLog, zeroAddress, type Address, type Hex } from "viem";
import { getDb, schema } from "@/lib/db";
import { CHAIN_ID, v2Config } from "@/lib/v2/config";
import { logEvent } from "@/lib/v2/log";
import { canonicalEventId, parseSwap, parseTransfer, ponsV1FactoryAbi, v2FactoryAbi, v3FactoryAbi, type RawLog } from "./events";
import { ponsV2FactoryAbi } from "./contracts";
import { chainClient, decimalAmount, tokenMetadata, verifyPool, type ChainClient } from "./rpc";
import { CURSOR, initializeCursor, persistBlocks, type IndexedBlock, readCursor, recentCanonicalBlocks, rewindTo } from "./store";

export class ChainIndexer {
  private owner = randomUUID();
  private running = false;
  constructor(readonly client: ChainClient = chainClient(), readonly config = v2Config()) {}

  async initialize() {
    if (await this.client.getChainId() !== CHAIN_ID) throw new Error("RPC returned the wrong chain");
    if (this.config.INDEXER_START_BLOCK == null) throw new Error("INDEXER_START_BLOCK is required; history coverage must be explicit");
    const cursor = await readCursor();
    if (!cursor) {
      const start = this.config.INDEXER_START_BLOCK;
      const previous = start > 0 ? await this.client.getBlock({ blockNumber: BigInt(start - 1) }) : null;
      await initializeCursor(start, previous?.hash ?? null);
    }
    for (const pool of this.config.pools) {
      let verified = false;
      for (const kind of ["uniswap-v3", "uniswap-v2", "pons-curve"] as const) {
        try { await verifyPool(this.client, pool, kind); verified = true; break; } catch { /* Try the other explicitly supported contract interfaces. */ }
      }
      if (!verified) throw new Error(`Configured pool failed factory verification: ${pool}`);
    }
  }

  private async lease() {
    const db = await getDb();
    const rows = await db.insert(schema.appMeta).values({ key: "lock:chain-indexer", value: { owner: this.owner } })
      .onConflictDoUpdate({ target: schema.appMeta.key, set: { value: { owner: this.owner }, updatedAt: new Date() }, setWhere: sql`${schema.appMeta.updatedAt} < now() - interval '5 minutes' or ${schema.appMeta.value}->>'owner' = ${this.owner}` }).returning({ key: schema.appMeta.key });
    return rows.length > 0;
  }

  async release() {
    const db = await getDb();
    await db.delete(schema.appMeta).where(and(eq(schema.appMeta.key, "lock:chain-indexer"), sql`${schema.appMeta.value}->>'owner' = ${this.owner}`));
  }

  private async reconcile() {
    const cursor = await readCursor();
    if (!cursor || cursor.blockNumber < 0 || !cursor.blockHash) return;
    const current = await this.client.getBlock({ blockNumber: BigInt(cursor.blockNumber) });
    if (current.hash === cursor.blockHash) return;
    const known = await recentCanonicalBlocks();
    for (const saved of known) {
      const actual = await this.client.getBlock({ blockNumber: BigInt(saved.number) });
      if (actual.hash === saved.hash) {
        await rewindTo(saved.number, saved.hash);
        logEvent("INDEXER", "reorg_recovered", { from: cursor.blockNumber, to: saved.number });
        return;
      }
    }
    if (cursor.blockNumber - cursor.startBlock < 128 && cursor.startBlock > 0) {
      const anchor = await this.client.getBlock({ blockNumber: BigInt(cursor.startBlock - 1) });
      await rewindTo(cursor.startBlock - 1, anchor.hash!);
      return;
    }
    throw new Error("Deep reorg: manual checkpoint recovery required; cursor was not advanced");
  }

  private async logs(blockNumber: bigint, addresses: string[], toBlock = blockNumber): Promise<RawLog[]> {
    const out: RawLog[] = [];
    const unique = [...new Set(addresses.map(a => a.toLowerCase()))];
    // Bound each request to ten blocks, including both endpoints.
    if (toBlock < blockNumber || toBlock - blockNumber >= BigInt(10)) throw new Error("Invalid log range");
    for (let i = 0; i < unique.length; i += 100) {
      const logs = await this.client.getLogs({ address: unique.slice(i, i + 100) as Address[], fromBlock: blockNumber, toBlock });
      for (const log of logs) {
        if (log.removed || log.blockHash == null || log.blockNumber == null || log.logIndex == null || log.transactionHash == null) throw new Error("Incomplete confirmed log response");
        out.push({ address: log.address.toLowerCase(), topics: log.topics, data: log.data, logIndex: log.logIndex, transactionHash: log.transactionHash, blockHash: log.blockHash, blockNumber: log.blockNumber });
      }
    }
    return out;
  }

  private async discover(logs: RawLog[]) {
    const addresses: string[] = [];
    for (const log of logs) {
      if (log.address === this.config.PONS_V1_FACTORY_ADDRESS) {
        let launch;
        try { launch = decodeEventLog({ abi: ponsV1FactoryAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true }); } catch { continue; }
        if (launch.args.dexFactory.toLowerCase() !== this.config.UNISWAP_FACTORY_ADDRESS) continue;
        const pool = await verifyPool(this.client, launch.args.pool.toLowerCase() as Address, 'uniswap-v3');
        const db = await getDb(), block = await this.client.getBlock({ blockNumber: log.blockNumber });
        await db.update(schema.tokenProfiles).set({ deployerAddress: launch.args.deployer.toLowerCase(), launchPlatform: 'Pons V1', dexPairAddress: pool.address, createdAtChain: new Date(Number(block.timestamp) * 1000) }).where(eq(schema.tokenProfiles.address, launch.args.token.toLowerCase()));
        addresses.push(pool.address, pool.token0, pool.token1);
      } else if (log.address === this.config.PONS_FACTORY_ADDRESS) {
        let launch;
        try { launch = decodeEventLog({ abi: ponsV2FactoryAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true }); } catch { continue; }
        const pool = await verifyPool(this.client, launch.args.curve.toLowerCase() as Address, "pons-curve");
        const db = await getDb();
        const block = await this.client.getBlock({ blockNumber: log.blockNumber });
        await db.update(schema.tokenProfiles).set({ deployerAddress: launch.args.deployer.toLowerCase(), launchPlatform: "Pons V2", dexPairAddress: pool.address, createdAtChain: new Date(Number(block.timestamp) * 1000) }).where(eq(schema.tokenProfiles.address, launch.args.token.toLowerCase()));
        addresses.push(pool.address, pool.token0);
      } else if (log.address === this.config.UNISWAP_FACTORY_ADDRESS) {
        let poolAddress: Address | undefined, kind: "uniswap-v2" | "uniswap-v3" = "uniswap-v3";
        try { poolAddress = decodeEventLog({ abi: v3FactoryAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true }).args.pool; }
        catch { try { poolAddress = decodeEventLog({ abi: v2FactoryAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true }).args.pair; kind = "uniswap-v2"; } catch { continue; } }
        const pool = await verifyPool(this.client, poolAddress!.toLowerCase() as Address, kind);
        addresses.push(pool.address, pool.token0, pool.token1);
      }
    }
    return addresses;
  }

  async tick() {
    if (this.running) return { blocks: 0, swaps: 0 };
    this.running = true;
    try {
      if (!await this.lease()) return { blocks: 0, swaps: 0 };
      await this.reconcile();
      const cursor = await readCursor();
      if (!cursor) throw new Error("Indexer is not initialized");
      const head = Number(await this.client.getBlockNumber({ cacheTime: 0 }));
      const last = Math.min(head - this.config.INDEXER_CONFIRMATIONS, cursor.blockNumber + this.config.INDEXER_BATCH_BLOCKS);
      const db = await getDb();
      let blocks = 0, swapsCount = 0;
      const metadata = new Map<string, Awaited<ReturnType<typeof tokenMetadata>>>();
      const resolveToken = async (address: string) => {
        const known = metadata.get(address);
        if (known) return known;
        const value = await tokenMetadata(this.client, address as Address);
        metadata.set(address, value);
        return value;
      };
      for (let start = cursor.blockNumber + 1; start <= last; start += 10) {
        if (!await this.lease()) throw new Error("Indexer lease lost");
        const end = Math.min(start + 9, last);
        const [pools, tokens] = await Promise.all([
          db.select().from(schema.liquidityPools).where(eq(schema.liquidityPools.active, true)),
          db.select({ address: schema.tokenProfiles.address }).from(schema.tokenProfiles).where(eq(schema.tokenProfiles.active, true)),
        ]);
        const addresses = [...pools.map(p => p.address), ...tokens.map(t => t.address), ...[this.config.PONS_V1_FACTORY_ADDRESS, this.config.PONS_FACTORY_ADDRESS, this.config.UNISWAP_FACTORY_ADDRESS].filter((v): v is Address => Boolean(v))];
        if (!addresses.length) throw new Error("No verified contracts configured for indexing");
        const [headers, rangeLogs] = await Promise.all([
          Promise.all(Array.from({ length: end - start + 1 }, (_, i) => this.client.getBlock({ blockNumber: BigInt(start + i) }))),
          this.logs(BigInt(start), addresses, BigInt(end)),
        ]);
        const discovered = await this.discover(rangeLogs);
        if (discovered.length) rangeLogs.push(...await this.logs(BigInt(start), discovered.filter(a => !addresses.includes(a)), BigInt(end)));
        const allPools = discovered.length ? await db.select().from(schema.liquidityPools).where(eq(schema.liquidityPools.active, true)) : pools;
        const byPool = new Map(allPools.map(p => [p.address, p]));
        const pending: IndexedBlock[] = [];
        for (const block of headers) {
        const n = Number(block.number);
        if (!block.hash) throw new Error("Unconfirmed block");
        const logs = rangeLogs.filter(log => Number(log.blockNumber) === n);
        const uniqueLogs = [...new Map(logs.map(l => [canonicalEventId(l), l])).values()].sort((a, b) => a.logIndex - b.logIndex);
        const timestamp = new Date(Number(block.timestamp) * 1000);
        const swaps: (typeof schema.chainSwaps.$inferInsert)[] = [], transfers: (typeof schema.chainTransfers.$inferInsert)[] = [];
        const actors = new Map<string, string>();
        const prices = new Map<string, number | null>();
        for (const log of uniqueLogs) {
          const identity = { id: canonicalEventId(log), chainId: CHAIN_ID, txHash: log.transactionHash, logIndex: log.logIndex, blockNumber: n, blockHash: block.hash, timestamp };
          const transfer = parseTransfer(log);
          if (transfer) transfers.push({ ...identity, tokenAddress: log.address, ...transfer });
          const pool = byPool.get(log.address);
          if (!pool) continue;
          const swap = parseSwap(log, pool, [...this.config.usdQuotes, this.config.WRAPPED_NATIVE_ADDRESS ?? zeroAddress]);
          if (!swap) continue;
          const [token, quote] = await Promise.all([resolveToken(swap.tokenAddress), resolveToken(swap.quoteAddress)]);
          let wallet = swap.wallet ?? actors.get(log.transactionHash);
          if (!wallet) { wallet = (await this.client.getTransaction({ hash: log.transactionHash })).from.toLowerCase(); actors.set(log.transactionHash, wallet); }
          let attribution = swap.wallet ? swap.recipient === swap.wallet ? 'curve event participant' : 'payer differs from recipient' : 'unverified swap attribution';
          if (!swap.wallet) {
            // Pool events describe pool accounting, not necessarily the sender's holdings.
            // Attribute only a matching net token transfer from the full receipt.
            const receipt = await this.client.getTransactionReceipt({ hash: log.transactionHash });
            let delta = BigInt(0);
            for (const item of receipt.logs) if (item.address.toLowerCase() === swap.tokenAddress && item.logIndex != null) {
              const transfer = parseTransfer({ ...item, topics: [...item.topics], logIndex: item.logIndex, transactionHash: log.transactionHash, blockHash: log.blockHash, blockNumber: log.blockNumber });
              if (transfer) { if (transfer.to === wallet) delta += BigInt(transfer.amountRaw); if (transfer.from === wallet) delta -= BigInt(transfer.amountRaw); }
            }
            const expected = swap.side === 'BUY' ? swap.amountTokenRaw : -swap.amountTokenRaw;
            if (delta === expected) attribution = 'receipt-confirmed wallet delta';
          }
          const pricingAddress = swap.quoteAddress === zeroAddress ? this.config.WRAPPED_NATIVE_ADDRESS : swap.quoteAddress;
          if (pricingAddress && !prices.has(pricingAddress)) {
            const [observation] = await db.select({ priceUsd: schema.marketObservations.priceUsd }).from(schema.marketObservations).where(and(eq(schema.marketObservations.tokenAddress, pricingAddress), lte(schema.marketObservations.timestamp, timestamp), gte(schema.marketObservations.timestamp, new Date(timestamp.getTime() - 300_000)))).orderBy(desc(schema.marketObservations.timestamp)).limit(1);
            prices.set(pricingAddress, observation?.priceUsd ?? null);
          }
          const quotePrice = pricingAddress ? prices.get(pricingAddress) : null;
          const amountToken = decimalAmount(swap.amountTokenRaw, token.decimals), amountQuote = decimalAmount(swap.amountQuoteRaw, quote.decimals);
          const usd = quotePrice != null ? Number(amountQuote) * quotePrice : null;
          const usdValue = usd != null && Number.isFinite(usd) && usd >= 0 ? usd : null;
          swaps.push({ ...identity, walletAddress: wallet, tokenAddress: swap.tokenAddress, quoteAddress: swap.quoteAddress, side: swap.side, amountToken, amountQuote, usdValue, executionPrice: usdValue != null && Number(amountToken) > 0 ? usdValue / Number(amountToken) : null, dex: pool.dex, poolAddress: pool.address, attribution });
        }
        pending.push({ number: n, hash: block.hash, parentHash: block.parentHash, timestamp, logs: uniqueLogs, swaps, transfers });
      }
        // The final hash commits to its ancestry; persistence checks every parent link.
        if ((await this.client.getBlock({ blockNumber: BigInt(end) })).hash !== headers.at(-1)?.hash) throw new Error("Reorg during batch processing");
        if (!await this.lease()) throw new Error("Indexer lease lost");
        if (await persistBlocks(pending)) { blocks += pending.length; swapsCount += pending.reduce((total, block) => total + block.swaps.length, 0); }
      }
      await db.update(schema.chainCursors).set({ updatedAt: new Date(), status: last >= head - this.config.INDEXER_CONFIRMATIONS ? "live" : "catching_up", details: { head, lagBlocks: Math.max(0, head - last), swaps: swapsCount } }).where(eq(schema.chainCursors.name, CURSOR));
      logEvent("INDEXER", "batch", { blocks, swaps: swapsCount, head, confirmed: last });
      return { blocks, swaps: swapsCount };
    } finally { this.running = false; }
  }
}
