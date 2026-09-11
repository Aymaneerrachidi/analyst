import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";

const ROOT = path.join(process.cwd(), ".data", "source-images");
const ALLOWED = new Set(["www.ponsfamily.com", "ponsfamily.com", "kolhood.io", "www.kolhood.io", "assets.geckoterminal.com", "pbs.twimg.com", "cdn.dexscreener.com", "dd.dexscreener.com", "assets.coingecko.com", "coin-images.coingecko.com", "unavatar.io"]);
// Image hosts observed in contract-matched launchpad metadata.
for (const host of ["j7m.io", "iili.io", "metadata.j7tracker.io", "cymetica.com", "gmgn.ai", "meta.mwmwmwmwmwmwmwmwmw.uk", "m.rapidlaunch.io", "axiomtrading.sfo3.cdn.digitaloceanspaces.com", "md.sdfgsdfsdf.uk", "token-media.defined.fi", "ipfs.launchblitz.ai", "app.zxwwhm.us", "replicate.delivery"]) ALLOWED.add(host);
const pending = new Map<string, Promise<{ bytes: Buffer; type: string }>>();
// ENS avatar service, present in Defined's public wallet identity metadata.
ALLOWED.add("euc.li");
ALLOWED.add("prod-fomo-profile-pics.s3.amazonaws.com");
ALLOWED.add("kol-avatar.solanatracker.io");
for (const host of ["stalkchain.nyc3.cdn.digitaloceanspaces.com", "cdn-nj.qeqeqzxzx.xyz", "mademen.family", "cdn2.levitatingbananatree.xyz"]) ALLOWED.add(host);
const failures = new Map<string, number>();

export async function sourceImage(source: string): Promise<{ bytes: Buffer; type: string }> {
  const url = new URL(source);
  if (url.protocol !== "https:" || !ALLOWED.has(url.hostname) || url.username || url.password || url.port) throw new Error("Unsupported image source");
  const key = createHash("sha256").update(source).digest("hex");
  const file = path.join(ROOT, key);
  try {
    if (process.env.VERCEL) {
      const stored = await get(`source-images/${key}`, { access: "private" });
      if (stored?.statusCode === 200) return { bytes: Buffer.from(await new Response(stored.stream).arrayBuffer()), type: stored.blob.contentType };
    } else {
    const [bytes, type] = await Promise.all([readFile(file), readFile(`${file}.type`, "utf8")]);
    return { bytes, type };
    }
  } catch { /* Not downloaded yet. */ }
  if ((failures.get(key) ?? 0) > Date.now()) throw new Error("Source image unavailable");
  const active = pending.get(key);
  if (active) return active;
  const work = (async () => {
    let target = url;
    if (url.hostname === "unavatar.io") {
      const handle = url.pathname.match(/^\/twitter\/([A-Za-z0-9_]{1,15})$/)?.[1];
      if (!handle) throw new Error("Invalid profile image reference");
      const response = await fetch(`https://api.fxtwitter.com/${handle}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
      if (!response.ok) throw new Error("Profile source unavailable");
      const profile = await response.json();
      if (profile.user?.screen_name?.toLowerCase() !== handle.toLowerCase() || typeof profile.user?.avatar_url !== "string") throw new Error("Profile image not verified");
      target = new URL(profile.user.avatar_url.replace("_normal.", "_400x400."));
      if (target.protocol !== "https:" || target.hostname !== "pbs.twimg.com" || target.port || target.username) throw new Error("Invalid profile image source");
      if (/default_profile_images/.test(target.pathname)) throw new Error("Profile has no photo");
    }
    let response = await fetch(target, { signal: AbortSignal.timeout(15_000), redirect: "manual", cache: "no-store" });
    for (let redirects = 0; [301, 302, 303, 307, 308].includes(response.status) && redirects < 2; redirects++) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Image redirect missing');
      const next = new URL(location, target);
      if (next.protocol !== 'https:' || !ALLOWED.has(next.hostname) || next.username || next.password || next.port) throw new Error('Unsupported image redirect');
      await response.body?.cancel();
      target = next;
      response = await fetch(target, { signal: AbortSignal.timeout(15_000), redirect: 'manual', cache: 'no-store' });
    }
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/svg+xml"].includes(type)) throw new Error("Source did not return a photo");
    if (Number(response.headers.get("content-length")) > 5_000_000) throw new Error("Image too large");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty image");
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 5_000_000) { await reader.cancel(); throw new Error("Image too large"); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    try {
      if (process.env.VERCEL) {
        await put(`source-images/${key}`, bytes, { access: "private", contentType: type, addRandomSuffix: false, allowOverwrite: true });
      } else {
        await mkdir(ROOT, { recursive: true });
        await writeFile(file, bytes);
        await writeFile(`${file}.type`, type);
      }
    } catch { console.error("[image:cache] Unable to persist source image"); }
    return { bytes, type };
  })().catch((error) => { failures.set(key, Date.now() + 5 * 60_000); throw error; });
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}
