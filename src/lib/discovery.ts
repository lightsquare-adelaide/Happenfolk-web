/**
 * Pure discovery query rules shared by the /discover UI (S3), the view
 * recording API (S2) and the search RPCs added in migration
 * 20261027000100_discovery_trending_search.sql.
 *
 * The bounds here MIRROR the database-side bounds exactly, so the API
 * layer can reject bad input before it reaches Postgres while the RPCs
 * remain independently safe against direct callers:
 *   - query: trimmed; empty/whitespace becomes null (browse mode);
 *     longer than 200 BYTES is rejected (QUERY_TOO_LONG, matching the
 *     octet_length guard in the RPCs).
 *   - limit: clamped to 1..100, default 24 (matching least(greatest(...))).
 *
 * Dependency-free and DB-free on purpose: unit-tested by `npm test`.
 */

export const DISCOVERY_QUERY_MAX_BYTES = 200;
export const DISCOVERY_LIMIT_DEFAULT = 24;
export const DISCOVERY_LIMIT_MIN = 1;
export const DISCOVERY_LIMIT_MAX = 100;

const encoder = new TextEncoder();

/** Byte length of a string in UTF-8 — the unit the RPCs bound on. */
export function discoveryQueryByteLength(query: string): number {
  return encoder.encode(query).length;
}

/**
 * Clamps a caller-supplied limit into the same 1..100 window the search
 * RPCs enforce, falling back to the default of 24 for null/undefined/NaN.
 */
export function clampDiscoveryLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined || !Number.isFinite(limit)) {
    return DISCOVERY_LIMIT_DEFAULT;
  }
  return Math.min(Math.max(Math.trunc(limit), DISCOVERY_LIMIT_MIN), DISCOVERY_LIMIT_MAX);
}

/** Trims a raw query; empty/whitespace-only input becomes null (browse). */
export function normalizeDiscoveryQuery(query: string | null | undefined): string | null {
  if (query === null || query === undefined) return null;
  const trimmed = query.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export type DiscoveryQueryValidation =
  | { ok: true; query: string | null }
  | { ok: false; reason: "QUERY_TOO_LONG" };

/**
 * Normalizes and validates a raw query string. Rejection uses the SAME
 * error name the RPCs raise, so one API error mapping covers both paths.
 */
export function validateDiscoveryQuery(
  query: string | null | undefined,
): DiscoveryQueryValidation {
  const normalized = normalizeDiscoveryQuery(query);
  if (normalized !== null && discoveryQueryByteLength(normalized) > DISCOVERY_QUERY_MAX_BYTES) {
    return { ok: false, reason: "QUERY_TOO_LONG" };
  }
  return { ok: true, query: normalized };
}

/** Coerces an unknown category filter value; null means "all categories". */
export function normalizeDiscoveryCategory(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32767) return null;
  return parsed;
}

// ---------------------------------------------------------------------------
// Page-level helpers shared by /, /artists and /discover.
// ---------------------------------------------------------------------------

type RawParam = string | string[] | undefined;

function firstParam(value: RawParam): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type DiscoverParams = {
  /** Normalized query; null means browse mode. */
  query: string | null;
  /** True when the raw query was rejected as too long (and is dropped). */
  queryTooLong: boolean;
  /** Category id, or null for every category. */
  categoryId: number | null;
};

/** Reads ?q= and ?category= defensively; garbage degrades to browse mode. */
export function parseDiscoverParams(params: Record<string, RawParam>): DiscoverParams {
  const validation = validateDiscoveryQuery(firstParam(params.q));
  return {
    query: validation.ok ? validation.query : null,
    queryTooLong: !validation.ok,
    categoryId: normalizeDiscoveryCategory(firstParam(params.category)),
  };
}

/** Canonical /discover URL for a query and category (omits empty parts). */
export function discoverHref(query: string | null, categoryId: number | null): string {
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (categoryId !== null) search.set("category", String(categoryId));
  const text = search.toString();
  return text ? `/discover?${text}` : "/discover";
}

/** Canonical /artists URL; page 1 is the bare URL. */
export function artistsHref(categoryId: number | null, page = 1): string {
  const search = new URLSearchParams();
  if (categoryId !== null) search.set("category", String(categoryId));
  if (page > 1) search.set("page", String(page));
  const text = search.toString();
  return text ? `/artists?${text}` : "/artists";
}

/** 1-based page number from ?page=; anything unusable is page 1. */
export function parsePage(value: RawParam): number {
  const parsed = Number(firstParam(value));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) return 1;
  return parsed;
}

/** Up to two capital letters for an avatar placeholder; "?" when empty. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : words.slice(0, 2).map((w) => [...w][0]);
  return letters.join("").toUpperCase();
}
