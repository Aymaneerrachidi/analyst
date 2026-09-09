export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(req: Request) {
  if (!process.env.INDEXER_URL || !process.env.INDEXER_SECRET) return Response.json({ error: 'Live stream unavailable' }, { status: 503 });
  try {
    const response = await fetch(new URL('/events', process.env.INDEXER_URL), { headers: { authorization: `Bearer ${process.env.INDEXER_SECRET}` }, signal: AbortSignal.any([req.signal, AbortSignal.timeout(280_000)]), cache: 'no-store' });
    if (!response.ok || !response.body) return Response.json({ error: 'Live stream reconnecting' }, { status: 503 });
    return new Response(response.body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' } });
  } catch { return Response.json({ error: 'Live stream reconnecting' }, { status: 503 }); }
}
