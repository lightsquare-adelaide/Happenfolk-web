# Final hosting deployment evidence

## Authorized target and safety gate

On 2026-10-30, the executor inspected artlink-adelaide
(`gjmsfxfecdeabrsayiyw`) using the Auth admin listing and service-role REST
reads. All requests succeeded: auth.users 0, profiles 0, events 0,
portfolio_items 0. No real-user emails or content were present. The user's
explicit conditional reset authorization therefore applied to this project.

Private schema and data backups were taken before the reset. The stored global
database password was rejected; the Supabase CLI's temporary database login
succeeded without changing the database password. The existing lightsquare-web
Vercel project and Selvin125 project were not modified.

## Hosted stack

Production: https://happenfolk-final.vercel.app

The new Vercel project is happenfolk-final in team 1-cbee, with Node 22.x,
`npm ci`, and `npm run build`. The three public variables are Production Config
values; SUPABASE_SERVICE_ROLE_KEY is a Production Secret used only by server
code. Supabase Auth's site URL and exact callback/reset-password allowlist point
to the production origin. Email autoconfirm was already enabled on this sample
target and was not changed.

The remote reset applied all 37 migrations, including venue privacy migration
20261030000100, without loading the local SQL seed. The explicitly guarded
`seed-prod.mjs --yes` operation then created 40 marked fictional sample accounts,
84 events, 120 works and 364 generated Storage images. SQL counts independently
confirmed these totals and all 40 sample markers. Remote sample passwords are
random and stored privately; they are not the local SQL seed password. The daily
page-view-retention cron is active at `17 3 * * *`.

The first verified production deployment was dpl_CMsCMJ7hZWEZErV11fnqBRu9DSus,
commit d4e7d0805d7fd843dd0d85a3f2bfea7d084cbdb2. Its runtime source is unchanged
from PR #42 head a7026ef5851646536d9de1bfc366eb54dab0dcab. Task D adds only this
English evidence document; it changes no application code or historical migration.
The external result file records the final deployed evidence commit and metrics.

## Fresh verification

All commands used Node 22.23.4 and the pinned Supabase CLI 2.116.0.

| Check | Result |
|---|---|
| npm ci | Exit 0; lockfile unchanged; audit reported 0 vulnerabilities |
| lint and typecheck | Exit 0; lint retains 3 existing warnings |
| unit tests | 182 passed |
| Isolated hf-fix reset and sample media | Exit 0; 364 images uploaded |
| Database invariants | 15 RLS tables; 3 search triggers; all 4 discovery views |
| Access / auth / payments | 48 / 17 / 40 tests passed |
| Media / events / portfolio | 27 / 44 / 60 tests passed |
| Discovery / integration / compliance | 49 / 10 / 12 tests passed |
| Vercel production build | Exit 0; deployment Ready |
| Hosted smoke and browser smoke | Exit 0 |
| Hosted E2E | Exit 0, including temporary account and Storage cleanup |
| Hosted venue privacy | Direct anonymous column read 401/42501; all 78 public summaries and search results mask venues |
| Hidden fixtures | Absent from anonymous event, profile and portfolio queries |
| Browser account journey | Sample login, profile server-action save, member venue visibility and sign-out passed |
| Staff moderation | Nonstaff 404; temporary sample staff grant enabled page; grant removed afterward |

Hosted E2E exercises signup, onboarding data, PNG upload and publication, public
Storage download, event creation/publication, free registration/cancellation,
views/likes, simulated payment failure/retry/success and idempotent replay.
These are payment simulations, not real charges or revenue.

Six public pages plus the signed-in studio and portfolio manager were captured
at 1440x900 and 390x844. All 16 screenshot records showed no horizontal overflow,
no failed visible images and no browser exceptions. An initial supplemental
profile-form probe used an overly broad form selector and threw; targeting the
profile form specifically passed without an application change. Full corrected
capture results and final Lighthouse measurements live in the external artifacts.

## Evidence and limits

Artifacts: /Users/mac/.leader-tasks/2026-10-30-5800-report-85/.
TASK-D-RESULT.md contains the final URL, deployed SHA, command exit codes and
output tails, Lighthouse table, screenshot inventory and unresolved concerns.
TASK-D-PROGRESS.md and TASK-D-COMMANDS.md retain progress and unsuccessful attempts.
Credentials, backups and raw account data remain outside the repository.

Hosted recovery-email delivery to a real inbox was not tested: all sample
contacts use synthetic example.test addresses. Local recovery flows are covered
by the passing auth suite. This sample deployment has email autoconfirm enabled.
Lab Lighthouse results describe this hosted run and are not field Core Web Vitals.
