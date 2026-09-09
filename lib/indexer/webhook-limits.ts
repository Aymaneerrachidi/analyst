export const RPC_COSTS: Record<string, number> = { eth_chainId: 5, eth_blockNumber: 10, eth_getTransactionReceipt: 20, eth_getBlockByNumber: 20, eth_getBlockByHash: 20, eth_getCode: 20, eth_call: 26 };

export function rpcCost(body: string) {
  const parsed = JSON.parse(body);
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length !== 1 || !RPC_COSTS[calls[0]?.method]) throw new Error('RPC method outside webhook budget');
  return RPC_COSTS[calls[0].method];
}

/** Single lane, no automatic retries or batches; at most 87 CU/s for allowed calls. */
export function rpcGate(reserve: (cu: number) => Promise<void>, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  let lane = Promise.resolve();
  return (body: string) => {
    const cost = rpcCost(body);
    const task = lane.then(async () => { await wait(350); await reserve(cost); });
    lane = task.catch(() => undefined);
    return task;
  };
}

export function withinBudget(daily: number, monthly: number, next: number, dailyLimit: number, monthlyLimit: number) {
  return [daily, monthly, next, dailyLimit, monthlyLimit].every(Number.isFinite) && daily >= 0 && monthly >= 0 && next >= 0 && daily + next <= dailyLimit && monthly + next <= monthlyLimit;
}
