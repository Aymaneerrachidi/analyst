import "server-only";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export function jsonError(status: number, error: string, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}

export function rateLimited(retryAfterSec: number, message = "Too many requests. Slow down a little."): NextResponse {
  return NextResponse.json({ error: message, retryAfterSec }, { status: 429, headers: { "retry-after": String(retryAfterSec) } });
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    const maxBytes = 64 * 1024;
    if (Number(req.headers.get("content-length")) > maxBytes) return { ok: false, response: jsonError(413, "Request body too large.") };
    const reader = req.body?.getReader();
    if (!reader) return { ok: false, response: jsonError(400, "Missing JSON body.") };
    let length = 0;
    let body = "";
    const decoder = new TextDecoder();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); return { ok: false, response: jsonError(413, "Request body too large.") }; }
      body += decoder.decode(chunk.value, { stream: true });
    }
    raw = JSON.parse(body + decoder.decode());
  } catch {
    return { ok: false, response: jsonError(400, "Invalid JSON body.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, response: jsonError(400, first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request.") };
  }
  return { ok: true, data: parsed.data };
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip");
}

export function searchParam(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key);
  return v === null || v === "" ? undefined : v;
}

export function intParam(url: URL, key: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(key);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function floatParam(url: URL, key: string): number | undefined {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === "") return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export const noStore = { headers: { "cache-control": "no-store" } } as const;
