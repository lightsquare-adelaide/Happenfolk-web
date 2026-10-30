# Discovery: trending, recommendations and search (S1)

This document describes the database rules behind the public discovery
surfaces — the anonymous homepage (global trending artists and events)
and the category-filtered, searchable directory. Everything here is
implemented in one migration,
`supabase/migrations/20261027000100_discovery_trending_search.sql`,
ported selectively from the personal-version
`0020_discovery_trending_recommendations.sql` and fixed for two defects
found during review (see below).

## Trending score

`trending_events` and `trending_artists` rank published subjects by a
time-decayed 7-day view score:

```
trending_score = Σ exp(-λ · age_days)   over page_views in the last 7 days
λ = ln(2) / 2                           (48-hour half-life)
```

A view from an hour ago counts ~0.99, a day ago ~0.71, six days ago
~0.125. Within the seven-day window, a nearly week-old view carries
~9% weight; older views are excluded. Recent spikes outweigh older views.
Raw counts (`view_count`) are kept alongside for display, but ordering
is by score.

Ordering is deterministic: `trending_score desc, view_count desc`, then
a stable natural key (`starts_at` for events, `handle` for artists),
then the row `id`. Repeated reads return the identical sequence.

Only published subjects appear: events must have
`status = 'published'`, artists must have `profiles.published`. Draft
and cancelled events are invisible to discovery no matter how many
views they carry.

### Artist aggregate independence (ported defect, fixed)

The personal-version `trending_artists` joined `page_views` and
published `portfolio_items` in a single aggregate, multiplying every
profile view row by the artist's item count — publishing a new work
silently doubled the artist's `view_count` and score with the view rows
untouched. The team version computes the two aggregates in independent
lateral subqueries:

- `view_count` / `trending_score` count **profile-subject views only**
  (portfolio-item views never inflate the artist's numbers);
- `published_items` counts published works only.

`tests/discovery/02-artist-aggregate.spec.ts` pins this: with fixed
page-view fixtures, publishing another work changes `published_items`
only, never `view_count` or `trending_score`.

## Recommendations

`recommended_events` / `recommended_artists` (security-invoker views,
per 0009) rerank the trending score multiplicatively:

```
rank_key = trending_score × (1 + 2 × affinity)
```

where `affinity` comes from `category_affinity` joined on
`member_id = auth.uid()` — the identity is always the caller's own; no
parameter can select somebody else's affinity. The 0009 lexicographic
order (affinity first) let any single like steam-roll every other
category; the multiplier keeps global momentum dominant and lifts the
liked category proportionally.

The tiebreak chain is byte-identical to the trending views', so a cold
start (no likes, no member views ⇒ affinity 0 ⇒ multiplier exactly 1)
yields the global trending sequence item for item. Anonymous callers
(`auth.uid()` is null) also see exactly the global order.

## Search RPCs

Three SECURITY INVOKER functions, callable by `anon` and
`authenticated`, sit on top of the `search_vector` columns and GIN
indexes maintained since 0003–0006:

| RPC | Matches on | Visibility |
|---|---|---|
| `search_events(text, smallint, integer)` | title/description FTS + trigram title | `status = 'published'` |
| `search_artists(text, smallint, integer)` | name/handle/bio FTS + trigram name & handle | `profiles.published` |
| `search_items(text, smallint, integer)` | title/description FTS + trigram title | `pi.published` **and owner `p.published`** |

Matching is `websearch_to_tsquery` (total — malformed operator soup
never raises) OR `pg_trgm` similarity above 0.3 (survives one or two
typos). Ranking: FTS `ts_rank`, then trigram similarity, then a
deterministic natural key. An empty/whitespace query skips the text
filter, so pure category browsing works.

Item discovery additionally requires the **owning profile** to be
published: a private artist's published works are not discoverable by
anyone — not by anonymous callers (RLS would already hide the profile
row), and not by the owner browsing discovery (RLS alone would show
it; the explicit predicate closes that shortcut). Previewing your own
drafts belongs to the dashboard, not discovery.

### Input bounds

- `p_query`: trimmed; empty → browse mode. Over **200 bytes**
  (`octet_length`, UTF-8 bytes not characters) raises `QUERY_TOO_LONG`.
- `p_limit`: clamped to `1..100`, default `24`, null → default.
- `p_category_id`: `smallint` or null (all categories); an unknown id
  simply matches nothing.

`src/lib/discovery.ts` mirrors these bounds in TypeScript (DB-free unit
tests in `src/lib/discovery.spec.ts`) so the API layer can reject bad
input before it reaches Postgres, while the RPCs stay independently
safe against direct callers.

## What this migration deliberately does NOT change

- `record_page_view`, `page_view_dedupe_window()`,
  `page_view_visitor_hash()`, the 30-minute per-identity dedupe, the
  transaction advisory lock and every grant from 0006 /
  20261026000600 stay exactly as they are. The personal-version
  recorder (member-day dedupe + anonymous global velocity cap) would
  have erased F's per-identity dedupe and is **not** ported.
- No purge/retention helper is imported.
- No raw `page_views` row, hash or timestamp is exposed anywhere;
  `page_views` keeps its zero-policy deny-all RLS (0007).
- Existing view columns keep their names, positions and types;
  `trending_score` (`float8`) is appended last, and grants from
  20261013000100 are preserved by `CREATE OR REPLACE`.

## Tests

Real-stack suite (local Supabase, serial):

```
npm run test:discovery          # tests/discovery, --no-file-parallelism
```

- `01-trending-decay` — recent-vs-old ranking from fixed timestamps,
  7-day window edge, cancelled/draft/private exclusion, deterministic
  ties, read stability.
- `02-artist-aggregate` — the join-multiplication regression.
- `03-recommendations` — cold start equals global trending; likes
  rerank only the liker; multiplicative (not lexicographic) affinity.
- `04-search` — FTS/trigram matching, empty/no-result/malformed
  queries, category filters, private-owner exclusion, limit clamping,
  `QUERY_TOO_LONG` byte budget, whitespace trimming.

Red-green guards (same convention as `tests/access`, via
`DISCOVERY_RED=<name>`; each red run must fail the guarded spec and the
guard restores itself afterwards):

| Guard | Breaks | Caught by |
|---|---|---|
| `score-decay-off` | score degenerates to raw count | 01 |
| `artist-join-multiply` | restores the personal-version join defect | 02 |
| `affinity-off` | rerank reduced to pure trending | 03 |
| `search-owner-blind` | `search_items` forgets the owner-profile predicate | 04 |

CI runs `test:discovery` in the integration job after `test:portfolio`;
the suite is excluded from plain `npm test` (it needs the local stack).

## View recording

`POST /api/views` accepts exactly
`{ "subjectType": "event" | "profile" | "portfolio_item", "subjectId": "<uuid>" }`.
Malformed JSON, invalid subjects, missing or additional fields, and bodies
over **1 KiB** return 400. The route reads the body stream with a byte
budget and cancels oversized uploads immediately, without waiting for
the sender to finish or acknowledge cancellation. Cross-origin browser
requests return 403 before a database client is created.

Both anonymous and signed-in requests must pass the same public-visibility
check through a caller-scoped Supabase client. Profiles must be published,
events must have `status = 'published'`, and portfolio items require both
`portfolio_items.published` and the owning `profiles.published`. Private
previews, drafts, cancelled events and unknown IDs return the same quiet
`{ "ok": false }` without inserting rows. Viewing your own published
profile returns `{ "ok": true, "skipped": true }` without recording.

Members use the existing `record_member_view` RPC. Its identity comes
from the verified session's `auth.uid()`; a request cannot choose a viewer.
Anonymous requests use `record_page_view` on a dedicated client that
forwards only the validated original User-Agent and trusted client IP.
This preserves separate visitors when they share a User-Agent. Trust is
disabled by default. On Vercel, `VERCEL=1` selects the platform-forwarded
IP. Self-hosted deployments may set
`VIEW_RECORDING_TRUST_FORWARDED_FOR=1` **only behind a proxy that replaces
client-supplied forwarded headers**. Missing or invalid identity skips
anonymous recording; it never invents a shared fingerprint. Next may
supply the socket peer IP when no forwarded header was received.

The existing database recorder remains the authority for 30-minute
identity-and-subject deduplication, including concurrent calls and app
restarts. The app adds a bounded, hashed, 60-second anonymous throttle.
Raw IPs and User-Agents are never logged or persisted. Anonymous rows
contain a subject-scoped hash; member rows contain their own `viewer_id`.
Raw `page_views` rows remain unreadable to anonymous and authenticated
clients. The public anon RPC remains directly callable, so its existing
identity-spoofing risk still requires deployment-level rate limiting.

`ViewTracker` records published profiles and events after mount.
`WorkViewTracker` waits until its gallery sentinel enters the viewport;
artist pages mount it only when both the profile and work are published.
The browser coalesces requests already in flight and stores a bounded
30-minute session suppression entry **only after a 2xx response**,
including 204. Network errors and non-2xx responses allow the next call
to retry. Storage failures and recording failures never interrupt reading.

Tests: `src/lib/view-throttle*.spec.ts` cover bounded reads, cancellation,
identity validation, throttling and tracker retries. The real production
HTTP suite `tests/discovery/05-view-api.spec.ts` uses app port 3102 and the
current worktree's local Supabase stack. It checks separate anonymous
identities, repeats and concurrent calls, member UIDs, publication and
owner visibility, page tracker mounting, malformed and cross-origin
requests, absent User-Agent headers, untrusted mode, and a never-ended
2 KiB chunked request returning 400 within two seconds. It restarts the
same app port for untrusted mode, cleans up its fixtures, and rebuilds
when application inputs or `.env.local` are newer than the build.

## Event venue privacy (D5)

Migration `20261030000100_event_venue_privacy.sql` keeps event summaries
public while requiring sign-in for exact venues and full descriptions.
Anonymous callers have SELECT only on explicitly listed safe `events`
columns; selecting private columns, wildcard reads, or filtering/ordering
by a private column fails with a permission error.

Public pages use the read-only `public_events` view. It explicitly filters
to published, visible events and returns null for `location` and
`description` without an authenticated identity. Its owner evaluation is
intentional: it masks columns that anonymous users cannot select directly.
It exposes neither private drafts nor the stored search vector. Signed-in
team previews keep using `events` and its existing RLS policies.

`recommended_events` uses the same masked summary. `search_events` keeps
its bounded signature and relevance rules; its static owner-executed query
explicitly filters published, visible rows and masks the venue for anonymous
callers. Other search RPCs and discovery views do not return event venues.

`tests/access/28-event-venue-privacy.spec.ts` verifies direct REST reads and
predicates, every anonymously readable public view (enumerated from the
catalogue), all three public search RPCs, and unrelated signed-in member
positive controls. HTTP event-page tests also inspect the full response,
including streamed data, and verify a login link returning to the event.
