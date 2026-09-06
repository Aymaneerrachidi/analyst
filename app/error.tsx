"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/button";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <p className="label-caps mb-3">Error</p>
      <h1 className="text-2xl font-semibold tracking-tight">Something broke on our side.</h1>
      <p className="mt-2 max-w-sm text-sm text-secondary">The page failed to load. Trying again usually fixes it. If the data source is down, the feed will show as delayed.</p>
      <div className="mt-6 flex gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <LinkButton href="/">Back home</LinkButton>
      </div>
    </div>
  );
}
