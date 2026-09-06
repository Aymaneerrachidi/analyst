import Link from "next/link";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Wordmark } from "./brand";

export function Footer() {
  return (
    <footer className="mt-10 border-t border-border bg-surface/40 pb-24 lg:pb-0">
      <div className="app-container py-10 md:py-12">
        <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-start">
          <div>
            <Wordmark />
            <p className="mt-3 text-sm text-secondary">A clearer view of Robinhood Chain.</p>
          </div>
          <nav className="flex flex-wrap gap-x-7 gap-y-4 text-[13px] text-secondary" aria-label="Footer">
            <Link href="/traders" className="hover:text-neon">Traders</Link>
            <Link href="/tokens" className="hover:text-neon">Tokens</Link>
            <Link href="/social" className="hover:text-neon">Community</Link>
            <a href="https://docs.robinhood.com/chain/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-neon">Network docs <ArrowUpRightIcon /></a>
          </nav>
        </div>
        <div className="mt-9 flex flex-col justify-between gap-3 border-t border-border pt-6 text-xs leading-relaxed text-muted md:flex-row">
          <p className="max-w-xl">Independent analytics and community. Not affiliated with or endorsed by Robinhood.</p>
          <p>Data may be delayed. Not financial advice.</p>
        </div>
      </div>
    </footer>
  );
}
