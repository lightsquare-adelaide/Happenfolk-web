# Report blocker verification (Task F)

The exact event venue and full description now require sign-in at the database
boundary. Public event summaries remain visible, including through discovery.
The event page links to login with a return URL. Anonymous direct private-column
reads are denied; the summary view and search RPC return null venues. An unrelated
signed-in member can read the real venue through the table, view and RPC.

The home hero now preloads the lead image with responsive sizes and selects the
480px derivative on narrow phones. At 390px / DPR 2, independent headless Chrome
selected a 480x360, 3,922-byte image instead of the unchanged 960x720, 7,246-byte
medium fixture. Only the lead hero image is eager and high priority. Artist
avatars sit absolutely inside reserved square boxes with explicit dimensions.
Hero captions have persistent underlines; artist cards add screen-reader text
without overriding their full content-derived name. The theme control includes
its visible current-state label in its accessible name.

## Acceptance

All commands run from the isolated hf-fix worktree using Node 22.23.4, Supabase
CLI 2.116.0, API 55321, database 55322 and TEST_APP_PORT=3107. Local variables are
exported from the ignored .env.local before invoking standalone scripts.

| Command | Exit | Evidence |
|---|---:|---|
| npm run lint | 0 | 0 errors; 3 pre-existing warnings |
| npm run typecheck | 0 | Route generation and TypeScript pass |
| npm test | 0 | 182 tests, 22 files |
| npm run check:invariants | 0 | RLS on 15 tables; 3 search triggers; 4 discovery views |
| npx supabase db reset | 0 | All migrations and sample seed apply |
| npx supabase db lint | 0 | No schema errors |
| VITEST_MAX_WORKERS=1 npm run test:access | 0 | 48 tests, 25 files |
| npm run test:events | 0 | 44 tests, 7 files |
| npm run test:discovery | 0 | 49 tests, 6 files |
| npm run test:compliance | 0 | 12 tests, 4 files |
| npm run test:integration | 0 | 10 tests, 2 files; real HTTP, smoke and complete media/registration journeys |
| nice -n 10 npm run build | 0 | Production build |
| npm run seed:media | 0 | 364 generated images |

The venue regression was red on 0310e74 (6 failures) and green after migration
(6 passes). Hero/box-layout regressions were red (2 failures) and green (2 passes).
The theme accessible-name regression was red (1 failure) and green (1 pass).
The new access suite enumerates every anonymously readable public view and checks
all three search RPCs, as well as REST reads, predicates and member controls.

Curl (exit 0 per request) confirms events?select=location returns HTTP 401,
Postgres code 42501, without data. public_events and search_events return HTTP 200
with location null; public_events also masks description. These are intentional
column-privilege denials; direct anonymous wildcard reads must move to the summary
view or explicitly request safe event columns. Deploy the migration and updated
public-page queries together. Existing authenticated write and RLS rules remain.

## Lighthouse before and after

Baseline: 0310e744b666e724a256c3bfe104ca49f7a54882. After runtime source: 603c61e.
Both use a local production build and a clean db reset plus seed:media. Lighthouse
13.6.0 launches installed Chrome headlessly, using default simulated mobile settings
and --preset=desktop, performance and accessibility only. There is one canonical
run per page/device/phase, with no best-run selection. Event and item IDs are
fa000002-0000-4000-8000-000000000001 and fa000003-0000-4000-8000-000000000001.
The exact repeated command is in the task artifact directory's run-lighthouse.sh.

| Phase | Page | Device | LCP (s) | CLS | TBT (ms) | Performance | Accessibility |
|---|---|---|---:|---:|---:|---:|---:|
| before | artists | desktop | 0.72 | 0.006 | 0 | 100 | 100 |
| before | artists | mobile | 0.78 | 0.000 | 1032 | 78 | 100 |
| before | event | desktop | 0.82 | 0.000 | 10 | 100 | 100 |
| before | event | mobile | 1.06 | 0.000 | 5316 | 69 | 100 |
| before | events | desktop | 0.71 | 0.000 | 0 | 100 | 100 |
| before | events | mobile | 4.03 | 0.000 | 1119 | 62 | 100 |
| before | home | desktop | 0.69 | 0.000 | 0 | 100 | 100 |
| before | home | mobile | 3.27 | 0.000 | 853 | 72 | 100 |
| before | item | desktop | 0.79 | 0.000 | 99 | 98 | 100 |
| before | item | mobile | 3.35 | 0.000 | 874 | 70 | 100 |
| after | artists | desktop | 0.74 | 0.006 | 0 | 100 | 100 |
| after | artists | mobile | 3.04 | 0.000 | 22 | 94 | 100 |
| after | event | desktop | 0.60 | 0.000 | 0 | 100 | 100 |
| after | event | mobile | 0.63 | 0.000 | 36 | 100 | 100 |
| after | events | desktop | 0.69 | 0.000 | 0 | 100 | 100 |
| after | events | mobile | 3.17 | 0.000 | 38 | 93 | 100 |
| after | home | desktop | 0.67 | 0.000 | 0 | 100 | 100 |
| after | home | mobile | 3.58 | 0.000 | 134 | 89 | 100 |
| after | item | desktop | 0.57 | 0.000 | 0 | 100 | 100 |
| after | item | mobile | 2.86 | 0.000 | 28 | 95 | 100 |

Home mobile LCP measured 3.27s before and 3.58s after. The
canonical run did not demonstrate an LCP improvement; this remains a performance
concern even though early loading and the smaller resource are verified. These
are local lab observations on a shared, busy host, not field Core Web Vitals or
proof that all score changes came from this patch. Large TBT changes on untouched
pages demonstrate host/run variability. Image selection and byte dimensions were
verified separately in a real browser.

All ten canonical after reports score 100 for accessibility, with no failed
accessibility audits, including zero-weight best-practice audits. The historical
colour-only home link and unnamed artist link did not reproduce on this baseline;
all baseline accessibility scores already rounded to 100. Desktop reports did
flag the shared theme label/name mismatch, which is now resolved. Baseline artists
CLS was already 0.000 on mobile and 0.006 on desktop; the table records the actual
after values rather than claiming a reproduced large shift.

The initial after batch caught an aria-label regression that omitted other visible
artist-card text. All ten diagnostic reports are preserved under
lighthouse/after-label-regression. The final after batch reruns every route/device
on the corrected build. Initial parallel access setup timeouts were resolved by
one-worker execution; a transient JWT-issued-in-future fixture error was diagnosed
with host/container clocks and a fresh authenticated read, then the suite passed.
These unsuccessful attempts remain in the command log.

## Artifacts and review

Full JSON reports, curl output, browser evidence, command exit codes and detailed
logs are saved at /Users/mac/.leader-tasks/2026-10-30-5800-report-85/.
No credentials, isolated Supabase config, package changes or historical migration
edits are included. Peer review of the events/discovery migration is pending;
this change is a reviewable PR and has not been merged or deployed remotely.
