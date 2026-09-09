'use client';
import { useEffect, useState } from 'react';
import { readTracking } from '@/lib/client/tracking-store';
import { savePreferences } from '@/lib/client/preference-sync';

export function PreferenceStatus() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const listener = (event: Event) => setFailed((event as CustomEvent).detail === 'local-only');
    window.addEventListener('analyst:save-status', listener);
    // Migrate existing browser choices once; no empty profile writes on ordinary visits.
    void (async () => {
      try {
        if (localStorage.getItem('analyst:preferences-migrated')) return;
        const tracking = readTracking();
        const watch = JSON.parse(localStorage.getItem('analyst:watchlist:v1') ?? '[]');
        const watchlist = Array.isArray(watch) ? watch.map(t => t?.address).filter(a => typeof a === 'string' && /^0x[\da-f]{40}$/i.test(a)).slice(0, 200) : [];
        if (!tracking.following.length && !tracking.rules.length && !watchlist.length) return;
        const result = await fetch('/api/preferences');
        if (!result.ok) return;
        const existing = await result.json();
        if (!existing.saved) await savePreferences({ follows: tracking.following.map(t => t.id), rules: tracking.rules, watchlist });
        // The readback confirms persistence before marking the migration complete.
        const check = await fetch('/api/preferences');
        if (check.ok && (await check.json()).saved) localStorage.setItem('analyst:preferences-migrated', '1');
      } catch { /* Local storage remains the fallback; explicit writes show their status. */ }
    })();
    return () => window.removeEventListener('analyst:save-status', listener);
  }, []);
  return failed ? <p role="status" className="border-b border-warning/30 bg-surface px-4 py-2 text-center text-xs text-warning">Your latest preferences are saved only in this browser. Server sync failed; retry your change when the connection returns.</p> : null;
}
