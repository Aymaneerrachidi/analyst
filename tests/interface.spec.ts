import { test, expect, request } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import type { SocialPost } from "../lib/types";

test("a failed chart refresh keeps the loaded single-point chart visible and can recover", async ({ page }) => {
  await page.clock.install();
  const feed = await (await page.request.get("/api/trades?limit=1")).json();
  const token = feed.trades[0].token;
  let fail = false;
  const timestamp = Date.now();
  await page.route("**/chart?window=**", route => fail
    ? route.fulfill({ status: 503, json: { error: "Temporary source outage" } })
    : route.fulfill({ json: { window: "24h", candles: [{ t: timestamp, close: 2, volume: 100 }], activity: [], markers: [], source: "executions", priceUnit: "USD", marketUrl: null } }));
  await page.goto(`/token/${token.address}`);
  const chart = page.getByRole("region", { name: `${token.symbol} chart` });
  await expect(chart.getByText(/One recorded price point/)).toBeVisible();
  await expect(chart.locator(".recharts-dot").first()).toBeVisible();
  fail = true;
  await page.clock.runFor(20_000);
  await expect(chart.getByRole("button", { name: "Retry refresh" })).toBeVisible();
  await expect(chart.locator(".recharts-dot").first()).toBeVisible();
  await expect(chart.getByText("The chart couldn’t load.")).toHaveCount(0);
  fail = false;
  await chart.getByRole("button", { name: "Retry refresh" }).click();
  await expect(chart.getByRole("button", { name: "Retry refresh" })).toHaveCount(0);
  await expect(chart.locator(".recharts-dot").first()).toBeVisible();
});

test("following persists, custom alerts deduplicate, chart markers open real trade details", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/traders");
  await page.locator("main a[href^='/trader/']").first().click();
  await expect(page).toHaveURL(/\/trader\//);
  await expect(page.getByRole("heading", { name: "Entry, exit & holding time" })).toBeVisible();
  const wallet = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: /^Follow / }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: /^Unfollow / })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Entry, exit & holding time" })).toBeVisible();
  await expect(page.getByText(/Analyzing recorded trades/)).toHaveCount(0);
  const performance = await page.request.get(`/api/traders/${wallet}/performance`);
  expect(performance.ok()).toBe(true);
  expect((await performance.json()).positions.length).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Followed traders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your traders" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Unfollow / })).toBeVisible();
  const following = await page.request.get(`/api/trades?wallets=${wallet}&limit=100`);
  expect((await following.json()).trades.every((t: { traderId: string }) => t.traderId === wallet)).toBe(true);
  expect((await page.request.get("/api/trades?wallets=invalid")).status()).toBe(400);
  const real = (await (await page.request.get(`/api/trades?trader=${wallet}&limit=1`)).json()).trades[0];
  await page.goto("/alerts");
  await page.getByLabel("Rule name", { exact: true }).fill("Large tracked buys");
  await page.getByLabel("Minimum trade value (USD)", { exact: true }).fill("1000");
  await page.getByLabel("Action", { exact: true }).selectOption("BUY");
  await page.getByRole("button", { name: "Save alert", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause Large tracked buys" })).toBeVisible();
  // Isolated test delivery; production receives provider events. Timestamp is after the rule was armed.
  const event = { ...real, id: "qa-alert", side: "BUY", amountUsd: 1234, timestamp: new Date(Date.now() + 1000).toISOString(), txHash: `0x${"f".repeat(64)}` };
  await page.route("**/api/trades?limit=200", route => route.fulfill({ json: { trades: [event] } }));
  await page.reload();
  await expect(page.locator("article")).toHaveCount(1);
  await expect(page.locator("article")).toContainText("bought");
  await page.reload();
  await expect(page.locator("article")).toHaveCount(1);
  await page.getByRole("button", { name: "Pause Large tracked buys" }).click();
  await expect(page.getByRole("button", { name: "Enable Large tracked buys" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Rule name", { exact: true }).fill("Updated rule");
  await page.getByRole("button", { name: "Save alert", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete Updated rule" })).toBeVisible();
  await page.getByRole("button", { name: "Delete Updated rule" }).click();
  await page.getByRole("button", { name: "Clear inbox", exact: true }).click();
  await expect(page.locator("article")).toHaveCount(0);
  await page.goto(`/token/${real.token.address}`);
  const chart = page.getByRole("region", { name: `${real.token.symbol} chart` });
  await chart.getByRole("button", { name: "7D", exact: true }).click();
  const marker = chart.getByRole("button", { name: /^Timeline / }).first();
  await expect(marker).toBeVisible();
  await marker.focus(); await page.keyboard.press("Enter");
  await expect(chart.getByLabel("Selected trades")).toBeVisible();
  await chart.getByRole("button", { name: "Close details" }).click();
  await chart.getByLabel("Marker traders").selectOption("following");
  await page.setViewportSize({ width: 320, height: 844 });
  for (const path of [`/token/${real.token.address}`, `/trader/${wallet}`, "/following", "/alerts"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
  }
  await page.screenshot({ path: ".playwright-mcp/analyst-alerts-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("overview fits desktop and mobile, and search, score details, and navigation work", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The market, in focus.");
  await expect(page.getByText("MOCK DATA", { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await mkdir(".playwright-mcp", { recursive: true });
  await page.screenshot({ path: ".playwright-mcp/analyst-desktop.png", fullPage: true });

  for (const width of [1280, 1024, 768, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `Horizontal overflow at ${width}px`).toBe(false);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (width === 390) await page.screenshot({ path: ".playwright-mcp/analyst-mobile.png", fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /Analyst Score .* Show breakdown/ }).first().click();
  await expect(page.getByText("Top Trader Quality", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByText("Who is buying?", { exact: true }).click();
  await expect(page.getByText(/Trader quality \(30%\) considers/)).toBeVisible();
  await page.keyboard.press("/");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  await page.getByRole("combobox").fill("PONS");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.getByRole("option").first().click();
  await expect(page).toHaveURL(/\/token\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("PONS");
  await page.getByRole("button", { name: "Watch PONS", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove PONS from watchlist", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove PONS from watchlist", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Active traders", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Traders active in this token" })).toBeVisible();
  await page.getByRole("tab", { name: "Active traders", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Swaps", exact: true })).toHaveAttribute("aria-selected", "true");
  const chart = page.getByRole("region", { name: "PONS chart" });
  await chart.scrollIntoViewIfNeeded();
  await chart.getByRole("button", { name: "7D", exact: true }).click();
  await expect(chart.locator(".recharts-surface").first()).toBeVisible();
  await chart.getByRole("button", { name: "Tracked flow", exact: true }).click();
  await expect(chart.getByRole("heading", { name: "Tracked buy and sell volume" })).toBeVisible();
  await chart.getByRole("button", { name: "7D", exact: true }).click();
  await expect(chart.locator(".recharts-surface").first()).toBeVisible();
  await page.screenshot({ path: ".playwright-mcp/analyst-token.png", fullPage: true });
  await page.goto("/watchlist");
  await expect(page.getByRole("heading", { name: "Your watchlist" })).toBeVisible();
  await page.getByRole("button", { name: "Remove PONS from watchlist", exact: true }).click();
  await expect(page.getByText("Your next move starts here.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("live filters, pause/resume, empty states and retry states work", async ({ page }) => {
  await page.goto("/live");
  await page.getByRole("button", { name: "Pause updates" }).click();
  await expect(page.getByRole("button", { name: "Resume updates" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Buys", exact: true }).click();
  await expect(page.locator("main tbody tr").first()).toContainText("BUY");
  await expect(page.locator("main tbody")).not.toContainText("SELL");
  await page.getByRole("button", { name: "Resume updates" }).click();
  await page.getByLabel("Filter by token").fill("no-such-token-qa");
  await expect(page.getByText("No trades match these filters.")).toBeVisible();
  await page.route("**/api/trades?**", (route) => route.fulfill({ status: 503, json: { error: "Test outage" } }));
  await page.getByLabel("Filter by token").fill("retry-state-qa");
  await expect(page.getByRole("button", { name: "Retry trades", exact: true })).toBeVisible();
  await page.unroute("**/api/trades?**");
  await page.getByRole("button", { name: "Retry trades", exact: true }).click();
  await expect(page.getByText("No trades match these filters.")).toBeVisible();
});

test("trader, token, and community pages fit phone screens", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/traders", "/tokens", "/social", "/live"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
    await expect(page.getByRole("navigation", { name: "Primary", exact: true }).last()).toBeVisible();
  }
  await page.goto("/traders");
  await page.locator("main a[href^='/trader/']").last().click();
  await expect(page).toHaveURL(/\/trader\//);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".playwright-mcp/analyst-trader-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("older community posts survive polling, new arrivals, pagination failures and sorting", async ({ page }) => {
  await page.clock.install();
  const now = Date.now();
  let posts: SocialPost[] = Array.from({ length: 85 }, (_, i) => ({
    id: `qa-post-${i}`, author: { id: `qa-author-${i}`, displayName: `Reader ${i}` },
    body: `Regression observation ${i}`, refs: [], upvotes: 0, downvotes: 0, score: 0,
    replyCount: 0, createdAt: new Date(now - i * 60_000).toISOString(), myVote: 0, mine: false,
  }));
  let failOlder = false;
  let requests = 0;
  await page.route("**/api/social?**", (route) => {
    requests += 1;
    const url = new URL(route.request().url());
    const before = url.searchParams.get("before");
    if (failOlder && before) return route.fulfill({ status: 503, json: { error: "Test failure" } });
    const matches = before ? posts.filter((p) => p.createdAt < before) : posts;
    return route.fulfill({ json: { posts: matches.slice(0, 40) } });
  });
  await page.goto("/social");
  // Switching views fetches fresh data instead of waiting for the SSR cache to age.
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await expect(page.locator("#qa-post-0")).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.clock.runFor(31_000);
  await expect(page.locator("#qa-post-39")).toBeAttached();
  failOlder = true;
  await page.getByRole("button", { name: "Load older posts" }).click();
  await page.clock.runFor(5_000);
  await expect(page.getByRole("button", { name: "Retry older posts" })).toBeVisible();
  await expect(page.locator("#qa-post-0")).toBeAttached();
  failOlder = false;
  await page.getByRole("button", { name: "Retry older posts" }).click();
  await expect(page.locator("#qa-post-79")).toBeAttached();
  posts = [{ ...posts[0], id: "qa-new-arrival", body: "New arrival during polling", createdAt: new Date(now + 60_000).toISOString() }, ...posts];
  const beforePoll = requests;
  await page.clock.runFor(31_000);
  await expect.poll(() => requests).toBeGreaterThan(beforePoll);
  await expect(page.locator("#qa-new-arrival")).toBeAttached();
  await expect(page.locator("#qa-post-70")).toBeAttached();
  await expect(page.locator("main article")).toHaveCount(80);
  await page.getByRole("button", { name: "Load older posts" }).click();
  await expect(page.locator("#qa-post-84")).toBeAttached();
  await expect(page.getByRole("button", { name: "Load older posts" })).toHaveCount(0);
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await expect(page.locator("main article")).toHaveCount(40);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.locator("#qa-post-84")).toBeAttached();
});

test("guest posts, votes, comments and ratings persist through the API", async ({ page }) => {
  await page.goto("/tokens");
  const href = await page.locator("main a[href^='/token/']").first().getAttribute("href");
  const token = href!.split("/").at(-1)!;
  const created = await page.request.post("/api/social", { data: { body: `Market observation from browser validation ${Date.now()}` } });
  expect(created.status(), await created.text()).toBe(201);
  // Production cookies are Secure. Forward the issued cookie explicitly for
  // this local HTTP test server; deployed HTTPS browsers do this automatically.
  const api = await request.newContext({ baseURL: "http://127.0.0.1:3120", extraHTTPHeaders: { cookie: created.headers()["set-cookie"].split(";")[0] } });
  const { post } = await created.json();
  const vote = await api.post("/api/votes", { data: { targetType: "post", targetId: post.id, value: 1 } });
  expect(vote.ok(), await vote.text()).toBe(true);
  expect((await vote.json()).upvotes).toBe(1);
  const commentResponse = await api.post("/api/comments", { data: { targetType: "post", targetId: post.id, body: "Checking whether the recorded volume supports this observation." } });
  expect(commentResponse.status(), await commentResponse.text()).toBe(201);
  const { comment } = await commentResponse.json();
  const comments = await (await api.get(`/api/comments?targetType=post&targetId=${post.id}`)).json();
  expect(comments.comments.some((item: { id: string }) => item.id === comment.id)).toBe(true);
  const rating = await api.post("/api/ratings", { data: { targetType: "token", targetId: token, score: 7 } });
  expect(rating.ok(), await rating.text()).toBe(true);
  const summary = await (await api.get(`/api/ratings?targetType=token&targetId=${token}`)).json();
  expect(summary.mine).toBe(7);
  expect((await api.delete(`/api/comments/${comment.id}`)).ok()).toBe(true);
  expect((await api.delete(`/api/social/${post.id}`)).ok()).toBe(true);
  await api.dispose();
});
