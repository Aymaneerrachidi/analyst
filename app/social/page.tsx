import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRightIcon, ChatCircleDotsIcon } from "@phosphor-icons/react/dist/ssr";
import { ensureBootstrapped } from "@/lib/services/sync";
import { listPosts } from "@/lib/social/posts";
import { getGuest } from "@/lib/social/guest";
import { seedSocialIfEmpty } from "@/lib/db/seed-social";
import { PageHeader } from "@/components/common/section-header";
import { SocialFeed } from "@/components/social/social-feed";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Community" };

export default async function SocialPage() {
  await ensureBootstrapped().catch(() => undefined);
  await seedSocialIfEmpty().catch(() => undefined);
  const guest = await getGuest();
  const posts = await listPosts({ guestId: guest?.id ?? null, sort: "new", limit: 40 });
  return (
    <div>
      <PageHeader title="Compare notes." description="The conversation behind the trades. Share what you’re seeing on Robinhood Chain, and hear another perspective." />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)] lg:gap-12">
        <div className="min-w-0"><SocialFeed initialPosts={posts} initialSort="new" /></div>
        <aside className="hidden lg:block">
          <div className="rounded-2xl border border-neon/20 bg-neon/[0.04] p-6">
            <ChatCircleDotsIcon className="mb-5 h-7 w-7 text-neon" />
            <h2 className="text-lg font-medium tracking-tight">A little context goes a long way.</h2>
            <p className="mt-3 text-sm leading-relaxed text-secondary">Share a trade, a question, or a different take. Mention <span className="text-neon">$TOKENS</span> and <span className="text-neon">@traders</span> to connect your post to the data.</p>
            <p className="mt-4 text-xs leading-relaxed text-muted">No account needed. Your display name and posts are linked to this browser.</p>
          </div>
          <div className="mt-8 divide-y divide-border border-y border-border">
            <Link href="/tokens" className="flex items-center justify-between py-5 text-sm text-secondary hover:text-neon">Explore token activity <ArrowUpRightIcon /></Link>
            <Link href="/traders" className="flex items-center justify-between py-5 text-sm text-secondary hover:text-neon">See the leaderboard <ArrowUpRightIcon /></Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
