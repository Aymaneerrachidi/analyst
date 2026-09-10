import { z } from 'zod';
import type { UpstreamTrade } from './types';
const address=z.string().regex(/^0x[\da-f]{40}$/i).transform(v=>v.toLowerCase());
const value=z.number().finite().nonnegative().nullish();
export const madeTradeSchema=z.object({chain:z.literal('robinhood'),evm_address:address,token_address:address,tx_hash:z.string().regex(/^0x[\da-f]{64}$/i),action:z.enum(['buy','sell']),traded_at:z.string().datetime({offset:true}),token_amount:value,price_usd_at_trade:value,eth_amount:value,token_symbol:z.string().nullish(),token_name:z.string().nullish(),kol_name:z.string().nullish(),kol_twitter:z.string().url().nullish(),dex:z.string().nullish()});
export function parseMadeTrade(input:unknown):UpstreamTrade|null {
  const result=madeTradeSchema.safeParse(input);if(!result.success)return null;const r=result.data;
  if(Date.parse(r.traded_at)>Date.now()+60_000)return null;
  const quantity=r.token_amount&&r.token_amount>0?r.token_amount:undefined;
  const price=r.price_usd_at_trade&&r.price_usd_at_trade>0?r.price_usd_at_trade:undefined;
  const amountUsd=quantity&&price?quantity*price:undefined;
  if(amountUsd!==undefined&&!Number.isFinite(amountUsd))return null;
  return {id:`madeonsol:${r.tx_hash.toLowerCase()}:${r.evm_address}:${r.token_address}:${r.action}`,wallet:r.evm_address,tokenAddress:r.token_address,tokenSymbol:r.token_symbol||r.token_address.slice(0,8),tokenName:r.token_name??undefined,side:r.action==='buy'?'BUY':'SELL',timestamp:r.traded_at,txHash:r.tx_hash.toLowerCase(),tokenAmount:quantity,price,amountUsd,nativeAmount:r.eth_amount??undefined,dex:r.dex??'MadeOnSol'};
}
