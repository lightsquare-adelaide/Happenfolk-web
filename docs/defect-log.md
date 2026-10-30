# Defect and remediation log

This log summarizes the integrated audit remediation beginning with PR #30 and later parity work. It records shipped behavior, not an assertion that every possible defect has been eliminated. Historical detail and original evidence remain in [database remediation](audit-remediation-database.md), [application audit fixes](application-audit-fixes.md) and the commit history.

| Finding / gap | Integrated remediation | Evidence location |
|---|---|---|
| A1: collaborator could replace an event host | Immutable host trigger; shared collaborator gate for ordinary edits and host-only roster/deletion | `20261026000100_event_host_immutable.sql`, event/access suites |
| A2: cancelled registration could revive onto a full event | Locked shared capacity gate for initial and revived registrations | `20261026000200_registration_seat_integrity.sql`, payment suites |
| A8: pending order could settle after cancellation | Registration lock/state gate rejects cancelled seats before settlement | Same seat-integrity migration and per-order settlement migration |
| A6: publishing empty work or deleting/moving its last media | Publish guard and parent-lock last-media guard | `20261026000300_portfolio_publish_media_guards.sql`, portfolio/access suites |
| A7: concurrent signup handle collision | Retry unique-handle allocation | `20261026000400_profile_handle_collision_retry.sql`, auth/access suites |
| A3: category affinity ignored views | Add member view contribution alongside likes | `20261026000500_category_affinity_own_views.sql`, discovery suites |
| A4: unbounded repeated page-view recording | Database dedupe, request validation, bounded body, public-subject checks and process throttle | `20261026000600_page_view_dedupe.sql`, `/api/views`, view unit tests |
| A-11: missing seed file and later empty-site handover gap | Working local seed plus 40 sample artists, 84 events, 120 works and generated media | `supabase/seed.sql`, seed integrity suite |
| Missing location and last-host integrity | Required valid event location; host/collaborator safeguards | `20261026000700_event_location_last_host.sql`, event suites |
| Portfolio order and metadata gaps | Atomic append/reorder, year/tags validation, asset captions and public derivative rendering | `20261026000800_portfolio_item_order_metadata.sql`, portfolio suites |
| Onboarding handle race / false conflict | Retain member's current handle, ignore stale availability results, show friendly errors | Application audit fixes and auth suites |
| Cross-site sign-out and missing response protections | Origin/fetch-metadata check; nosniff/frame/referrer/permissions headers | Auth tests and `next.config.ts` |
| Dependency vulnerabilities at audit time | Pinned matching Next/ESLint versions and updated dependency lockfile | Application audit fixes; run fresh npm audit for current status |
| Teammate schema ordering / grants | Preserve teammate work, sequence migrations, add collaboration-field update grant | `20261028000xxx` migrations, integrated teammate commits |
| Media duplicate metadata and tied reorder | Preserve conflicting metadata, deduplicate atomically, repair stable asset ordering | `20261028000500` / `20261028000600` migrations, media regression suite |
| Missing content, work detail and collaboration directory | About/legal/credits pages, `/items/[id]`, directory and contact/availability fields | Content pages, compliance suites |
| Missing public likes and staff moderation | Authenticated toggle/count API, inaccessible staff register, guarded hide/update RPCs | `20261028200200_admin_hiding.sql`, compliance suites |
| Hidden/private data leaking through indirect surfaces | Align RLS/search/recommendations/likes/views with public parent visibility | `20261028200400_public_visibility_fixes.sql`, compliance suites |
| Raw view retention lacked identity-free aggregates | Serialized monthly rollup then raw purge after 90 days, daily cron and restricted execution | `20261028200300_retention_monthly_aggregate.sql`, retention compliance suite |
| Paid checkout lacked integrated routes and caller-specific outcome | Registration/order/cancel routes, checkout page and per-order simulator; immutable terminal outcomes | `20261029000100_settle_outcome_per_order.sql`, payments/integration suites |
| Checkout test intermittently flagged UUIDs as card fields | Inspect control name/id/type/autocomplete/placeholder/label attributes instead of arbitrary form values | Payment assertion regression tests |
| Legacy demo repeat run lost the signed-in user | Use the successful authentication result for profile lookup; fail on upload/publish errors | `scripts/demo-seed.mjs`, launch integration regression |
| Missing launch scripts/docs/CI gates | Guarded sample lifecycle, smoke/live journey/browser tooling, runbook and explicit stack suites in CI | Package X scripts/docs/integration/compliance |

## Accepted behavior and remaining limits

- A5: handle availability is intentionally public; it is an accepted enumeration surface. Do not report it as fixed.
- A9: `payment_failed` retains its seat so retry remains possible; cancellation releases it. No automatic expiry is implemented.
- Checkout simulates success/failure. Stripe, real charges, refunds and reconciliation remain outside this implementation.
- Staff hiding filters public database/API content; known public Storage URLs remain reachable until objects are removed. No full admin audit log is implemented.
- Baseline security headers are implemented; no nonce-based content security policy is claimed.
- Streamed not-found pages can return HTTP 200 headers with a Next 404 fallback marker and `noindex`. Integration checks both render semantics and private-data absence.
- Optional production deployment, hosted credential verification, hosted sample writes and visual/manual acceptance are operator responsibilities, not actions performed by this package.
