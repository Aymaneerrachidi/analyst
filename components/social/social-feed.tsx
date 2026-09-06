"use client";

import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { apiGet } from "@/lib/client/fetcher";
import type { SocialPost } from "@/lib/types";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonLines } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PostComposer } from "./post-composer";
import { PostCard } from "./post-card";

type Sort = "new" | "top";
type PostsPage = { posts: SocialPost[] };
const PAGE_SIZE = 40;

export function SocialFeed({ initialPosts, initialSort = "new" }: { initialPosts?: SocialPost[]; initialSort?: Sort }) {
  const qc = useQueryClient();
  const [sort, setSort] = useState<Sort>(initialSort);
  const key = ["posts", sort];
  const { data, isLoading, isError, refetch, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => apiGet<PostsPage>(`/api/social?sort=${sort}&limit=${PAGE_SIZE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => sort === "new" && lastPage.posts.length === PAGE_SIZE ? lastPage.posts.at(-1)?.createdAt : undefined,
    initialData: initialPosts && sort === initialSort ? { pages: [{ posts: initialPosts }], pageParams: [undefined] } : undefined,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
  // Refetching an infinite query refreshes every loaded page, retaining older
  // posts and recomputing cursors when new posts shift the page boundaries.
  const posts = [...new Map(data?.pages.flatMap((page) => page.posts).map((post) => [post.id, post]) ?? []).values()];

  const mutate = useCallback(
    (fn: (list: SocialPost[], pageIndex: number) => SocialPost[]) => {
      void qc.cancelQueries({ queryKey: ["posts", sort] });
      qc.setQueryData<InfiniteData<PostsPage>>(["posts", sort], (prev) => ({
        pages: (prev?.pages ?? [{ posts: [] }]).map((page, i) => ({ posts: fn(page.posts, i) })),
        pageParams: prev?.pageParams ?? [undefined],
      }));
    },
    [qc, sort],
  );

  return (
    <div>
      <PostComposer
        onOptimistic={(temp) => mutate((list, pageIndex) => pageIndex === 0 ? [temp, ...list] : list)}
        onCreated={(real, tempId) => mutate((list) => list.map((p) => (p.id === tempId ? real : p)))}
        onFailed={(tempId) => mutate((list) => list.filter((p) => p.id !== tempId))}
      />
      <div className="mt-6 mb-3 flex items-center justify-between">
        <p className="label-caps">{sort === "new" ? "Latest" : "Most upvoted"}</p>
        <FilterTabs
          size="sm"
          value={sort}
          onChange={setSort}
          options={[
            { value: "new", label: "New" },
            { value: "top", label: "Top" },
          ]}
          ariaLabel="Sort posts"
        />
      </div>
      <div className="space-y-3">
        {isLoading && <SkeletonLines count={5} />}
        {isError && !isFetchNextPageError && <ErrorState title="The feed couldn’t refresh." action={<Button size="sm" onClick={() => refetch()}>Retry</Button>} />}
        {!isLoading && !isError && posts.length === 0 && <EmptyState title="Quiet in here." description="Start the first conversation about a token or a trader." />}
        {posts.map((p) => (
          <PostCard key={p.id} post={p} onDeleted={(id) => mutate((list) => list.filter((x) => x.id !== id))} />
        ))}
      </div>
      {hasNextPage && (
        <div className="mt-6 flex flex-col items-center gap-3">
          {isFetchNextPageError && <p role="alert" className="text-sm text-negative">Older posts couldn’t load. Try again.</p>}
          <Button onClick={() => void fetchNextPage()} disabled={isFetching}>
            {isFetchingNextPage ? "Loading…" : isFetchNextPageError ? "Retry older posts" : "Load older posts"}
          </Button>
        </div>
      )}
    </div>
  );
}
