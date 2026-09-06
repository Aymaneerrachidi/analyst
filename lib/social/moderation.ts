import { createHash } from "node:crypto";

export const MAX_BODY_LENGTH = 500;

const URL_RE = /(https?:\/\/|www\.)[^\s]+/gi;
const SPAM_PHRASES = [
  "free money",
  "claim airdrop",
  "airdrop claim",
  "dm me",
  "send me",
  "guaranteed profit",
  "100x guaranteed",
  "wallet drainer",
  "seed phrase",
  "private key",
  "telegram.me",
  "t.me/",
  "whatsapp",
  "onlyfans",
  "casino",
];
const BLOCKED_TERMS = ["nigg", "faggot", "kike", "chink", "tranny"];

export type ModerationResult = { ok: true; body: string; bodyHash: string } | { ok: false; error: string };

/** Rejects ASCII control characters (except tab/newline) and C1 controls; everything else is allowed. */
function hasDisallowedCharacters(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a) continue;
    if (cp < 0x20) return true;
    if (cp >= 0x7f && cp <= 0x9f) return true;
  }
  return false;
}

/**
 * Server-side content policy. Deliberately conservative: it strips nothing silently and
 * returns a human-readable reason so the composer can explain what to change.
 */
export function moderateContent(raw: string): ModerationResult {
  const body = raw.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (body.length === 0) return { ok: false, error: "Write something first." };
  if (body.length > MAX_BODY_LENGTH) return { ok: false, error: `Keep it under ${MAX_BODY_LENGTH} characters.` };
  if (hasDisallowedCharacters(body)) return { ok: false, error: "Unsupported characters." };

  const urls = body.match(URL_RE) ?? [];
  if (urls.length > 1) return { ok: false, error: "One link per message, please." };

  const letters = body.replace(/[^A-Za-z]/g, "");
  if (letters.length > 40) {
    const upper = letters.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length > 0.8) return { ok: false, error: "Easy on the caps lock." };
  }
  if (/(.)\1{9,}/.test(body)) return { ok: false, error: "That looks like spam." };

  const lower = body.toLowerCase();
  if (SPAM_PHRASES.some((p) => lower.includes(p))) return { ok: false, error: "That looks like spam or a scam." };
  if (BLOCKED_TERMS.some((p) => lower.includes(p))) return { ok: false, error: "That language is not allowed here." };

  const normalized = lower.replace(/\s+/g, " ").trim();
  const bodyHash = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return { ok: true, body, bodyHash };
}

const REPORT_REASONS = ["spam", "scam", "harassment", "misinformation", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const reportReasons: readonly ReportReason[] = REPORT_REASONS;
