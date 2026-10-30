# Audit remediation — database layer

Owner of this document: Multimedia, Storage & Deployment (audit package F,
database milestone). It records what the 26 October 2026 audit found in the
data layer, what changed, and what was deliberately left alone. Application,
UI, branding, dependency and generated-type remediation are tracked
separately by the integration branch.

Every fix is a **new forward migration**. No applied migration was edited,
reordered or renamed; `supabase db reset` replays the whole history and the
CI invariants gate still reports 13/13 tables under RLS, 3/3 `search_vector`
triggers and 4/4 discovery objects.

Migrations touching `profiles`, `media_assets` or `events` need review from
the affected vertical owner (Ownership Change Register C5):
`20261026000100` (events), `20261026000300` (media_assets, portfolio_items),
`20261026000400` (profiles).

| Migration | Audit finding | Subject |
|---|---|---|
| `20261026000100_event_host_immutable.sql` | A1 (high) | `events.host_id` immutable for client roles |
| `20261026000200_registration_seat_integrity.sql` | A2 (medium), A8 (low), A9 (low, documented) | capacity gate on revived registrations; cancelled registrations cannot be settled |
| `20261026000300_portfolio_publish_media_guards.sql` | A6 (low) | a published work can never be empty |
| `20261026000400_profile_handle_collision_retry.sql` | A7 (low) | concurrent sign-ups for one handle both succeed |
| `20261026000500_category_affinity_own_views.sql` | A3 (medium) | `category_affinity` gets its view signal back without exposing raw views |
| `20261026000600_page_view_dedupe.sql` | A4 (low) | bounded page-view recording |
| `supabase/seed.sql` | A-11 (low) | dangling `sql_paths` reference removed |

## A1 — a collaborator could take over event ownership

`0007`'s policy `collaborators update events` decides **who** may update an
event row. A row-level policy cannot say **which columns** that update may
touch, and the `authenticated` role held a table-wide `UPDATE` grant, so any
listed collaborator could run

```sql
update public.events set host_id = auth.uid () where id = <event>;
```

`WITH CHECK` passed on the row they had just read, and the rewrite handed
them the host-only powers: `hosts delete own events` and the
`hosts add/remove collaborators` roster policies. Scenario 11 covered a
collaborator's *direct* delete, not this bypass.

Two independent layers now close it, because either one alone can be undone
by a later migration:

1. `trg_events_host_id_immutable` — `BEFORE UPDATE OF host_id`, raises
   `EVENT_HOST_IMMUTABLE` (`42501`) on any change.
2. Column privileges — the table-wide `UPDATE` grant is replaced by an
   explicit column list that omits `host_id` (verified:
   `has_column_privilege('authenticated', 'public.events', 'host_id',
   'UPDATE')` is false while `title` stays writable). `anon` loses `UPDATE`
   entirely; `service_role` and `postgres` are untouched.

Ownership transfer is deliberately **not** provided. No product surface needs
it, and an event keeps the organiser it was created with. A future
host-transfer RPC must be `SECURITY DEFINER`, host-only, and shipped with a
migration that opens a controlled exception to this trigger.

**Consequence for later migrations:** because the grant is a closed column
list, any new writable `events` column (the Events vertical's `location`
column, for example) must be added to a fresh
`grant update (<column>) on public.events to authenticated` in the migration
that creates it, or clients get `permission denied for column` instead of a
policy decision.

The anonymous-edit red fixture (scenario 03) now temporarily grants only
`UPDATE (title)` as well as its permissive policy, then revokes that column
grant during restoration. A permissive policy alone cannot exercise the
unchanged-data assertion while the independent privilege restriction remains.
Production grants are unchanged.

Regression: `tests/access/23-event-host-id-immutable.spec.ts`. It asserts the
ordinary collaborator rename still lands, the takeover is refused loudly (not
RLS's silent `204, zero rows`), `host_id` is unchanged, the collaborator
still cannot delete, and the creator still can. Guard
`23-host-takeover-layers-removed` drops both layers for the red run; breaking
only one would leave the other refusing the takeover, which would prove
nothing about the test's ability to see red.

## A2 — a cancelled registration could be revived onto a full event

`0011`'s `register_for_event` checked capacity only on the
brand-new-registration branch. The `elsif status = 'cancelled'` branch
revived the row with no check at all, so *register → cancel → let somebody
else take the last seat → register again* oversold the event. The event row
is already taken `FOR UPDATE` at that point, so the check is simply hoisted
above the insert/revive branch and both paths share it. A registration that
is already `pending`/`confirmed`/`payment_failed` takes no **new** seat, so
retries and duplicate deliveries stay idempotent and cannot be turned away by
a full house they already sit in.

Regression: `tests/payments/04-cancelled-reregistration-capacity.spec.ts`
(free and priced single-seat events, plus the "still has room" revive case so
the fix cannot pass by blocking everything).

## A8 — a cancelled registration could still be paid for

`settle_order` never looked at the registration, so a pending order belonging
to a cancelled registration settled to `succeeded`: money taken for a seat
already released, while the registration stayed `cancelled` because `0008`'s
second `UPDATE` only matches `('pending','payment_failed')`.

`settle_order` now locks the registration row (`FOR UPDATE`, so a concurrent
`cancel_registration` either lands first and is seen, or waits) and raises
`REGISTRATION_CANCELLED` instead of charging. The order deliberately stays
`pending`: `register_for_event` revives the cancelled registration and reuses
that same open order (`0011`'s one-open-order partial index), so the member
pays exactly once and only while actually holding a seat.

Regression: `tests/payments/05-cancelled-registration-settlement.spec.ts`,
first case — refusal, then re-registration reusing the single order, then a
successful settle.

## A9 — `payment_failed` keeps its seat (documented, unchanged)

Capacity counts `('pending','confirmed','payment_failed')`. A declined
payment therefore holds the seat until the member cancels or pays, which
crowds out a buyer who would have paid. This is an existing stub-gateway
tradeoff, **not** changed here: releasing seats on a timer is a real payment
provider's job and belongs to the Future Implementation tier. The policy is
now pinned by the second case of `tests/payments/05` so that changing it is a
deliberate act, and the reasoning is recorded in the migration comment.

That test simulates the declined gateway with a direct status update rather
than by flipping `payment_stub_settings.force_fail`, because that switch is
process-global and `tests/payments/01` asserts it reads `false` while these
suites run in parallel.

## A6 — a published work could be emptied

`0004` guarded two doors: flipping an item to published, and touching media
on an already-published item. Four paths walked around it, all closed by
`20261026000300`:

- **Insert already published.** The alt_text check quantified over an empty
  media set and passed vacuously; nothing re-checked the item afterwards.
  `portfolio_items_publish_guard` now also refuses to publish a work with no
  media attached (`cannot publish portfolio item: no media attached`).
- **Delete the media.** The alt_text guard is `BEFORE INSERT OR UPDATE`, so
  deleting rows was unguarded.
- **Reassign the media.** `update media_assets set portfolio_item_id = <other
  own work>` empties the published work exactly like a delete and fires no
  `DELETE` trigger. A `BEFORE UPDATE OF portfolio_item_id` trigger now covers
  it.
- **Two concurrent deletes of the last two rows.** Each counted the other as
  "still there" and both passed. `media_assets_last_media_guard` locks the
  parent `portfolio_items` row (`FOR UPDATE`) before it evaluates publication
  state and the remaining count, so concurrent deletions of one work queue
  and the second sees the committed truth.

Deleting a **whole work** still cascades: `ON DELETE CASCADE` removes the
`portfolio_items` row first, the guard then finds no parent to protect and
returns `OLD`/`NEW` unchanged. The unpublish pipeline
(`src/lib/media/store.ts`) also stays legal — it deletes the public derivative
rows while the item is still published, and the private `drafts` originals are
still attached, so the work is never left with zero media.

`tests/access/_harness.ts::createPortfolioItem` was reordered for the same
reason: insert as a draft, attach media, then publish. "Insert already
published, attach media afterwards" is no longer a legal path for anybody,
fixtures included.

Regression: `tests/access/28-published-media-concurrency.spec.ts` forces two final-media deletions in separate transactions, observes a real blocked backend, and removes only the parent lock in its red counterfactual.

`tests/access/24-published-work-keeps-media.spec.ts` uses three
guards — `24a-last-media-delete-guard-dropped`,
`24b-last-media-move-guard-dropped`, `24c-publish-guard-media-check-removed` —
each independently turning one assertion red.

## A7 — concurrent sign-ups for one handle

`0003`'s `handle_new_user` derived a free handle with "look for a free
suffix, then insert". Two sign-ups racing for the same base both saw the same
free candidate; the loser hit `profiles_handle_key` and the unique violation
escaped the `auth.users` insert trigger, so registration failed with a raw 500.

The pre-check is kept (it produces the deterministic `handle`, `handle1`,
`handle2` sequence in the serial case) and an `EXCEPTION WHEN
unique_violation` retry is added around the insert. Only a collision **on the
handle** is retried: `GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME` re-raises
anything else unchanged, so a real defect still surfaces instead of looping,
and a 1000-attempt bound turns a pathological case into
`HANDLE_EXHAUSTED`.

Regression: `tests/access/27-handle-collision-retry.spec.ts`. The race is
forced the way `tests/payments/02` forces the capacity race: transaction A
holds the contested handle in an uncommitted update, so the signing-up
caller's pre-check cannot see it and its `INSERT` blocks on the unique index.
A is committed only once a waiter is provably queued on A's transaction id
(`pg_locks`, `locktype = 'transactionid'`, `not granted`), so the test cannot
green-light itself by missing the race. The contested handle is unique per
run, because the row it lands on persists and a fixed value would collide
with the previous run.

## A3 — `category_affinity` had no view signal

`0009` built `category_affinity` as a `security_invoker` view over likes (3
points) and logged-in page views (1 point). The likes branch works; the
page_views branch could never return a row, because `0007` gives `page_views`
RLS with **zero** policies and an invoker view reads as the caller. Every
member's view signal was 0 and the recommended feeds degraded to plain
trending.

`member_category_view_signal()` is now a `SECURITY DEFINER` aggregate that
answers exactly one question — how many of the caller's own logged-in views
fall in each category — with `where pv.viewer_id = auth.uid ()` inside the
definer. It returns per-category counts only: no raw rows, no subject ids, no
timestamps, nobody else's data. `page_views` keeps its zero-policy deny-all
RLS, and `category_affinity` stays `security_invoker`, so the view still
cannot be used to read another member's affinity profile.

The view is redefined with the same three columns and the same types
(`uuid`, `smallint`, `bigint`), so `recommended_events` and
`recommended_artists` keep working untouched and the discovery invariant
stays 4/4. `EXECUTE` on the helper is granted to `anon` as well as
`authenticated` on purpose: on stacks whose default privileges expose public
views to `anon`, an anonymous `SELECT` of the view must stay an empty result
rather than becoming a permission error. It can never return a row for `anon`
because `auth.uid ()` is null and `NULL` never equals a `viewer_id`.

Regression: `tests/access/25-category-affinity-own-signal.spec.ts` — a view
scores 1, a like on the same subject raises it to 4, a member who looked at
nothing has no signal for that category and never sees another member's rows,
and direct `page_views` reads stay empty for anon and members alike. Guards
`25a-affinity-signal-not-scoped-to-caller` (definer aggregate without the
`auth.uid ()` pin) and `25b-affinity-view-not-invoker`
(`alter view ... set (security_invoker = false)`) each turn it red.

## A4 — unbounded page-view recording

`record_page_view` was executable by `anon` with no de-duplication and no
bound, so a loop of RPC calls pushed any published subject to the top of the
seven-day counts both `trending_*` views order by.

`20261026000600` bounds it to **one row per identity, per subject, per 30
minutes**:

- Members are identified by `auth.uid ()`.
- Anonymous callers by a subject-scoped SHA-256 of the proxy-supplied client
  IP and user agent (`page_view_visitor_hash`). The subject type and id are
  part of the hashed input, so the stored value cannot correlate one visitor
  across different subjects. Raw IP and user agent are never stored, and
  `page_views` still has zero policies, so no client can read rows or hashes
  back.
- Check-and-insert is serialised with `pg_advisory_xact_lock` keyed on
  identity + subject. Without it two concurrent calls from one identity both
  pass the `EXISTS` check and both insert, which is exactly the flood being
  bounded.
- Where no identity exists at all (direct SQL, a harness, a proxy that strips
  both headers) the hash is `NULL` and the row is inserted without
  de-duplication, rather than sharing one global fingerprint that would let
  unrelated callers suppress each other's views.

`record_member_view` (`0009`) delegates here, so the same bound applies to
logged-in views and therefore to the A3 affinity signal: refreshing one
artist's page in a loop no longer inflates affinity.

**Residual risk, explicitly not mitigated.** Rotating or spoofed client
identity (proxy chains, botnets, a client that sends no user agent) still
produces distinct hashes, and a caller with many identities can still add many
rows. This is a local, dependency-free bound on single-identity flooding, not
complete anti-abuse. A deployed system needs rate limiting at the edge plus
server-side view recording, which belongs to the Public Discovery vertical.

Regression: `tests/access/26-page-view-dedupe-window.spec.ts` — repeat calls
inside the window do not count, the bound is per subject, members are bounded
the same way, a view from 31 minutes ago has expired so the next one counts,
a five-call burst from one identity writes exactly one row, and a second
concurrent caller **waits** on the advisory lock (`57014` under a
`statement_timeout`) instead of double-counting. Guards
`26a-dedupe-window-zeroed` and `26b-page-view-advisory-lock-removed` each turn
it red independently.

## A5 — `handle_available` as an enumeration oracle (accepted, unchanged)

`handle_available` is a `SECURITY DEFINER` boolean granted to `anon` so that
registration and onboarding can answer "is this handle free?" without widening
the `profiles` SELECT policy. That does let an anonymous caller probe which
handles are taken, including handles belonging to members who have not
published (whose public page 404s). This is the deliberate existing contract
of the public registration flow and is **left as is**: published artists are
already enumerable through `/artists/[handle]`, and tightening the RPC to
authenticated callers only would break anonymous registration. Recorded here
as an accepted low-risk tradeoff.

## A-11 — dangling seed reference

`supabase/config.toml` lists `./seed.sql` under `[db.seed] sql_paths` and the
file did not exist, so every `supabase start` and `db reset` printed
"no files matched". `supabase/seed.sql` now exists and intentionally contains
**no data**: the seven fixed categories come from migration `0002`; full
curated demo content is delivered by the final seed package. The auth suite
now owns separate private and published fixtures and remains independent of
other public content. Demo data with real media
bytes stays in `scripts/demo-seed.mjs`, which drives the running application
over HTTP. Curated seed content belongs to the discovery/finalisation work
and must stay idempotent when it lands.

The unrelated half of A-11 (a first `db reset` failing on the Storage health
check and succeeding on retry) is an environment timing issue, not a
repository defect; it was not reproduced here.

## Generated types (handoff note)

`src/types/database.ts` is regenerated by the integration branch, not here.
It must be regenerated against a stack that has these six migrations applied:
they add `page_views.visitor_hash`, `member_category_view_signal`,
`page_view_dedupe_window`, `page_view_visitor_hash`,
`events_host_id_immutable` and `media_assets_last_media_guard`, and they close
the pre-existing drift that omitted `handle_available` and the media
operation-lease objects.

Verified while preparing this handoff: `supabase gen types typescript`
derives columns from `information_schema`, **not** from column privileges, so
`events.Update.host_id` remains `host_id?: string` after regeneration. The
column-level grant in `20261026000100` therefore does not break typechecking
of code that mentions `host_id`, and `tests/access/23` (which deliberately
attempts that update) stays compilable. The database, not the type, is what
refuses it.

## Evidence

Raw command output for every claim above is in the task directory under
`logs-F/`: clean `db reset`, `db lint` at both default and `--level warning`,
the full `test:access` and `test:payments` runs on the freshly reset
database, `check:invariants`, one log per red guard run, the two payments
red probes (pre-fix function bodies restored temporarily, then put back), the
red-residue check that no temporary policy, probe function or reverted
function body survived, and a preview of the regenerated types.
