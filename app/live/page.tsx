import type { Metadata } from "next";
import { ensureFresh, getFreshness } from "@/lib/services/sync";
import { listTraders, listTrades } from "@/lib/services/intelligence";
import { explorerBase } from "@/lib/explorer";
import { PageHeader } from "@/components/common/section-header";
import { LiveIndicator } from "@/components/shell/live-indicator";
import { LivePage } from "@/components/live/live-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Live Trades" };

export default async function LiveTradesPage() {
  await ensureFresh("trades", 8_000);
  const [trades, traders, freshness] = await Promise.all([listTrades({ limit: 60 }), listTraders({ period: "all", limit: 200 }), getFreshness()]);
  return (
    <div>
      <PageHeader title="Every move, in view." description="Follow buys and sells from tracked wallets on Robinhood Chain as they arrive.">
        <LiveIndicator initial={freshness} size="md" showTracked />
      </PageHeader>
      <LivePage initialTrades={trades} initialTraders={traders} explorerBase={explorerBase()} />
    </div>
  );
}
