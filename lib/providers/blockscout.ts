import "server-only";
import { z } from "zod";
import { v2Config } from "@/lib/v2/config";
import { sharedLoad } from "@/lib/v2/shared-cache";
import { logEvent } from "@/lib/v2/log";
const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v => v.toLowerCase());
const addressRef = z.object({ hash: addr, is_contract: z.boolean().optional(), name: z.string().max(160).nullish() });
const addressResponse = z.object({ hash: addr, creator_address_hash: addr.nullish(), creation_transaction_hash: z.string().nullish(), is_contract: z.boolean().optional(), coin_balance: z.string().nullish() });
const holdersResponse = z.object({ items: z.array(z.object({ address: addressRef, value: z.string().regex(/^\d+$/), token_id: z.string().nullish() })).max(100), next_page_params: z.unknown().optional() });
const transactionsResponse = z.object({ items: z.array(z.object({ hash: z.string(), from: addressRef, to: addressRef.nullish(), value: z.string().regex(/^\d+$/), timestamp: z.string(), status: z.string().nullish() })).max(100), next_page_params: z.unknown().optional() });
const sourceResponse = z.object({ is_verified: z.boolean().optional(), abi: z.array(z.record(z.string(), z.unknown())).nullish(), proxy_type: z.string().nullish(), implementations: z.array(z.unknown()).optional() });
async function request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const key = process.env.BLOCKSCOUT_PRO_API_KEY;
  const base = key ? 'https://api.blockscout.com/4663/api/v2' : v2Config().BLOCKSCOUT_API_URL.replace(/\/$/, '');
  const target = new URL(`${base}/${path}`);
  if (key) target.searchParams.set('apikey', key);
  const url = target.href;
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000), cache: 'no-store' });
  if (!response.ok) { logEvent('BLOCKSCOUT', 'request_failed', { status: response.status }); throw new Error('Explorer request unavailable'); }
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('Explorer response too large');
  return schema.parse(JSON.parse(text));
}
export const explorerAddress = (address: string) => sharedLoad(`explorer:address:${addr.parse(address)}`, 3_600_000, () => request(`addresses/${address}`, addressResponse));
export const explorerHolders = (address: string) => sharedLoad(`explorer:holders:${addr.parse(address)}`, 300_000, () => request(`tokens/${address}/holders`, holdersResponse));
export const explorerTransactions = (address: string) => sharedLoad(`explorer:transactions:${addr.parse(address)}`, 120_000, () => request(`addresses/${address}/transactions`, transactionsResponse));
export const explorerContract = (address: string) => sharedLoad(`explorer:contract:${addr.parse(address)}`, 86_400_000, () => request(`smart-contracts/${address}`, sourceResponse));
