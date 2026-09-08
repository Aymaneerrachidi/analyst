import { test, expect, type Page } from "@playwright/test";
import { encodeFunctionData, decodeFunctionData, erc20Abi, parseUnits, type Address } from "viem";
import { ALLOWANCE_HOLDER, NATIVE, holderAbi, settlerAbi, type TradeQuote } from "../lib/trading/shared";

const account = "0x1111111111111111111111111111111111111111" as Address;
const settler = "0x3333333333333333333333333333333333333333" as Address;
async function fixture(page: Page, enabled: boolean) {
  const feed = await (await page.request.get("/api/trades?limit=1")).json();
  const token = feed.trades[0].token;
  await page.route("**/api/trading**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { token: { address: token.address, symbol: token.symbol, decimals: 18, balance: parseUnits("100", 18).toString() }, native: { address: NATIVE, symbol: "ETH", decimals: 18, balance: parseUnits("10", 18).toString() }, executionEnabled: enabled } });
    const input = route.request().postDataJSON();
    const sell = input.side === "sell";
    const sellAmount = parseUnits(input.amount, 18).toString();
    const buyToken = sell ? NATIVE : token.address;
    const nested = encodeFunctionData({ abi: settlerAbi, functionName: "execute", args: [{ recipient: account, buyToken, minAmountOut: parseUnits("0.99", 18) }, ["0x12345678"], `0x${"00".repeat(32)}`] });
    const q: TradeQuote = { provider: enabled ? "0x" : "Umbra", executable: enabled && input.mode === "review", account: input.account, sellToken: sell ? token.address : NATIVE, buyToken, sellAmount, buyAmount: parseUnits("1", 18).toString(), minBuyAmount: parseUnits("0.99", 18).toString(), sellDecimals: 18, buyDecimals: 18, expiresAt: Date.now() + 60000, routes: ["Test route"], fees: [], spender: sell ? ALLOWANCE_HOLDER : undefined,
      transaction: enabled ? { to: sell ? ALLOWANCE_HOLDER : settler, value: sell ? "0" : sellAmount, data: sell ? encodeFunctionData({ abi: holderAbi, functionName: "exec", args: [settler, token.address, BigInt(sellAmount), settler, nested] }) : nested } : undefined };
    return route.fulfill({ json: q });
  });
  if (enabled) await page.addInitScript(({ account, settler }) => {
    const callbacks: Record<string, ((...args: unknown[]) => void)[]> = {};
    let chain = "0x1237";
    const uint = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
    const wallet = {
      on: (event: string, cb: (...args: unknown[]) => void) => { (callbacks[event] ??= []).push(cb); },
      removeListener: (event: string, cb: (...args: unknown[]) => void) => { callbacks[event] = callbacks[event]?.filter((c) => c !== cb) ?? []; },
      request: async ({ method, params }: { method: string; params?: { data?: string }[] }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
        if (method === "eth_chainId") return chain;
        if (method === "eth_getBalance") return uint(BigInt(10) ** BigInt(20));
        if (method === "eth_gasPrice") return "0x3b9aca00";
        if (method === "eth_estimateGas") return "0x30d40";
        if (method === "eth_call") {
          const data = params?.[0]?.data ?? "";
          if (data.startsWith("0x6352211e") || data.length === 74 && !data.startsWith("0x70a08231")) return `0x${settler.slice(2).padStart(64, "0")}`;
          if (data.startsWith("0xdd62ed3e")) return uint(BigInt(0));
          return uint(BigInt(10) ** BigInt(20));
        }
        if (method === "eth_sendTransaction") {
          (window as unknown as { sent: unknown[] }).sent.push(params?.[0]);
          throw Object.assign(new Error("User rejected request"), { code: 4001 });
        }
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    };
    Object.assign(window, { ethereum: wallet, sent: [], changeTestChain: () => { chain = "0x1"; for (const cb of callbacks.chainChanged ?? []) cb(chain); } });
  }, { account, settler });
  await page.goto(`/token/${token.address}`);
  return page.getByRole("region", { name: `Trade ${token.symbol}`, exact: true });
}

test("live preview mode preserves amount and direction in external handoff at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 850 });
  const panel = await fixture(page, false);
  await panel.getByLabel("You pay").fill("0.01");
  const link = panel.getByRole("link", { name: "Continue on Umbra" });
  await expect(link).toBeVisible();
  expect(new URL((await link.getAttribute("href"))!).searchParams.get("pay")).toBe("ETH");
  await panel.getByRole("button", { name: "Sell", exact: true }).click();
  await panel.getByLabel("You pay").fill("12.123");
  await expect(link).toBeVisible();
  const url = new URL((await link.getAttribute("href"))!);
  expect(url.searchParams.get("buy")).toBe("ETH"); expect(url.searchParams.get("amt")).toBe("12.123");
  await expect(panel.getByText("In-app execution is coming soon.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("wallet review invalidates on amount and network changes, and handles rejection", async ({ page }) => {
  const panel = await fixture(page, true);
  await panel.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await panel.getByRole("button", { name: "Browser wallet" }).click();
  await panel.getByLabel("You pay").fill("0.01");
  await panel.getByRole("button", { name: "Review trade", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Confirm swap in wallet" })).toBeVisible();
  await panel.getByLabel("You pay").fill("0.02");
  await expect(panel.getByRole("button", { name: "Confirm swap in wallet" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Review trade", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm swap in wallet" }).click();
  await expect(panel.getByRole("alert")).toContainText("Request cancelled");
  expect(await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent.length)).toBe(1);
  await page.evaluate(() => (window as unknown as { changeTestChain: () => void }).changeTestChain());
  await expect(panel.getByRole("button", { name: "Switch to Robinhood Chain" })).toBeVisible();
});

test("selling asks for the exact approval to AllowanceHolder before any swap", async ({ page }) => {
  const panel = await fixture(page, true);
  await panel.getByRole("button", { name: "Connect wallet", exact: true }).click();
  await panel.getByRole("button", { name: "Browser wallet" }).click();
  await panel.getByRole("button", { name: "Sell", exact: true }).click();
  await panel.getByLabel("You pay").fill("2.5");
  await panel.getByRole("button", { name: "Review trade", exact: true }).click();
  await panel.getByRole("button", { name: /^Approve / }).click();
  await expect(panel.getByRole("alert")).toContainText("Request cancelled");
  const sent = await page.evaluate(() => (window as unknown as { sent: { data: `0x${string}`; value: string }[] }).sent);
  expect(sent).toHaveLength(1);
  const call = decodeFunctionData({ abi: erc20Abi, data: sent[0].data });
  expect(call.functionName).toBe("approve"); expect(call.args).toEqual([expect.stringMatching(new RegExp(`^${ALLOWANCE_HOLDER}$`, "i")), parseUnits("2.5", 18)]);
  expect(BigInt(sent[0].value)).toBe(BigInt(0));
});
