"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw, Wallet } from "lucide-react";
import { createPublicClient, custom, encodeFunctionData, erc20Abi, formatUnits, http, toHex, type Address, type EIP1193Provider, type Hex } from "viem";
import { ALLOWANCE_HOLDER, SETTLER_REGISTRY, registryAbi, robinhood, sameAddress, umbraLink, unitsExact, validateExecution, type TradeAssets, type TradeInput, type TradeQuote } from "@/lib/trading/shared";

type Provider = EIP1193Provider & { on?: (event: string, fn: (...args: unknown[]) => void) => void; removeListener?: (event: string, fn: (...args: unknown[]) => void) => void };
type WalletOption = { info: { uuid: string; name: string }; provider: Provider };
type Prepared = { to: Address; data: Hex; value: Hex; gas: Hex; gasPrice: Hex; fee: string; action: "swap" | "approve" | "reset" };
type Receipt = { hash: Hex; status: "pending" | "success" | "reverted"; action: Prepared["action"] };
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...options, cache: "no-store" }); const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Trading is temporarily unavailable."); return data;
}
function readable(error: unknown) {
  const e = error as { code?: number; shortMessage?: string; message?: string };
  if (e.code === 4001 || /rejected|denied/i.test(e.message ?? "")) return "Request cancelled in your wallet.";
  return (e.shortMessage || e.message || "Could not complete this request.").slice(0, 220);
}
function amountText(value: string, decimals: number) {
  const text = formatUnits(BigInt(value), decimals);
  if (text.length < 18) return text;
  return `${text.slice(0, 17)}…`;
}
function requireFreshQuote(quote: TradeQuote) {
  if (Date.now() >= quote.expiresAt) throw new Error("Quote expired. Review again before signing.");
}
export function TradePanel({ address, symbol }: { address: string; symbol: string }) {
  const token = address.toLowerCase() as Address;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippage] = useState(50);
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [provider, setProvider] = useState<Provider>();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<TradeQuote>();
  const [prepared, setPrepared] = useState<Prepared>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [now, setNow] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(true);
  const signing = useRef(false);

  function invalidate() { generation.current++; setReview(undefined); setPrepared(undefined); setError(""); }
  useEffect(() => {
    mounted.current = true;
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<WalletOption>).detail;
      if (detail?.info?.uuid && typeof detail.provider?.request === "function") setWallets((w) => w.some((x) => x.provider === detail.provider) ? w : [...w, detail]);
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const fallback = setTimeout(() => {
      const p = (window as Window & { ethereum?: Provider }).ethereum;
      if (p) setWallets((w) => w.length ? w : [{ info: { uuid: "injected", name: "Browser wallet" }, provider: p }]);
    }, 200);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; clearTimeout(fallback); clearInterval(timer); window.removeEventListener("eip6963:announceProvider", announce); };
  }, []);
  useEffect(() => {
    if (!provider) return;
    const changed = () => {
      generation.current++; setReview(undefined); setPrepared(undefined);
      Promise.all([provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" })]).then(([a, c]) => {
        if (!mounted.current) return;
        setAccount(a[0]); setChainId(Number(c));
      }).catch(() => { setAccount(undefined); setChainId(undefined); });
    };
    const disconnected = () => { generation.current++; setAccount(undefined); setChainId(undefined); setReview(undefined); setPrepared(undefined); };
    provider.on?.("accountsChanged", changed); provider.on?.("chainChanged", changed); provider.on?.("disconnect", disconnected);
    return () => { provider.removeListener?.("accountsChanged", changed); provider.removeListener?.("chainChanged", changed); provider.removeListener?.("disconnect", disconnected); };
  }, [provider]);
  const assets = useQuery({ queryKey: ["trading-assets", token, account], queryFn: ({ signal }) => api<TradeAssets>(`/api/trading?token=${token}${account ? `&account=${account}` : ""}`, { signal }), staleTime: 15_000, refetchInterval: account ? 30_000 : false, retry: false });
  const sell = side === "buy" ? assets.data?.native : assets.data?.token;
  const buy = side === "buy" ? assets.data?.token : assets.data?.native;
  let amountError = ""; let baseAmount: bigint | undefined;
  if (amount && sell) { try { baseAmount = unitsExact(amount, sell.decimals); } catch (e) { amountError = readable(e); } }
  const input: TradeInput = { token, side, amount, slippageBps, account, mode: "preview" };
  const inputKey = JSON.stringify(input);
  const preview = useQuery({
    queryKey: ["trading-quote", inputKey],
    queryFn: async ({ signal }) => {
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 550); signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Cancelled")); }, { once: true }); });
      return api<TradeQuote>("/api/trading", { method: "POST", headers: { "content-type": "application/json" }, body: inputKey, signal });
    },
    enabled: Boolean(baseAmount && !review && !busy), refetchInterval: 15_000, staleTime: 10_000, retry: false,
  });
  const quote = review ?? preview.data;
  const expired = quote ? now >= quote.expiresAt : false;
  const wrongChain = account && chainId !== robinhood.id;
  const insufficient = baseAmount && sell?.balance !== undefined && baseAmount > BigInt(sell.balance);
  const locked = Boolean(busy || receipt?.status === "pending");
  const active = (id: number) => { if (!mounted.current || id !== generation.current) throw new Error("Wallet or trade changed. Review the trade again."); };
  async function walletMatches(p: Provider, a: Address, id: number) {
    const [accounts, chain] = await Promise.all([p.request({ method: "eth_accounts" }), p.request({ method: "eth_chainId" })]);
    active(id);
    if (Number(chain) !== robinhood.id || !accounts[0] || !sameAddress(accounts[0], a)) throw new Error("Wallet or network changed. Reconnect and review again.");
  }
  async function connect(option: WalletOption) {
    setBusy("Connecting wallet…"); setError("");
    try { const accounts = await option.provider.request({ method: "eth_requestAccounts" }); const chain = await option.provider.request({ method: "eth_chainId" }); invalidate(); setProvider(option.provider); setAccount(accounts[0]); setChainId(Number(chain)); setPicker(false); }
    catch (e) { setError(readable(e)); } finally { setBusy(""); }
  }
  async function switchChain() {
    if (!provider) return;
    setBusy("Switching network…"); setError("");
    try {
      try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(robinhood.id) }] }); }
      catch (e) { if ((e as { code?: number }).code !== 4902) throw e; await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: toHex(robinhood.id), chainName: robinhood.name, nativeCurrency: robinhood.nativeCurrency, rpcUrls: [...robinhood.rpcUrls.default.http], blockExplorerUrls: [robinhood.blockExplorers.default.url] }] }); }
      setChainId(Number(await provider.request({ method: "eth_chainId" }))); invalidate();
    } catch (e) { setError(readable(e)); } finally { setBusy(""); }
  }
  async function prepareReview() {
    if (!provider || !account || signing.current) return;
    const id = ++generation.current;
    setBusy("Checking trade and gas…"); setError(""); setPrepared(undefined); setReview(undefined);
    try {
      await walletMatches(provider, account, id);
      const q = await api<TradeQuote>("/api/trading", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, mode: "review" }) });
      active(id);
      const client = createPublicClient({ chain: robinhood, transport: custom(provider, { retryCount: 0 }) });
      const current = await client.readContract({ address: SETTLER_REGISTRY, abi: registryAbi, functionName: "ownerOf", args: [BigInt(2)] });
      const previous = await client.readContract({ address: SETTLER_REGISTRY, abi: registryAbi, functionName: "prev", args: [BigInt(2)] });
      validateExecution(q, account, [current, previous]);
      if (!sameAddress(q.sellToken, sell!.address) || !sameAddress(q.buyToken, buy!.address) || q.sellAmount !== baseAmount!.toString()) throw new Error("Quote did not match your trade.");
      let action: Prepared["action"] = "swap";
      let tx = q.transaction!;
      const nativeBalance = await client.getBalance({ address: account });
      if (side === "sell") {
        const [balance, allowance] = await Promise.all([client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account] }), client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, ALLOWANCE_HOLDER] })]);
        if (balance < baseAmount!) throw new Error("Insufficient token balance.");
        if (allowance < baseAmount!) {
          action = allowance > BigInt(0) ? "reset" : "approve";
          tx = { to: token, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ALLOWANCE_HOLDER, action === "reset" ? BigInt(0) : baseAmount!] }) };
        }
      }
      const call = { account, to: tx.to, data: tx.data, value: BigInt(tx.value) };
      const gasPrice = await client.getGasPrice();
      const [estimate, simulation] = await Promise.all([client.estimateGas({ ...call, gasPrice }), client.call({ ...call, gasPrice })]);
      if (action !== "swap" && simulation.data && simulation.data !== "0x" && BigInt(simulation.data) === BigInt(0)) throw new Error("This token rejected its approval.");
      const gas = estimate * BigInt(120) / BigInt(100);
      if (nativeBalance < BigInt(tx.value) + gas * gasPrice) throw new Error("Not enough ETH for this trade and network gas.");
      await walletMatches(provider, account, id);
      validateExecution(q, account, [current, previous]);
      setReview(q); setPrepared({ to: tx.to, data: tx.data, value: toHex(BigInt(tx.value)), gas: toHex(gas), gasPrice: toHex(gasPrice), fee: (gas * gasPrice).toString(), action });
    } catch (e) { if (id === generation.current) setError(readable(e)); } finally { setBusy(""); }
  }
  async function checkReceipt(value: Receipt) {
    try {
      const client = createPublicClient({ chain: robinhood, transport: http(robinhood.rpcUrls.default.http[0], { timeout: 12_000, retryCount: 0 }) });
      if (await client.getChainId() !== robinhood.id) throw new Error("Switch to Robinhood Chain to check confirmation.");
      const result = await client.waitForTransactionReceipt({ hash: value.hash, confirmations: 1, timeout: 90_000, pollingInterval: 2000 });
      if (!mounted.current) return;
      setReceipt({ ...value, status: result.status });
      invalidate();
      if (result.status === "reverted") setError("Transaction reverted. Gas may have been charged. Review a fresh quote before trying again.");
      void assets.refetch();
    } catch { if (mounted.current) setError("Confirmation is still pending. Check the transaction before submitting another trade."); }
  }
  async function confirm() {
    if (!provider || !account || !review || !prepared || signing.current || locked) return;
    signing.current = true;
    const id = generation.current; const p = provider; const a = account; const q = review; const plan = prepared;
    setBusy("Confirm in your wallet…"); setError("");
    try {
      await walletMatches(p, a, id);
      requireFreshQuote(q);
      const client = createPublicClient({ chain: robinhood, transport: custom(p, { retryCount: 0 }) });
      const current = await client.readContract({ address: SETTLER_REGISTRY, abi: registryAbi, functionName: "ownerOf", args: [BigInt(2)] });
      const previous = await client.readContract({ address: SETTLER_REGISTRY, abi: registryAbi, functionName: "prev", args: [BigInt(2)] });
      validateExecution(q, a, [current, previous]);
      const { action: _action, fee: _fee, ...transaction } = plan;
      void _action; void _fee;
      await p.request({ method: "eth_call", params: [{ ...transaction, from: a }, "latest"] });
      await walletMatches(p, a, id);
      requireFreshQuote(q);
      const hash = await p.request({ method: "eth_sendTransaction", params: [{ ...transaction, from: a, chainId: toHex(robinhood.id) }] });
      // Preserve the hash even if the wallet changed while its confirmation dialog was open.
      const pending: Receipt = { hash, status: "pending", action: plan.action };
      setReceipt(pending); setReview(undefined); setPrepared(undefined); setBusy("");
      void checkReceipt(pending);
    } catch (e) { setError(readable(e)); setReview(undefined); setPrepared(undefined); } finally { signing.current = false; setBusy(""); }
  }
  const outputSymbol = buy?.symbol ?? (side === "buy" ? symbol : "ETH");
  const inputSymbol = sell?.symbol ?? (side === "buy" ? "ETH" : symbol);
  return <section id="trade" className="card scroll-mt-24 overflow-hidden" aria-label={`Trade ${symbol}`}>
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <h2 className="text-base font-semibold">Trade {symbol}</h2>
      <span className="text-xs text-secondary">Robinhood Chain</span>
    </div>
    <div className="grid gap-5 p-4 md:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <div className="grid grid-cols-2 rounded-lg bg-black/30 p-1" aria-label="Trade direction">
          {(["buy", "sell"] as const).map((s) => <button key={s} disabled={locked} aria-pressed={side === s} onClick={() => { invalidate(); setSide(s); setAmount(""); }} className={`min-h-10 rounded-md text-sm font-semibold disabled:opacity-50 ${side === s ? s === "buy" ? "bg-neon text-black" : "bg-negative text-black" : "text-secondary hover:text-foreground"}`}>{s === "buy" ? "Buy" : "Sell"}</button>)}
        </div>
        <div className="rounded-lg border border-border bg-black/20 p-3">
          <label htmlFor="trade-amount" className="text-xs text-secondary">You pay</label>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <input id="trade-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} disabled={locked} onChange={(e) => { invalidate(); setAmount(e.target.value); }} className="w-full min-w-0 bg-transparent font-mono text-2xl outline-none focus-visible:ring-1 focus-visible:ring-neon" />
            <span className="max-w-28 truncate text-sm font-semibold" title={inputSymbol}>{inputSymbol}</span>
          </div>
          <div className="mt-2 flex justify-between gap-2 text-xs text-muted">
            <span>{sell?.balance !== undefined ? `Balance ${amountText(sell.balance, sell.decimals)}` : account ? "Balance unavailable" : "Connect to see balance"}</span>
            {side === "sell" && sell?.balance !== undefined && <button disabled={locked} className="text-neon" onClick={() => { invalidate(); setAmount(formatUnits(BigInt(sell.balance!), sell.decimals)); }}>Max</button>}
          </div>
        </div>
        <label className="flex items-center justify-between gap-3 text-xs text-secondary">Slippage tolerance<select aria-label="Slippage tolerance" disabled={locked} value={slippageBps} onChange={(e) => { invalidate(); setSlippage(Number(e.target.value)); }} className="min-h-9 rounded-md border border-border bg-surface px-2 text-foreground">{[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n / 100}%</option>)}</select></label>
        {account ? <div className="flex items-center justify-between gap-2 text-xs text-secondary"><span title={account}>{account.slice(0, 6)}…{account.slice(-4)}</span><button disabled={locked} onClick={() => { invalidate(); setAccount(undefined); setProvider(undefined); setChainId(undefined); }}>Disconnect</button></div> : <button disabled={locked} onClick={() => setPicker(!picker)} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm hover:border-neon"><Wallet size={15} /> Connect wallet</button>}
        {picker && !account && <div className="space-y-2 rounded-lg border border-border p-3">{wallets.map((w) => <button key={w.info.uuid} disabled={locked} onClick={() => void connect(w)} className="block min-h-10 w-full rounded-md bg-hover px-3 text-left text-sm">{w.info.name.slice(0, 60)}</button>)}{wallets.length === 0 && <p className="text-xs text-secondary">Open this page in your wallet’s browser or install an Ethereum browser wallet to connect.</p>}</div>}
      </div>
      <div className="min-w-0 space-y-3">
        <div className="flex items-center justify-between"><span className="text-xs text-secondary">{review ? "Review trade" : "Estimated received"}</span><button aria-label="Refresh trade quote" disabled={locked || !baseAmount} onClick={() => { invalidate(); void preview.refetch(); }} className="rounded-md p-2 text-muted hover:text-neon"><RefreshCw size={14} className={preview.isFetching ? "animate-spin" : ""} /></button></div>
        <p className={`break-all font-mono text-2xl ${expired ? "text-muted" : "text-foreground"}`} title={quote ? formatUnits(BigInt(quote.buyAmount), quote.buyDecimals) : undefined}>{quote ? amountText(quote.buyAmount, quote.buyDecimals) : "Enter an amount"}<span className="ml-2 text-sm text-secondary">{quote ? outputSymbol : ""}</span></p>
        {quote && <dl className="space-y-2 text-xs">
          <div className="flex justify-between gap-3"><dt className="text-muted">Minimum received</dt><dd className="text-right font-mono" title={formatUnits(BigInt(quote.minBuyAmount), quote.buyDecimals)}>{amountText(quote.minBuyAmount, quote.buyDecimals)} {outputSymbol}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Route</dt><dd className="max-w-[70%] text-right text-secondary">{quote.provider} · {quote.routes.join(" / ")}</dd></div>
          {quote.fees.map((fee, i) => <div key={i} className="flex justify-between gap-3"><dt className="text-muted">{fee.label}</dt><dd className="break-all text-right" title={fee.token}>{sameAddress(fee.token, quote.buyToken) ? `${amountText(fee.amount, quote.buyDecimals)} ${outputSymbol}` : sameAddress(fee.token, quote.sellToken) ? `${amountText(fee.amount, quote.sellDecimals)} ${inputSymbol}` : `${fee.amount} base units (${fee.token.slice(0, 8)}…)`}</dd></div>)}
          <div className="flex justify-between gap-3"><dt className="text-muted">Network gas</dt><dd>{prepared ? `Up to ${amountText(prepared.fee, 18)} ETH` : "Calculated at review"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Quote</dt><dd className={expired ? "text-negative" : "text-secondary"}>{expired ? "Expired — refresh" : `${Math.min(60, Math.max(0, Math.ceil((quote.expiresAt - now) / 1000)))}s remaining`}</dd></div>
        </dl>}
        {(error || amountError || insufficient || assets.error || preview.error) && <p role="alert" className="break-words rounded-lg border border-negative/20 bg-negative/5 p-3 text-xs text-negative">{error || amountError || (insufficient ? `Insufficient ${inputSymbol} balance.` : assets.error ? readable(assets.error) : readable(preview.error))}</p>}
        {wrongChain ? <button disabled={locked} onClick={() => void switchChain()} className="min-h-11 w-full rounded-lg bg-neon px-3 text-sm font-semibold text-black">Switch to Robinhood Chain</button> : assets.data?.executionEnabled ? <button disabled={locked || !account || !baseAmount || Boolean(insufficient) || (Boolean(review) && expired)} onClick={() => void (prepared && review ? confirm() : prepareReview())} className="min-h-11 w-full rounded-lg bg-neon px-3 text-sm font-semibold text-black disabled:opacity-40">{busy || (receipt?.status === "pending" ? "Waiting for confirmation…" : !account ? "Connect wallet to trade" : prepared?.action === "reset" ? "Reset token allowance" : prepared?.action === "approve" ? `Approve ${inputSymbol}` : prepared ? "Confirm swap in wallet" : "Review trade")}</button> : quote && !expired ? <a href={umbraLink(input)} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-neon px-3 text-sm font-semibold text-black">Continue on Umbra <ArrowUpRight size={15} /></a> : <p className="text-xs text-muted">{preview.isFetching ? "Finding a live route…" : "Enter an amount to check live liquidity."}</p>}
        {review && <button disabled={locked} onClick={invalidate} className="min-h-8 w-full text-xs text-secondary">{expired ? "Refresh review" : "Back to quote"}</button>}
        {prepared && prepared.action !== "swap" && <p className="text-xs text-secondary">{prepared.action === "reset" ? "This token needs its existing allowance reset before an exact approval." : `Approve only ${amount} ${inputSymbol} for 0x AllowanceHolder.`} The swap needs a separate confirmation after approval.</p>}
        {assets.data && !assets.data.executionEnabled && <p className="text-xs leading-relaxed text-muted">Live quote preview. In-app execution is coming soon. Umbra will refresh the price before you trade there.</p>}
        {receipt && <div role="status" className="rounded-lg border border-border p-3 text-xs"><p>{receipt.action === "swap" ? "Swap" : "Token approval"}: {receipt.status === "success" ? "confirmed" : receipt.status}.</p><a className="mt-1 inline-flex items-center gap-1 text-neon" href={`${robinhood.blockExplorers.default.url}/tx/${receipt.hash}`} target="_blank" rel="noopener noreferrer">View transaction <ArrowUpRight size={12} /></a>{receipt.status === "pending" && <button className="ml-3 text-secondary" onClick={() => void checkReceipt(receipt)}>Check status</button>}{receipt.status === "success" && receipt.action !== "swap" && <p className="mt-2 text-secondary">Review a fresh quote to continue.</p>}</div>}
      </div>
    </div>
  </section>;
}
