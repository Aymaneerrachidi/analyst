import { Skeleton, SkeletonCards, SkeletonTable } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-10" aria-busy>
      <div className="space-y-3 pt-4">
        <Skeleton className="h-9 w-2/3 max-w-lg" />
        <Skeleton className="h-9 w-1/2 max-w-md" />
        <Skeleton className="h-4 w-1/3 max-w-xs" />
      </div>
      <SkeletonCards count={4} />
      <SkeletonTable rows={6} />
    </div>
  );
}
