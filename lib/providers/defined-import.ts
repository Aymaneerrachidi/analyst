import { z } from "zod";
import type { UpstreamTrade } from "./types";

const address = z.string().regex(/^0x[\da-f]{40}$/i).transform((s) => s.toLowerCase());
const hash = z.string().regex(/^0x[\da-f]{64}$/i).transform((s) => s.toLowerCase());
const walletSchema = z.object({
  address, networkId: z.literal(4663), lastTransactionAt: z.number().nullable().optional(),
  wallet: z.object({ displayName: z.string().nullable(), avatarUrl: z.string().nullable(), twitterUsername: z.string().nullable() }),
}).passthrough();
const tokenSchema = z.object({ address, networkId: z.literal(4663), symbol: z.string().min(1), name: z.string(),
  info: z.object({ imageThumbUrl: z.string().nullable().optional(), imageLargeUrl: z.string().nullable().optional() }).nullable().optional(),
});
const eventSchema = z.object({ networkId: z.literal(4663), maker: address, transactionHash: hash,
  logIndex: z.number().int().nonnegative(), timestamp: z.number().int().positive(),
  eventDisplayType: z.enum(["Buy", "Sell"]), quoteToken: z.enum(["token0", "token1"]),
  token0Address: address, token1Address: address,
  data: z.object({ amountNonLiquidityToken: z.string(), priceUsd: z.string(), priceUsdTotal: z.string() }),
});
export function sourceNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || (typeof value !== "number" && typeof value !== "string")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
const sourceImage = (value?: string | null) => {
  if (!value) return undefined;
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.port && ["pbs.twimg.com", "token-media.defined.fi", "euc.li"].includes(u.hostname) ? u.href : undefined; } catch { return undefined; }
};

/** Only public Robinhood records are accepted. Quotes refer to the token of
 * interest (Codex terminology), not necessarily the pair's liquidity token.
 * https://docs.codex.io/api-reference/queries/gettokenevents */
export function normalizeDefinedImport(walletInput: unknown, historyInput: unknown) {
  const envelope = z.object({ capturedAt: z.iso.datetime(), networkId: z.literal(4663), rows: z.array(walletSchema) }).parse(walletInput);
  const wallets = [...new Map(envelope.rows.map((w) => [w.address, w])).values()];
  const allowed = new Set(wallets.map((w) => w.address));
  const history = z.array(z.object({ wallet: address, records: z.array(z.object({ operation: z.string(), data: z.record(z.string(), z.unknown()).optional() })) })).parse(historyInput);
  const tokens = new Map<string, { address: string; symbol: string; name: string; image?: string }>();
  const events = new Map<string, z.infer<typeof eventSchema>>();
  for (const page of history) {
    if (!allowed.has(page.wallet)) continue;
    for (const record of page.records) {
      const data = record.data;
      if (!data) continue;
      const candidates: unknown[] = [];
      if (Array.isArray(data.tokens)) candidates.push(...data.tokens);
      const stats = data.filterTokenWallets as { results?: { token?: unknown }[] } | undefined;
      if (Array.isArray(stats?.results)) candidates.push(...stats.results.map((s) => s.token));
      for (const candidate of candidates) {
        const parsed = tokenSchema.safeParse(candidate);
        if (!parsed.success) continue;
        const t = parsed.data;
        tokens.set(t.address, { address: t.address, symbol: t.symbol, name: t.name, image: sourceImage(t.info?.imageThumbUrl ?? t.info?.imageLargeUrl) });
      }
      const activity = data.getTokenEventsForMaker as { items?: unknown[] } | undefined;
      for (const raw of activity?.items ?? []) {
        const parsed = eventSchema.safeParse(raw);
        if (!parsed.success || parsed.data.maker !== page.wallet) continue;
        const e = parsed.data;
        events.set(`${e.transactionHash}:${e.logIndex}`, e);
      }
    }
  }
  // Aggregate distinct swap logs within a transaction before cross-source dedup.
  const trades = new Map<string, UpstreamTrade>();
  let skipped = 0;
  for (const e of events.values()) {
    const tokenAddress = e.quoteToken === "token0" ? e.token0Address : e.token1Address;
    const token = tokens.get(tokenAddress);
    const amountUsd = sourceNumber(e.data.priceUsdTotal);
    const tokenAmount = sourceNumber(e.data.amountNonLiquidityToken);
    const price = sourceNumber(e.data.priceUsd);
    if (!token || amountUsd === null || amountUsd < 0 || tokenAmount === null || tokenAmount <= 0 || price === null || price < 0 || Math.abs(tokenAmount * price - amountUsd) > Math.max(0.02, amountUsd * 0.01)) { skipped++; continue; }
    const side = e.eventDisplayType === "Buy" ? "BUY" : "SELL";
    const id = `defined:${e.transactionHash}:${e.maker}:${tokenAddress}:${side}`;
    const previous = trades.get(id);
    const usd = amountUsd + (previous?.amountUsd ?? 0);
    const quantity = tokenAmount + (previous?.tokenAmount ?? 0);
    trades.set(id, { id, txHash: e.transactionHash, wallet: e.maker, side, tokenAddress,
      tokenSymbol: token.symbol, tokenName: token.name, amountUsd: usd, tokenAmount: quantity,
      price: usd / quantity, timestamp: new Date(e.timestamp * 1000).toISOString(), dex: "Defined / Codex" });
  }
  return { capturedAt: envelope.capturedAt, wallets, tokens: [...tokens.values()], trades: [...trades.values()], skipped,
    traders: wallets.map((w) => ({ wallet: w.address, name: w.wallet.displayName || w.address,
      handle: w.wallet.twitterUsername || undefined, avatar: sourceImage(w.wallet.avatarUrl),
      twitterUrl: w.wallet.twitterUsername ? `https://x.com/${encodeURIComponent(w.wallet.twitterUsername)}` : undefined })) };
}
