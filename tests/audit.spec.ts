import { expect, test } from "@playwright/test";

test("rankings preserve source metrics on profiles and paginate with filters", async ({ page }) => {
  await page.goto("/traders?period=7d&filter=active");
  const rows = await (await page.request.get("/api/traders?period=7d&filter=active&limit=26")).json();
  expect(await page.locator("main tbody tr").count()).toBeLessThanOrEqual(25);
  const trader = rows.traders[0];
  const profile = await (await page.request.get(`/api/traders/${trader.id}?period=7d`)).json();
  for (const key of ["realizedPnl", "winRate", "trades", "roi", "statsSource", "statsPeriod"]) expect(profile.trader[key]).toEqual(trader[key]);
  if (rows.traders.length > 25) {
    await page.getByRole("link", { name: "Next page", exact: true }).click();
    expect(page.url()).toContain("period=7d"); expect(page.url()).toContain("filter=active"); expect(page.url()).toContain("page=2");
  }
});

test("asset filters preserve their window and cross-site writes are rejected", async ({ page }) => {
  await page.goto("/tokens?w=1h");
  await page.getByRole("link", { name: "Stablecoins", exact: true }).click();
  await expect(page).toHaveURL(/category=stablecoins/); expect(page.url()).toContain("w=1h");
  const response = await page.request.post("/api/me", { headers: { origin: "https://unrelated.example", "sec-fetch-site": "cross-site" }, data: { displayName: "Guard fixture" } });
  expect(response.status()).toBe(403);
  const oversized = await page.request.post("/api/me", { data: { displayName: "x".repeat(70_000) } });
  expect(oversized.status()).toBe(413);
});
