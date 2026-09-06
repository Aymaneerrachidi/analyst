import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <p className="label-caps mb-3">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Nothing here.</h1>
      <p className="mt-2 max-w-sm text-sm text-secondary">That token, trader or thread doesn’t exist, or hasn’t been tracked yet.</p>
      <div className="mt-6 flex gap-2">
        <LinkButton href="/" variant="primary">
          Back home
        </LinkButton>
        <LinkButton href="/tokens">Token Monitor</LinkButton>
      </div>
    </div>
  );
}
