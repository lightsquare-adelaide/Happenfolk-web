# Happenfolk operations runbook

## Local setup

Use Node 22 (the exact patch is in `.nvmrc`), npm and Docker. Use the repository's pinned Supabase CLI through `npx`; do not upgrade it implicitly. On machines using fnm, run `eval "$(fnm env)"; fnm use 22.23.4` before npm commands.

```sh
npm ci
npx supabase start -x studio,edge-runtime,logflare,vector
npx supabase db reset
cp .env.example .env.local
npx supabase status -o env
```

Copy the local status values into `.env.local` using the mapping below. Never commit this file or paste its contents into tickets. Start Docker first if the CLI cannot reach its socket. A reset destroys only the local project selected by `supabase/config.toml`; check its project ID before running it. For concurrent worktrees, assign a unique project ID and every port in that config, and keep those machine-specific changes out of commits.

| Variable | Local source / purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL`; browser-visible Auth, REST and Storage URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY`; browser-visible key, protected by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY`; server-only media operations and test fixture cleanup |
| `NEXT_PUBLIC_SITE_URL` | App origin; example `http://localhost:3000` |
| `SUPABASE_DB_URL` | `DB_URL`; local SQL tests and invariants; never a browser variable |
| `TEST_APP_PORT` | Optional fixed port for suites that start a production server; otherwise their existing harness allocates one |
| `BASE_URL` | Origin for smoke/e2e/browser scripts; explicitly supplied when running them |
| `VIEW_RECORDING_TRUST_FORWARDED_FOR` | Optional `1` only behind a proxy that overwrites forwarded IP headers; Vercel is detected via `VERCEL=1` |

```sh
npm run seed:media
npm run dev -- --port 3000
```

Reset loads 40 fictional artists, 84 events across all seven categories, and 120 works, including hidden/draft fixtures. All names and descriptions disclose sample data, contacts use `example.test`, and graphics are generated locally by sharp. Run `npm run seed:media` after each reset: SQL holds media metadata while image bytes live in Storage. It uploads 364 objects and is safe to repeat. The seed creates no staff account. Local sample login is `sample.artist.01@example.test` / `Sample-Happenfolk-2026!`; this password applies only to the SQL seed. The separate `demo.artist@happenfolk.test` account is deliberately not pre-created.

To regenerate checked-in SQL after editing the sample manifest, run `node scripts/generate-seed.mjs` and review `supabase/seed.sql`. Event times remain relative to reset time. The legacy demo uses its existing default account unless overridden:

```sh
DEMO_EMAIL=demo.artist@happenfolk.test node scripts/demo-seed.mjs http://localhost:3000
```

That script also requires ffmpeg and exiftool. It exercises real signup, avatar upload, media upload and publishing. It leaves its demo account in place.

## Verification

Use a running local stack with `.env.local` populated. Stop a manually started app before DB suites that own `TEST_APP_PORT`. Keep one build at a time per checkout.

```sh
npm run lint
npm run typecheck
npm test
node --env-file=.env.local scripts/check-invariants.mjs
npm run test:access
npm run test:auth
npm run test:payments
npm run test:media
npm run test:events
npm run test:portfolio
npm run test:discovery
npm run test:integration
npm run test:compliance
```

Media suites need ffmpeg and exiftool. Integration starts and stops a real production server through the existing auth harness, rebuilding stale app inputs. It expects the volume seed and uploaded sample images. DB suites use real owner/anonymous clients for permission checks; privileged connections provision and remove fixtures. On constrained machines prefix heavy commands with `nice -n 10`.

For deployment probes, build with the actual target's public env values, then start the app on the selected port. `NEXT_PUBLIC_*` values are compiled into the browser bundle; rebuild after changing them.

```sh
nice -n 10 npm run build
npm run start -- --port 3000
# Separate shell, same checkout and environment:
BASE_URL=http://localhost:3000 npm run smoke
BASE_URL=http://localhost:3000 npm run e2e
BASE_URL=http://localhost:3000 npm run smoke:browser
```

`smoke` is read-only: public pages, login redirects and private analytics/staff/RPC boundaries. `e2e` creates a temporary `example.test` account through public signup, completes owner-RLS onboarding, uploads and publishes a PNG, registers/cancels a free event, records a view/like, and retries a paid sample order through the simulator. It requires confirmations disabled on its test target and a service role for cleanup, checked before signup. It does not automate the profile server-action form; browser smoke checks auth-form hydration. Paid fixture events must exist. Run e2e only on an authorized test/staging target with sample data. Its `finally` cleanup removes Storage objects, owned content, likes/views and the account; a cleanup failure causes a nonzero exit. A hard process termination can interrupt cleanup; identify only that run's `e2e-…@example.test` account and remove its files before deleting it.

`smoke:browser` needs Chrome/Chromium (or `CHROMIUM_PATH`); it uses a temporary browser profile and checks hydrated auth inputs and error boundaries. `npm run kill:next` terminates this user's Next processes only when their cwd exactly matches this checkout, using `lsof` on macOS and `/proc` on Linux. It leaves other worktrees alone. Stop only your own Supabase project with `npx supabase stop` after testing.

## Deploy to Vercel

1. Run the release checklist against the intended commit and a clean local reset. Back up the remote database before schema changes. Review new migrations; never rewrite applied history.
2. Import this repository into the authorized Vercel project as a Next.js app. Use Node 22, install with `npm ci`, build with `npm run build` and the default `.next` output. No custom Vercel configuration is required by this repository.
3. Configure the three public variables and server-only service role separately for Preview and Production. Use the deployed app origin for `NEXT_PUBLIC_SITE_URL`. No database URL is required by application runtime. Configure Supabase Auth's site URL and exact allowed redirect URLs for the chosen environment; check password recovery links.
4. Apply reviewed migrations to the selected Supabase project with your normal authorized migration process. `supabase db push` is schema deployment, not an instruction to seed production. Review the linked project before running it. Do not use `db reset` against a hosted database.
5. Deploy a preview, verify signup/recovery/sign-out, browsing, collaboration, upload and checkout simulation, and run read-only smoke with that environment's public credentials. Release the reviewed commit after those gates pass.

Checkout is a payment simulator. No Stripe integration, real charge, refund or financial reconciliation is implemented. Do not describe a simulated success as collected revenue. Event editing intentionally does not accept price/capacity fields; priced events are provisioned through trusted data administration.

## Optional remote sample seed

These scripts never read `.env.local` for target credentials. Both refuse to run without `--yes`, an explicit URL, service role and exact host acknowledgement. Remote seed passwords have no default and must be at least 16 characters. Only operate on an approved target. EXAMPLE values below are intentionally unusable.

```sh
export SEED_SUPABASE_URL=https://example.supabase.co
export SEED_SERVICE_ROLE_KEY=EXAMPLE_ONLY_SERVICE_ROLE_KEY
export SEED_TARGET=example.supabase.co
export SEED_PASSWORD=EXAMPLE_ONLY_CHANGE_THIS_PASSWORD
node scripts/seed-prod.mjs --yes
# Remove only sample accounts marked happenfolk-parity-x-v1 and exact manifest emails:
node scripts/unseed-prod.mjs --yes
```

Seed retries reuse marked accounts and deterministic content IDs; collisions with unrelated content fail instead of overwriting it. A failure can leave partial marked data; rerun seed or unseed after correcting the cause. Unseed is idempotent and removes only marked manifest users, their owned Storage prefixes, content and analytics. It does not reset the database or remove real members. A real user occupying a sample email without the marker is not adopted or deleted.

## Staff and retention operations

Membership in `admin_staff` is the staff privilege source; users cannot grant themselves access by editing profiles or Auth user metadata. Provision approved staff IDs through a trusted SQL console. Review and record changes separately; an admin audit-log feature is not implemented. Hiding removes database rows from public queries/search/detail pages; already-known public Storage URLs are not revoked automatically. Use Storage removal for a takedown requiring byte revocation.

The daily `page-view-retention` cron runs at 03:17 UTC. It aggregates raw views older than 90 days into `page_views_monthly` without viewer identity, then purges the raw records. Service/SQL operators can invoke `select * from public.run_page_view_retention();` and inspect aggregate/purge counts. Anonymous and member roles cannot run this job. Raw views and monthly aggregates have no public read policies. Logs intentionally exclude raw IPs, user agents and credentials.

## Rollback and incident recovery

Revert the application to the prior reviewed Vercel deployment/commit, verifying it remains compatible with current schema. A Vercel rollback does not roll back Postgres. Add a forward corrective migration for schema fixes; do not edit or delete applied migrations. Restore a database backup only through the approved recovery process, accounting for writes since the backup. Never run a local reset command against a hosted database.

Disable or hide affected content with approved staff access when appropriate, preserve evidence without secrets, and rerun smoke after recovery. Rotate any exposed service-role credentials and redeploy with corrected env. Remove optional sample data using guarded unseed, not broad table deletes. This package performs no hosted deployment, credential change or production seeding.
