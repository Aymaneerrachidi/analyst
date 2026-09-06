import { PageHeader } from "@/components/common/section-header";
import { WatchlistContent } from "@/components/workspace/watchlist";
export const metadata = { title: "Watchlist" };
export default function WatchlistPage() {
  return <div className="mx-auto max-w-3xl"><PageHeader title="Your watchlist" description="The tokens you’re keeping an eye on. Saved on this device." /><WatchlistContent /></div>;
}
