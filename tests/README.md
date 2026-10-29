# Tests

`npm test` runs unit tests without a live database. Access, auth, payments, media,
events, portfolio, discovery, integration and compliance use their named npm
scripts against the local Supabase project in `supabase/config.toml`.

Copy local credentials to `.env.local`; see [the runbook](../docs/runbook.md).
The access harness obtains local project URLs from the pinned CLI; compliance
fixtures also need `SUPABASE_SERVICE_ROLE_KEY`. Permission checks use real
anonymous/member clients. Privileged SQL/service connections create fixtures and
clean them up. Media fixtures need ffmpeg and exiftool.

Run `npx supabase db reset` and `npm run seed:media` before integration. Integration
reuses the existing auth production-server lifecycle, rebuilding stale inputs;
set `TEST_APP_PORT` to reserve a port and do not start another server there.
Its live journey runs the same smoke/e2e scripts used by operators and checks
cleanup. Compliance covers legal disclosures, moderation, retention and basic
source-level accessibility guards. Browser smoke remains a separate command
requiring Chrome/Chromium; it is not a substitute for manual accessibility review.

CI preserves the web, invariants and database jobs and runs all DB suites in
stack jobs. See [architecture](../docs/architecture.md) for suite boundaries.
