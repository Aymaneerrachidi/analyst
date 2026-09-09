import { AlertEngine } from "@/components/tracking/alert-engine";
import { PreferenceStatus } from '@/components/tracking/preference-status';
import type { Metadata, Viewport } from "next";

export const maxDuration = 300;
import { connection } from "next/server";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/lib/client/query-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopNav } from "@/components/shell/top-nav";
import { MobileNav } from "@/components/shell/mobile-nav";
import { Footer } from "@/components/shell/footer";
import { SearchCommandDialog } from "@/components/shell/search-command";
import { Toaster } from "@/lib/client/toast";
import { ensureFresh, getFreshness } from "@/lib/services/sync";
import type { Freshness } from "@/lib/types";
import { LiveIndicator } from "@/components/shell/live-indicator";
import { TradeStreamProvider } from "@/components/live/stream-provider";
import { env } from "@/lib/env";
import { DiscoveryPanel } from "@/components/workspace/discovery";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "ANALYST — Follow conviction on Robinhood Chain", template: "%s · ANALYST" },
  description: "Top traders, live trades and token conviction on Robinhood Chain. Independent analytics and community, no account required.",
  applicationName: "ANALYST",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: "#080b09",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page is request-bound (live data + guest cookie); opt the shell out of static prerendering too.
  await connection();
  let initialFreshness: Freshness | undefined;
  try {
    await ensureFresh("trades", 8_000);
    initialFreshness = await getFreshness();
  } catch {
    initialFreshness = undefined;
  }
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-primary">
        <QueryProvider>
          <TradeStreamProvider enabled={env().DATA_PROVIDER === "kolhood" || Boolean(process.env.INDEXER_URL)} shared={Boolean(process.env.INDEXER_URL && process.env.INDEXER_SECRET)}>
          <TooltipProvider>
            <AlertEngine />
            <PreferenceStatus />
            <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-neon focus:px-5 focus:py-3 focus:text-background">Skip to content</a>
            <TopNav />
            <DiscoveryPanel />
            <div className="workspace-content">
            <div className="app-container">
              <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-[11px]">
                <span className="inline-flex items-center gap-2.5 font-medium text-primary">
                  <span className="h-2 w-2 rounded-full border-2 border-neon" aria-hidden />
                  Robinhood Chain
                  <span className="ml-2 hidden border-l border-border pl-4 font-normal text-muted sm:inline">Independent market intelligence</span>
                </span>
                <LiveIndicator initial={initialFreshness} />
              </div>
            </div>
            <main id="main-content" className="app-container min-w-0 flex-1 pb-12" tabIndex={-1}>{children}</main>
            <Footer />
            </div>
            <MobileNav />
            <SearchCommandDialog />
            <Toaster />
          </TooltipProvider>
          </TradeStreamProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
