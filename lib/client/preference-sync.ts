'use client';
// Serialize writes from this tab so a slower older request cannot replace the latest state.
let queue = Promise.resolve();
export function savePreferences(body: Record<string, unknown>) {
  queue = queue.catch(() => undefined).then(async () => {
    try { const response = await fetch('/api/preferences', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); window.dispatchEvent(new CustomEvent('analyst:save-status', { detail: response.ok ? 'saved' : 'local-only' })); }
    catch { window.dispatchEvent(new CustomEvent('analyst:save-status', { detail: 'local-only' })); }
  });
  return queue;
}
