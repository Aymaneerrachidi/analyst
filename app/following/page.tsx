import { PageHeader } from "@/components/common/section-header";
import { Following } from "@/components/tracking/following";
import { explorerBase } from "@/lib/explorer";
export const metadata = { title: "Following" };
export default function Page() { return <><PageHeader title="Your traders" description="Follow conviction. Your list is saved on this device." /><Following explorer={explorerBase()} /></>; }
