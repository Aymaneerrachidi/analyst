import { sourceImage } from "@/lib/providers/source-images";

export async function GET(req: Request) {
  const source = new URL(req.url).searchParams.get("src");
  if (!source || source.length > 2048) return new Response(null, { status: 400 });
  try {
    const image = await sourceImage(source);
    return new Response(new Uint8Array(image.bytes), { headers: { "content-type": image.type, "cache-control": "public, max-age=86400, stale-while-revalidate=604800", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  } catch {
    return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=300" } });
  }
}
