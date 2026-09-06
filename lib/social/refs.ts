import "server-only";
import type { ContentRef } from "@/lib/types";
import { resolveRefs } from "@/lib/services/intelligence";

export const CASHTAG_RE = /\$([A-Za-z][A-Za-z0-9]{1,15})\b/g;
export const MENTION_RE = /(^|[^A-Za-z0-9_])@([A-Za-z][A-Za-z0-9_]{1,23})\b/g;

export function extractRefs(text: string): { symbols: string[]; handles: string[] } {
  const symbols = new Set<string>();
  const handles = new Set<string>();
  for (const m of text.matchAll(CASHTAG_RE)) symbols.add(m[1].toUpperCase());
  for (const m of text.matchAll(MENTION_RE)) handles.add(m[2].toLowerCase());
  return { symbols: [...symbols], handles: [...handles] };
}

/** Builds clickable references for a batch of bodies with a single database round trip. */
export async function buildRefs(bodies: string[]): Promise<ContentRef[][]> {
  const extracted = bodies.map(extractRefs);
  const symbols = [...new Set(extracted.flatMap((e) => e.symbols))];
  const handles = [...new Set(extracted.flatMap((e) => e.handles))];
  if (symbols.length === 0 && handles.length === 0) return bodies.map(() => []);
  const resolved = await resolveRefs(symbols, handles);
  return extracted.map(({ symbols: s, handles: h }) => {
    const refs: ContentRef[] = [];
    for (const sym of s) {
      const token = resolved.tokens.get(sym);
      refs.push({
        kind: "token",
        label: `$${sym}`,
        href: token ? `/token/${token.address}` : `/tokens?q=${encodeURIComponent(sym)}`,
      });
    }
    for (const handle of h) {
      const trader = resolved.traders.get(handle);
      refs.push({
        kind: "trader",
        label: `@${handle}`,
        href: trader ? `/trader/${trader.id}` : `/traders?q=${encodeURIComponent(handle)}`,
      });
    }
    return refs;
  });
}
