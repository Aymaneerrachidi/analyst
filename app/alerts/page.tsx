import { PageHeader } from "@/components/common/section-header";
import { Alerts } from "@/components/tracking/alerts";
export const metadata = { title: "Alerts" };
export default function Page() { return <div className="mx-auto max-w-4xl"><PageHeader title="Your alerts" description="Choose the trades that deserve your attention." /><Alerts /></div>; }
