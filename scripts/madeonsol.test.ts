import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMadeTrade } from '../lib/providers/madeonsol';
import { receiptSupportsTrade } from '../lib/providers/receipt-direction';
const trade={chain:'robinhood',evm_address:'0x'+'1'.repeat(40),token_address:'0x'+'2'.repeat(40),tx_hash:'0x'+'3'.repeat(64),action:'sell',traded_at:'2026-09-01T12:00:00+00:00',token_amount:10,price_usd_at_trade:2};
test('provider records preserve historical price and side; never use current market cap for price',()=>{
  assert.equal(parseMadeTrade(trade)?.side,'SELL');assert.equal(parseMadeTrade(trade)?.amountUsd,20);
  assert.equal(parseMadeTrade({...trade,price_usd_at_trade:null,current_mc_usd:1000000})?.price,undefined);
  assert.equal(parseMadeTrade({...trade,chain:'solana'}),null);
  assert.equal(parseMadeTrade({...trade,tx_hash:'not-a-transaction'}),null);
  assert.equal(parseMadeTrade({...trade,traded_at:'2099-01-01T00:00:00Z'}),null);
});

test('wallet attribution excludes intermediate router tokens, reverted receipts and opposite flows',()=>{
  const parsed=parseMadeTrade({...trade,action:'buy'})!;
  const topic=(address:string)=>'0x'+address.slice(2).padStart(64,'0');
  const router='0x'+'4'.repeat(40);
  const log={address:parsed.tokenAddress,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(router),topic(parsed.wallet)],data:'0x'+BigInt(10).toString(16).padStart(64,'0')};
  const receipt={status:'0x1',transactionHash:parsed.txHash,logs:[log]};
  assert.equal(receiptSupportsTrade(receipt,parsed),true);
  assert.equal(receiptSupportsTrade({...receipt,status:'0x0'},parsed),false);
  assert.equal(receiptSupportsTrade({...receipt,logs:[{...log,topics:[log.topics[0],topic(router),topic('0x'+'5'.repeat(40))]}]},parsed),false);
  assert.equal(receiptSupportsTrade(receipt,{...parsed,side:'SELL'}),false);
  assert.equal(receiptSupportsTrade({...receipt,transactionHash:'0x'+'6'.repeat(64)},parsed),false);
});
