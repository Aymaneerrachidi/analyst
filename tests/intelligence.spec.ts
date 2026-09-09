import { test, expect, request } from '@playwright/test';

test('intelligence pages render without errors and remain usable on a phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ['/radar', '/signals', '/narratives', '/compare', '/feed', '/positions']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Intelligence tools' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), path).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('saved preferences persist and remain isolated between anonymous profiles', async ({ page, baseURL }) => {
  const a = `0x${'a'.repeat(40)}`;
  const b = `0x${'b'.repeat(40)}`;
  await page.goto('/');
  const response = await page.request.patch('/api/preferences', { data: { follows: [a, a], watchlist: [b], rules: [] } });
  expect(response.status()).toBe(200);
  // Secure production cookie must be forwarded explicitly on this HTTP test server.
  const authenticated = await request.newContext({ baseURL, extraHTTPHeaders: { cookie: response.headers()['set-cookie'].split(';')[0] } });
  const saved = await (await authenticated.get('/api/preferences')).json();
  await authenticated.dispose();
  expect(saved.follows).toEqual([a]);
  expect(saved.watchlist).toEqual([b]);
  expect(saved.saved).toBe(true);
  const other = await request.newContext({ baseURL });
  try {
    const fresh = await (await other.get('/api/preferences')).json();
    expect(fresh.follows).toEqual([]);
    expect(fresh.watchlist).toEqual([]);
    expect((await other.patch('/api/preferences', { headers: { origin: 'https://invalid.example' }, data: { follows: [b] } })).status()).toBe(403);
  } finally { await other.dispose(); }
  expect((await page.request.patch('/api/preferences', { data: { follows: ['invalid'] } })).status()).toBe(400);
});

test('research and indexing fail honestly when unconfigured', async ({ page }) => {
  const feed = await (await page.request.get('/api/trades?limit=1')).json();
  const address = feed.trades[0].token.address;
  const response = await page.request.post(`/api/tokens/${address}/why-pumping`, { data: {} });
  expect(response.status()).toBe(503);
  const health = await (await page.request.get('/api/health')).json();
  expect(health.features.research).toBe(false);
  expect(health.features.sharedStream).toBe(false);
  const events = await page.request.get('/api/events');
  expect(events.status()).toBe(503);
});

test('comparison deduplicates token addresses and rejects invalid wallet input', async ({ page }) => {
  const feed = await (await page.request.get('/api/trades?limit=1')).json();
  const address = feed.trades[0].token.address;
  await page.goto(`/compare?tokens=${address},${address}`);
  await expect(page.locator('main h1')).toBeVisible();
  await page.goto('/positions?wallet=invalid');
  await expect(page.locator('main').getByRole('alert')).toContainText('valid wallet');
  expect((await page.request.get('/api/wallets/invalid/detective')).status()).toBe(400);
});
