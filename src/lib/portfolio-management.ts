/**
 * Pure validation and normalization rules for the portfolio manager
 * (metadata + item ordering). No I/O in this module; route handlers and
 * server actions compose these with Supabase calls.
 *
 * Migration 20261026000800 mirrors the ORDERING and the year/tags
 * limits at the database trust boundary, so a caller that bypasses the
 * API still cannot break ordering or smuggle unbounded year/tags:
 *   - year      → portfolio_items_year_range CHECK (1850..2100, nullable)
 *   - tags      → trg_portfolio_items_normalize_tags (lowercase, trimmed,
 *                 1..30 chars, deduped, max 12) + cardinality CHECK
 *   - position  → trg_portfolio_items_allocate_position (every insert
 *                 appends under the owner profile lock) and the
 *                 move_portfolio_item(p_item_id, p_direction) RPC, the
 *                 only ordering mutation available to callers.
 * Title/description bounds are enforced ONLY here at the API level; the
 * database accepts any non-null title text.
 *
 * DB function contract (for callers of this module):
 *   public.move_portfolio_item(p_item_id uuid, p_direction text)
 *     returns boolean — true when the item swapped with its neighbor,
 *     false when it is already at the list edge (no-op). Raises 42501
 *     when unauthenticated, when the item is missing, or when it
 *     belongs to another artist; raises on an invalid direction.
 */

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const YEAR_MIN = 1850;
export const YEAR_MAX = 2100;
export const TAG_MAX = 30;
export const TAGS_MAX = 12;
/** Same bound the #20 upload path enforces on per-asset alt text. */
export const ALT_TEXT_MAX = 2000;

export type ItemMetadata = {
  title: string;
  description: string | null;
  year: number | null;
  tags: string[];
};

export type ItemMetadataPatch = {
  title?: string;
  description?: string | null;
  year?: number | null;
  tags?: string[];
};

export type ParseOk<T> = { ok: true; value: T };
export type ParseFail = { ok: false; problem: string };
export type ParseResult<T> = ParseOk<T> | ParseFail;

const fail = (problem: string): ParseFail => ({ ok: false, problem });

const METADATA_KEYS = new Set(["title", "description", "year", "tags"]);
const MOVE_KEYS = new Set(["itemId", "direction"]);

/**
 * Unknown keys are rejected, not silently dropped: a body carrying
 * e.g. profile_id or published must never reach an update path where a
 * future refactor could start honoring it.
 */
function unsupportedKeyProblem(body: Record<string, unknown>, allowed: Set<string>): string | null {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return `Unsupported field: ${key}`;
  }
  return null;
}

/** tags must be an array whose entries are ALL strings (null/absent clears). */
function tagsProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return "Tags must be an array of strings";
  if (value.some((entry) => typeof entry !== "string")) {
    return "Tags must be an array of strings";
  }
  return null;
}

/**
 * JSON request bodies must be a plain object. null, arrays, strings and
 * other scalars are rejected here instead of exploding on property
 * access — the shape the personal-portfolio routes got wrong.
 */
export function isJsonObject(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

/**
 * App-side mirror of trg_portfolio_items_normalize_tags: lowercase,
 * trimmed, 1..TAG_MAX chars, deduplicated (first occurrence wins),
 * capped at TAGS_MAX. Non-string entries are ignored.
 */
export function normalizeTags(input: readonly unknown[]): string[] {
  const kept: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (tag.length >= 1 && tag.length <= TAG_MAX && !kept.includes(tag)) {
      kept.push(tag);
    }
  }
  return kept.slice(0, TAGS_MAX);
}

/**
 * null/undefined clears the year. Integers (or digit strings that parse
 * to integers) must fall inside YEAR_MIN..YEAR_MAX. Booleans, arrays,
 * floats and NaN are problems, never silent coercions.
 */
export function yearProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  let year: number;
  if (typeof value === "number") {
    year = value;
  } else if (typeof value === "string" && /^\d{1,4}$/.test(value.trim())) {
    year = Number(value.trim());
  } else {
    return `Year must be a whole number between ${YEAR_MIN} and ${YEAR_MAX}`;
  }
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
    return `Year must be a whole number between ${YEAR_MIN} and ${YEAR_MAX}`;
  }
  return null;
}

/** The year value that will be stored, or null when cleared/absent. */
export function parseYear(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  return Number(String(value).trim());
}

/** Required non-blank title up to TITLE_MAX chars; trimmed. */
export function titleProblem(value: unknown): string | null {
  if (typeof value !== "string") return "Title is required";
  const title = value.trim();
  if (title.length === 0) return "Title is required";
  if (title.length > TITLE_MAX) return `Title must be at most ${TITLE_MAX} characters`;
  return null;
}

/** Optional description; null clears it, strings are length-bounded. */
export function descriptionProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "Description must be text";
  if (value.length > DESCRIPTION_MAX) {
    return `Description must be at most ${DESCRIPTION_MAX} characters`;
  }
  return null;
}

/** Validates the full create-item body: { title, description?, year?, tags? } and nothing else. */
export function parseItemCreate(body: unknown): ParseResult<ItemMetadata> {
  if (!isJsonObject(body)) return fail("Request body must be a JSON object");
  const unsupported = unsupportedKeyProblem(body, METADATA_KEYS);
  if (unsupported) return fail(unsupported);
  const problem =
    titleProblem(body.title) ??
    descriptionProblem(body.description) ??
    yearProblem(body.year) ??
    tagsProblem(body.tags);
  if (problem) return fail(problem);
  return {
    ok: true,
    value: {
      title: (body.title as string).trim(),
      description:
        typeof body.description === "string" && body.description.length > 0
          ? body.description
          : null,
      year: parseYear(body.year),
      tags: Array.isArray(body.tags) ? normalizeTags(body.tags) : [],
    },
  };
}

/**
 * Validates a patch body. Only the four metadata keys are recognized;
 * anything else (including writable-looking keys like published or
 * profile_id) is rejected, and a body with no recognized key at all is
 * a problem so the route can answer 400 instead of a no-op UPDATE.
 */
export function parseItemPatch(body: unknown): ParseResult<ItemMetadataPatch> {
  if (!isJsonObject(body)) return fail("Request body must be a JSON object");
  const unsupported = unsupportedKeyProblem(body, METADATA_KEYS);
  if (unsupported) return fail(unsupported);
  const patch: ItemMetadataPatch = {};
  if (body.title !== undefined) {
    const problem = titleProblem(body.title);
    if (problem) return fail(problem);
    patch.title = (body.title as string).trim();
  }
  if (body.description !== undefined) {
    const problem = descriptionProblem(body.description);
    if (problem) return fail(problem);
    patch.description =
      body.description === null || typeof body.description !== "string" || body.description === ""
        ? null
        : body.description;
  }
  if (body.year !== undefined) {
    const problem = yearProblem(body.year);
    if (problem) return fail(problem);
    patch.year = parseYear(body.year);
  }
  if (body.tags !== undefined) {
    const problem = tagsProblem(body.tags);
    if (problem) return fail(problem);
    patch.tags = Array.isArray(body.tags) ? normalizeTags(body.tags) : [];
  }
  if (Object.keys(patch).length === 0) return fail("No fields to update");
  return { ok: true, value: patch };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID string (route params and body ids). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Validates the move body: { itemId: uuid, direction: 'up' | 'down' } and nothing else. */
export function parseMoveRequest(
  body: unknown,
): ParseResult<{ itemId: string; direction: "up" | "down" }> {
  if (!isJsonObject(body)) return fail("Request body must be a JSON object");
  const unsupported = unsupportedKeyProblem(body, MOVE_KEYS);
  if (unsupported) return fail(unsupported);
  const { itemId, direction } = body as { itemId?: unknown; direction?: unknown };
  if (typeof itemId !== "string" || !UUID_RE.test(itemId)) {
    return fail("itemId must be a valid item id");
  }
  if (direction !== "up" && direction !== "down") {
    return fail("direction must be 'up' or 'down'");
  }
  return { ok: true, value: { itemId, direction } };
}

export type OrderedItem = { id: string; position: number; created_at: string };

/**
 * The deterministic per-owner item order used by every read path:
 * position first, then created_at, then id as the final tie-break so
 * the list never flickers between equally-ranked rows.
 */
export function compareItemOrder(a: OrderedItem, b: OrderedItem): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Sorts (a copy of) items into the deterministic owner order. */
export function sortOwnerItems<T extends OrderedItem>(items: readonly T[]): T[] {
  return [...items].sort(compareItemOrder);
}
