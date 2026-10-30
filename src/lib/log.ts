/**
 * Structured logging: exactly one JSON line per event, written to stdout
 * so Vercel runtime logs pick it up. No third-party sink (leadership
 * decision).
 *
 * PRIVACY CONTRACT (enforced by tests):
 * - NEVER log file contents, filenames, or media metadata beyond size-free facts.
 * - NEVER log personal information beyond the authenticated user id
 *   (a random UUID). No emails, names, handles, IPs, or user agents.
 * - NEVER log any key, token, password, or secret value.
 *
 * Only these fields ever leave this module:
 *   event, route, status, reason?, userId?
 */

export type LogEvent = {
  /** Machine-readable event name, e.g. "media_upload_failed". */
  event: string;
  /** API route path, e.g. "/api/media/upload". */
  route: string;
  /** HTTP status code returned to the caller. */
  status: number;
  /** Short stable reason code, e.g. "rls_denied" or "invalid_content". No free text. */
  reason?: string;
  /** Authenticated user id (UUID) or null for anonymous callers. */
  userId?: string | null;
};

/**
 * Reason codes used across routes. Keep this closed: a new code means a
 * deliberate decision about what it may and may not carry.
 */
export const LogReason = {
  unauthenticated: "unauthenticated",
  ownershipDenied: "ownership_denied",
  invalidContent: "invalid_content",
  invalidRequest: "invalid_request",
  storageError: "storage_error",
  upstreamError: "upstream_error",
} as const;
export type LogReasonCode = (typeof LogReason)[keyof typeof LogReason];

/** Allowed keys of a structured log line; anything else is dropped. */
const ALLOWED_KEYS = ["event", "route", "status", "reason", "userId"] as const;

/**
 * Redact to the allow-list and serialize to one compact JSON line.
 * Exported for tests: serialization is the security boundary, so the
 * tests assert on its output rather than on console side effects.
 */
export function serializeLogLine(e: LogEvent): string {
  const line: Record<string, string | number> = {};
  for (const key of ALLOWED_KEYS) {
    const value = e[key as keyof LogEvent];
    if (value !== undefined && value !== null && value !== "") {
      line[key] = value;
    }
  }
  return JSON.stringify(line);
}

/** Emit one structured log line to stdout (Vercel runtime logs). */
export function logApiEvent(e: LogEvent): void {
  console.log(serializeLogLine(e));
}
