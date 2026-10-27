/**
 * Server-side view-recording rules for POST /api/views (S2).
 *
 * Ported from the personal-version src/lib/view-throttle.ts with the two
 * corrections the team review required:
 *
 * 1. HASHED, PER-VISITOR keys. The source keyed its in-memory window on
 *    the IP /24-/48-prefix, which suppresses a whole subnet globally.
 *    Here the key is a truncated SHA-256 over (client IP, User-Agent,
 *    subject): one visitor + one subject, no subnet-wide suppression,
 *    and the raw IP/UA never sit in memory as plaintext map keys or in
 *    any log line.
 * 2. BOUNDED growth: entries expire after the window, a periodic prune
 *    keeps the map small, and a hard entry cap evicts the oldest keys so
 *    a flood of distinct identities cannot exhaust server memory.
 *
 * This layer is a courtesy filter for honest traffic (refresh loops,
 * re-renders). The AUTHORITY remains the database: record_page_view's
 * 30-minute per-identity dedupe, subject-scoped visitor hash and
 * transaction advisory lock (migration 20261026000600, unchanged). The
 * anon key is public, so a scripted caller talking to PostgREST directly
 * bypasses this module entirely — that residual risk is documented, not
 * silently "fixed" here.
 *
 * SERVER ONLY: imports node:crypto. Never import from client components.
 */

import { createHash } from "node:crypto";
import { isIP } from "node:net";

// ---------------- subject and body bounds ----------------

export const VIEW_SUBJECT_TYPES = ["event", "profile", "portfolio_item"] as const;
export type ViewSubjectType = (typeof VIEW_SUBJECT_TYPES)[number];

/** Hard cap on the raw request body of POST /api/views. */
export const VIEW_BODY_LIMIT_BYTES = 1024;
/** Longest User-Agent forwarded to the recorder; longer is treated as unusable. */
export const VIEW_USER_AGENT_LIMIT_BYTES = 512;
/** RFC 6943 bound for a textual IPv6 address (covers IPv4-mapped forms). */
export const VIEW_IP_LIMIT_CHARS = 45;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function isViewSubjectType(value: unknown): value is ViewSubjectType {
  return typeof value === "string" && (VIEW_SUBJECT_TYPES as readonly string[]).includes(value);
}

export function isViewSubjectId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ---------------- trusted proxy identity ----------------

/**
 * Forwarded-header trust modes:
 * - "vercel": running on Vercel (VERCEL=1). Vercel overwrites
 *   x-forwarded-for against spoofing and provides the dedicated
 *   x-vercel-forwarded-for client header (lead-verified against
 *   https://vercel.com/docs/headers/request-headers#x-forwarded-for).
 * - "proxy": self-hosted opt-in via VIEW_RECORDING_TRUST_FORWARDED_FOR=1.
 *   The operator MUST run a proxy that strips/overwrites client-supplied
 *   forwarded headers; this app never trusts them by default.
 * - "off": no trusted source — anonymous recording is SKIPPED (never
 *   collapsed onto the server's own fingerprint).
 */
export type ForwardedTrustMode = "vercel" | "proxy" | "off";

export function forwardedTrustMode(env: {
  VERCEL?: string | undefined;
  VIEW_RECORDING_TRUST_FORWARDED_FOR?: string | undefined;
}): ForwardedTrustMode {
  if (env.VERCEL === "1") return "vercel";
  if (env.VIEW_RECORDING_TRUST_FORWARDED_FOR === "1") return "proxy";
  return "off";
}

export function isValidClientIp(value: string): boolean {
  // Node's own parser (0 = not an IP); length-bounded before parsing so
  // pathological inputs never reach it.
  return (
    value.length > 0 &&
    value.length <= VIEW_IP_LIMIT_CHARS &&
    isIP(value) !== 0
  );
}

export function isValidForwardedUserAgent(value: string): boolean {
  return (
    value.length > 0 &&
    utf8ByteLength(value) <= VIEW_USER_AGENT_LIMIT_BYTES &&
    // Control characters would smuggle header content into the recorder.
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

/**
 * Extracts the client IP from the forwarded header of the configured
 * trust mode: leftmost entry (the client as seen by the nearest trusted
 * proxy), format- and length-validated. Returns null — meaning "skip
 * anonymous recording" — in untrusted mode or on any unusable value. A
 * client-supplied x-vercel-forwarded-for is NOT trusted merely because
 * its name looks trusted; it is only read when VERCEL=1, where the
 * platform overwrites it.
 */
export function trustedClientIp(
  headers: { get(name: string): string | null },
  mode: ForwardedTrustMode,
): string | null {
  if (mode === "off") return null;
  const raw =
    mode === "vercel"
      ? (headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for"))
      : headers.get("x-forwarded-for");
  const leftmost = raw?.split(",")[0]?.trim() ?? "";
  return isValidClientIp(leftmost) ? leftmost : null;
}

// ---------------- bounded body reading ----------------

/**
 * Reads at most `limitBytes` from the request body STREAM and cancels it
 * the moment the limit is exceeded — an oversized or endless body is
 * never fully buffered (the previous read-then-check shape had already
 * allocated the whole payload by the time it was rejected). Returns the
 * decoded body text, or null when the body is unreadable, malformed or
 * over the limit; the route maps null to a 400 without echoing details.
 */
export async function readBoundedBody(
  request: Request,
  limitBytes: number = VIEW_BODY_LIMIT_BYTES,
): Promise<string | null> {
  if (!request.body) {
    // No stream in this runtime: fall back, but keep the bound honest by
    // checking the decoded length (nothing larger can be constructed
    // without the runtime having buffered it first).
    const raw = await request.text().catch(() => null);
    if (raw === null) return null;
    return utf8ByteLength(raw) <= limitBytes ? raw : null;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > limitBytes) {
          await reader.cancel().catch(() => undefined);
          return null; // over limit: stop reading, drop the connection body
        }
        chunks.push(value);
      }
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }
  const decoder = new TextDecoder();
  let out = "";
  for (const chunk of chunks) out += decoder.decode(chunk, { stream: true });
  out += decoder.decode();
  return out;
}

// ---------------- bounded in-memory throttle ----------------

export const VIEW_THROTTLE_WINDOW_MS = 60_000;
export const VIEW_THROTTLE_MAX_ENTRIES = 10_000;
const PRUNE_EVERY = 256;

const hits = new Map<string, number>();
let callsSincePrune = 0;

/**
 * Truncated SHA-256 over the full identity + subject. Hashed so neither
 * the raw IP nor the UA is retained as a plaintext key; full-IP (not
 * prefix) so two visitors in one subnet never suppress each other.
 */
export function viewThrottleKey(
  subjectType: string,
  subjectId: string,
  clientIp: string,
  userAgent: string,
): string {
  return createHash("sha256")
    .update(`${clientIp}|${userAgent}|${subjectType}|${subjectId}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * True if this identity+subject may count a view right now. `now` is
 * injectable for tests. Prunes expired entries periodically and evicts
 * the oldest entries when the hard cap is hit, so the map stays bounded
 * under any traffic shape.
 */
export function anonViewAllowed(key: string, now: number = Date.now()): boolean {
  if (++callsSincePrune >= PRUNE_EVERY) {
    callsSincePrune = 0;
    for (const [k, at] of hits) {
      if (now - at >= VIEW_THROTTLE_WINDOW_MS) hits.delete(k);
    }
  }

  const last = hits.get(key);
  if (last !== undefined && now - last < VIEW_THROTTLE_WINDOW_MS) return false;

  if (hits.size >= VIEW_THROTTLE_MAX_ENTRIES) {
    // Insertion-ordered eviction: drop the oldest entry until under cap.
    for (const k of hits.keys()) {
      hits.delete(k);
      if (hits.size < VIEW_THROTTLE_MAX_ENTRIES) break;
    }
  }
  hits.set(key, now);
  return true;
}
