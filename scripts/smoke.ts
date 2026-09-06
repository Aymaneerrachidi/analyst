/**
 * Boots the database, runs a full sync with the configured provider, seeds mock social
 * content, and prints a summary. Run with:
 *   npx tsx --conditions=react-server scripts/smoke.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { getDb, dbDriver } = await import("@/lib/db");
  const { runSync, getFreshness } = await import("@/lib/services/sync");
  const { seedSocialIfEmpty } = await import("@/lib/db/seed-social");
  const { listTrades, listTraders, listTokens, search, getOverviewStats } = await import("@/lib/services/intelligence");
  const { listPosts } = await import("@/lib/social/posts");

  await getDb();
  console.log("db driver:", dbDriver());
  const t0 = Date.now();
  const result = await runSync("full");
  console.log("sync:", result);
  await seedSocialIfEmpty();
  console.log("seed ok in", Date.now() - t0, "ms");

  const [freshness, stats, trades, traders, tokens, found, posts] = await Promise.all([
    getFreshness(),
    getOverviewStats(),
    listTrades({ limit: 5 }),
    listTraders({ period: "30d", limit: 5 }),
    listTokens({ window: "24h", limit: 5 }),
    search("pon"),
    listPosts({ guestId: null, limit: 3, sort: "top" }),
  ]);
  console.log("freshness:", freshness);
  console.log("stats:", stats);
  console.log("trades:", trades.map((t) => `${t.trader.name} ${t.side} ${t.token.symbol} $${t.amountUsd?.toFixed(0)} pnl=${t.realizedPnl?.toFixed(0) ?? "-"}`));
  console.log("traders:", traders.map((t) => `#${t.rank} ${t.name} pnl=${t.realizedPnl?.toFixed(0)} wr=${t.winRate?.toFixed(0)} rating=${t.communityRating?.toFixed(1)} top=${t.topToken?.symbol}`));
  console.log("tokens:", tokens.map((t) => `${t.symbol} score=${t.score.score} net=${t.netAccumulation.toFixed(0)} buyers=${t.buyers} sellers=${t.sellers} top=${t.topBuyer?.name}`));
  console.log("search:", found.tokens.map((t) => t.symbol), found.traders.map((t) => t.name));
  console.log("posts:", posts.map((p) => `${p.author.displayName}: ${p.body} [${p.refs.map((r) => r.href).join(", ")}]`));

  const t1 = Date.now();
  const inc = await runSync("trades");
  console.log("incremental sync:", inc, "in", Date.now() - t1, "ms");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
