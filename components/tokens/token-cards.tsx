import Link from "next/link";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import { formatUsdSigned } from "@/lib/format";
import type { AnalystToken } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TokenAvatar } from "@/components/common/avatar";

export function TokenMiniCard({ token }: { token: AnalystToken }) {
  const total = token.buyUsd + token.sellUsd;
  const share = total > 0 ? Math.round(token.buyUsd / total * 100) : null;
  return (
    <Link href={`/token/${token.address}`} className="group card flex w-[260px] shrink-0 snap-start flex-col p-5 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-border-hover hover:bg-elevated active:translate-y-0 md:w-auto md:min-w-0">
      <div className="flex items-center gap-3">
        <TokenAvatar symbol={token.symbol} address={token.address} image={token.image} size="md" className="rounded-full" />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight">{token.symbol}</p>
          <p className="mt-0.5 truncate text-xs text-muted">{token.name}</p>
        </div>
        <ArrowUpRightIcon className="ml-auto h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-neon" />
      </div>
      <div className="mt-6">
        <p className={cn("font-mono text-[25px] font-medium tracking-[-0.06em]", token.netAccumulation > 0 ? "text-neon" : token.netAccumulation < 0 ? "text-negative" : "text-primary")}>{formatUsdSigned(token.netAccumulation)}</p>
        <p className="mt-1 text-xs text-muted">Net flow <span className="mx-1">/</span> 24 hours</p>
      </div>
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
          <span className="text-secondary">{token.buyers} {token.buyers === 1 ? "buyer" : "buyers"}</span>
          <span className="text-muted">{share === null ? "Volume unavailable" : `${share}% buy volume`}</span>
        </div>
        <div className="flex h-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
          {share !== null && <span className="h-full rounded-full bg-neon/80" style={{ width: `${share}%` }} />}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs">
        <span className="text-muted">Analyst Score</span>
        <span className="font-mono font-medium text-primary">{token.score.score}<span className="font-normal text-muted"> / 100</span></span>
      </div>
    </Link>
  );
}

export function TrendingStrip({ tokens }: { tokens: AnalystToken[] }) {
  if (tokens.length === 0) return null;
  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 no-scrollbar md:grid md:grid-flow-dense md:grid-cols-2 md:overflow-visible lg:grid-cols-4">
      {tokens.map((token) => <TokenMiniCard key={token.address} token={token} />)}
    </div>
  );
}
