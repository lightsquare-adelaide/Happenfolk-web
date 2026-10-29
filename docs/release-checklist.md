# Release checklist

- [ ] Record the commit, target Supabase project, Vercel environment and operator. Keep credentials out of release records.
- [ ] Confirm Node 22 and `npm ci` with the committed lockfile. Review all new timestamped migrations; preserve applied migration files and teammate authorship.
- [ ] Reset an isolated local stack. Verify 40 sample artists, 84 events and 120 works load. Run `npm run seed:media` and confirm 364 generated objects.
- [ ] Pass lint, typecheck, unit tests and database invariants. Load `SUPABASE_DB_URL` before the invariants command (see runbook).
- [ ] Pass access, auth, payments, media, events, portfolio and discovery suites. Install ffmpeg/exiftool for media fixtures.
- [ ] Pass `npm run test:integration` and `npm run test:compliance` against a freshly seeded stack.
- [ ] Build with the target public environment values. Run `smoke`, `e2e` on authorized staging with sample fixtures, and `smoke:browser` against the built app. Check the scripts' exit codes and cleanup, not only their last success line.
- [ ] Manually review keyboard navigation, responsive layouts, profile editing, event collaboration, media accessibility, free RSVP and simulated paid checkout. The automated e2e uses owner-RLS profile writes and does not cover that server-action form.
- [ ] Check hidden/draft data is absent from anonymous browsing, search and details; streamed not-found responses may carry HTTP 200 plus a Next 404 marker and `noindex`.
- [ ] Verify privacy/terms/licence/credits links, sample disclosures, 90-day raw-view retention and active daily cron. Verify staff privileges come only from `admin_staff`.
- [ ] Review preview/production env separation, Auth callback allowlists and recovery email delivery. Service role remains server-only. Disable trusted-forwarded-IP opt-in unless the proxy overwrites client headers.
- [ ] Confirm checkout is labelled as simulation, and no claim of real payments/refunds is made. Approve sample content explicitly before showing it on a hosted target.
- [ ] Back up the remote database and identify the previous application deployment. Agree schema-compatible rollback/recovery steps before migration deployment.
- [ ] Apply reviewed schema changes, deploy the intended commit, then run read-only smoke against the release. Confirm observability without sensitive values in logs.
- [ ] Record results and unresolved limitations. Stop only test servers/stacks owned by this checkout. Remove temporary test accounts/files and optional samples when appropriate.
