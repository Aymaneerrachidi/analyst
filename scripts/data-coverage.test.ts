import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePaprikaCandles } from '../lib/providers/dexpaprika';
import { parseResearchMessage } from '../lib/services/token-research';

test('candles reject malformed OHLC, future timestamps and non-finite prices',()=>{
  const now=Date.parse('2026-09-10T12:00:00Z');
  const p={time_open:'2026-09-10T11:00:00Z',open:2,high:3,low:1,close:2.5,volume:20};
  assert.equal(parsePaprikaCandles([p,p],now-86400000,now).length,1);
  assert.equal(parsePaprikaCandles([{...p,high:1}],now-86400000,now).length,0);
  assert.equal(parsePaprikaCandles([{...p,time_open:'2026-09-11T11:00:00Z'}],now-86400000,now).length,0);
  assert.equal(parsePaprikaCandles([{...p,close:Infinity}],now-86400000,now).length,0);
});
test('research cannot display a different conversation request or token',()=>{
  const requestId='fe94cd34-2c07-45a6-a495-e805683e710f',token='0x1111111111111111111111111111111111111111';
  const report={requestId,token,summary:'Recorded activity only.',observations:[],risks:['Incomplete history'],confidence:'low'};
  assert.ok(parseResearchMessage(JSON.stringify(report),requestId,token));
  assert.equal(parseResearchMessage(JSON.stringify(report),'aa94cd34-2c07-45a6-a495-e805683e710f',token),null);
  assert.equal(parseResearchMessage(JSON.stringify(report),requestId,'0x2222222222222222222222222222222222222222'),null);
  assert.equal(parseResearchMessage('Unstructured private conversation text',requestId,token),null);
});
