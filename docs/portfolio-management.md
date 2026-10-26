# Portfolio management data contract (P1)

Migration `20261026000800_portfolio_item_order_metadata.sql` plus the pure
rules in `src/lib/portfolio-management.ts`. This document is the contract
P2 (API/UI) builds on; it describes actual signatures verified against the
local stack.

## Schema additions (`public.portfolio_items`)

| Column     | Type                  | Notes |
|------------|-----------------------|-------|
| `year`     | `smallint` NULL       | CHECK `year between 1850 and 2100` (`portfolio_items_year_range`). |
| `tags`     | `text[]` NOT NULL `{}`| Normalized by trigger; CHECK `cardinality(tags) <= 12` (`portfolio_items_tags_bounded`). |
| `position` | `integer` NOT NULL default 0 | Owner-scoped order. The default exists only so generated Insert types stay optional for direct inserts; the trigger always overwrites it. |

Read order (every list path must use exactly this total order):

```sql
order by position, created_at, id
```

Index: `portfolio_items_owner_order_idx (profile_id, position, created_at, id)`.

### Triggers

- `trg_portfolio_items_normalize_tags` — BEFORE INSERT OR UPDATE OF tags:
  lowercase, trim, drop empty/over-30-char entries, dedupe (first wins),
  cap at 12, `NULL` → `'{}'`. Mirrors `normalizeTags()` in the lib.
- `trg_portfolio_items_allocate_position` — BEFORE INSERT, **always**
  allocates `position = max(owner positions) + 1` under a `FOR UPDATE`
  lock on the owner's `profiles` row. A supplied position is overwritten:
  inserts can only append. This covers the existing #20 path
  (`createDraftItem()` inserts without a position) and any direct write.

### Privileges

- `UPDATE` on `portfolio_items` for `authenticated` is column-scoped:
  `(title, description, media_kind, published, published_at, year, tags)`.
  `position`, `id`, `profile_id`, `created_at`, `updated_at`,
  `search_vector` are NOT updatable directly; ordering goes through the
  RPC below. `INSERT`/`DELETE`/`SELECT` grants and RLS are unchanged.
- `move_portfolio_item` — `EXECUTE` revoked from `PUBLIC`/`anon`, granted
  to `authenticated`.

## RPC

```sql
public.move_portfolio_item(p_item_id uuid, p_direction text)
  returns boolean
```

SECURITY DEFINER, `search_path = ''`, no owner parameter — the scope is
always `auth.uid()`. Behaviour:

1. Raises `42501` (`not signed in`) when unauthenticated.
2. Raises `invalid direction` unless `p_direction` is `'up'` or `'down'`.
3. Locks the caller's `profiles` row (`FOR UPDATE`): one serialization
   point per owner for moves and append allocations; different owners
   never wait on each other.
4. Normalizes the caller's COMPLETE list — deterministic order
   `(position, created_at, id)` — to unique dense positions `0..n-1`.
   This repairs tied/gapped positions left by direct legacy writes; with
   >=3 tied rows a pair-only swap would corrupt the order, whole-list
   normalization cannot.
5. Raises `42501` (`work not owned`) when `p_item_id` is missing or
   belongs to another artist. Strangers learn nothing beyond denial.
6. Swaps positions with the adjacent row in the requested direction.
   Returns `true` when a swap happened, `false` at the list edge
   (idempotent no-op). Steps 4-6 still run the normalization at an edge.

Call from supabase-js:

```ts
const { data, error } = await supabase.rpc("move_portfolio_item", {
  p_item_id: itemId,
  p_direction: "up", // or "down"
});
// data: boolean (moved), error.code "42501" on denial
```

## Pure rules (`src/lib/portfolio-management.ts`)

API-level validation; the DB additionally enforces year/tags/ordering at
the trust boundary, but title/description bounds live ONLY here:

- Constants: `TITLE_MAX=120`, `DESCRIPTION_MAX=2000`, `YEAR_MIN=1850`,
  `YEAR_MAX=2100`, `TAG_MAX=30`, `TAGS_MAX=12`.
- `isJsonObject(body)` — rejects `null`, arrays and scalars.
- `normalizeTags(input: readonly unknown[])` — tolerant mirror of the DB
  trigger (skips non-strings).
- `yearProblem(value)` / `parseYear(value)` — null/undefined clears;
  integers or digit strings only; bounds inclusive.
- `titleProblem(value)` / `descriptionProblem(value)`.
- `parseItemCreate(body)` → `ParseResult<ItemMetadata>` where
  `ItemMetadata = { title, description: string | null, year: number | null,
  tags: string[] }`. Rejects unsupported keys (e.g. `profile_id`,
  `published`, `position`) and tags arrays containing non-strings.
- `parseItemPatch(body)` → `ParseResult<ItemMetadataPatch>`; same strict
  key allowlist (`title`, `description`, `year`, `tags`); empty patch is
  an error.
- `parseMoveRequest(body)` → `ParseResult<{ itemId, direction }>`; UUID
  check, direction allowlist, strict keys (`itemId`, `direction`).
- `compareItemOrder(a, b)` / `sortOwnerItems(items)` — the deterministic
  `(position, created_at, id)` total order for read paths.

## Tests

- Unit (in `npm test`): `src/lib/portfolio-management.spec.ts`.
- Real-stack integration: `npm run test:portfolio`
  (`tests/portfolio/`, excluded from the unit job, runs serially).
  - `01-append-and-move` — #20 `createDraftItem()` path, supplied-position
    smuggling, up/down moves, edge no-ops, invalid direction, year/tags
    trust boundary, direct `position` update refusal.
  - `02-ownership` — stranger/anon RPC denial (42501) with data-state
    assertions, RLS zero-row updates, `profile_id` reassignment refusal.
  - `03-tie-normalization` — admin-only tie fixtures with >=3 tied rows;
    whole-list dense normalization; unmoved relative order preserved.
  - `04-concurrency` — real lock waiters observed via `pg_blocking_pids`;
    serialized appends and double moves; foreign owners never queue.
    Red counterfactuals (restore in `afterAll`):
    `ACCESS_RED=portfolio-move-lock-removed`,
    `ACCESS_RED=portfolio-alloc-lock-removed`.

## HTTP API (P2)

All routes: origin-gated via `isSameOriginRequest` (403 `Cross-origin
requests are not allowed`), auth via `supabase.auth.getUser()` (401 `Sign
in first`), strict JSON-object bodies, friendly errors only (no raw
database/storage text), denials never leak existence (404 `Work not found
or not yours`).

- `POST /api/portfolio/items` — body `{ title, description?, year?, tags? }`
  → 201 `{ ok, item: { id, title, description, year, tags, position } }`.
  Position is DB-allocated (atomic append); client-supplied
  position/published/profile_id are rejected (`Unsupported field: …`).
- `PATCH /api/portfolio/items/[id]` — metadata-only patch (same four
  keys, strict allowlist) → 200 `{ ok, item }`. Empty patch → 400.
- `DELETE /api/portfolio/items/[id]` — whole-item lifecycle via
  `deleteItem` (below) → 200 `{ ok, deleted: true }`.
- `POST /api/portfolio/reorder` — `{ itemId, direction }` →
  200 `{ ok, moved: boolean }`; thin face over `move_portfolio_item`;
  42501/P0002 map to friendly 404.
- `PATCH /api/portfolio/media` — `{ itemId, assetId, alt }` → 200
  `{ ok, altSaved: true }`. Per-asset caption edit for drafts originals
  only: 409 `Unpublish this work before editing its captions…` while
  published, 404 for foreign/derivative assets, alt nonblank ≤2000.
  Serialized on the existing `withMediaOperation` lease.

## Store lifecycle (src/lib/media/store.ts, P2 additions)

- `setAssetAlt(supabase, uid, itemId, assetId, alt)` → `AltOutcome`
  (`{ ok: true, altSaved: true }` | PipelineFailure). One owned
  `drafts`/`original` row of one owned unpublished item; distinct
  captions are never bulk-rewritten. Manager publication must OMIT the
  global `altText` override so per-asset captions survive.
- `deleteItem(supabase, uid, itemId)` → `DeleteOutcome`
  (`{ ok: true, deleted: true }` | PipelineFailure). ONE lease; uses the
  internal `unpublishUnderLease` directly (never nested
  `unpublishItem`). Order: unpublish (if published) → remove known
  public objects (own `media` rows with `count:'exact'` truncation
  refusal PLUS deterministic derivative paths) → remove public rows →
  remove private originals → delete the item row (media rows cascade).
  Every path is ownership-prefix filtered (`{uid}/`), everything runs on
  the caller's client, all failure messages are fixed friendly text
  with a retry hint, and every step is idempotent: a retry after
  "bytes gone, row-delete failed" succeeds WITHOUT requiring missing
  originals to be downloadable again.
- `media_kind` is advisory legacy: rendering/playback must read actual
  `media_assets.content_type`, not the item column.
