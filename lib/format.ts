/** Number / time formatting shared by server and client. */

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) < 1000) return Math.round(n).toString();
  return compactFormatter.format(n);
}

export function formatUsd(n: number | null | undefined, opts?: { compact?: boolean }): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (opts?.compact === false || abs < 1000) {
    const digits = abs < 10 ? 2 : 0;
    return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;
  }
  return `${sign}$${compactFormatter.format(abs)}`;
}

export function formatUsdSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  const body = formatUsd(Math.abs(n));
  return n > 0 ? `+${body}` : `-${body}`;
}

export function formatPct(n: number | null | undefined, opts?: { signed?: boolean; digits?: number }): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const digits = opts?.digits ?? 1;
  const body = `${Math.abs(n).toFixed(digits)}%`;
  if (opts?.signed === false) return body;
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}

/** Prices: adaptive precision so micro-cap tokens stay readable. */
export function formatPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  const sig = n.toPrecision(3);
  return `$${Number.parseFloat(sig).toString()}`;
}

export function formatTokenAmount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return "—";
  if (n >= 1000) return compactFormatter.format(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function shortAddress(addr: string, chars = 4): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}

export function relativeTime(input: string | Date | number, now: number = Date.now()): string {
  const t = typeof input === "number" ? input : new Date(input).getTime();
  const diff = Math.max(0, now - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

export function relativeTimeLong(input: string | Date | number, now: number = Date.now()): string {
  const short = relativeTime(input, now);
  return short === "0s" ? "just now" : `${short} ago`;
}

export function formatRating(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(1);
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}
