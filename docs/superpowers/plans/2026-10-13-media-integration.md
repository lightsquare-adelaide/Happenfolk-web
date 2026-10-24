# Media extraction and team adaptation plan

Goal: move Wenheng's media/storage/deployment vertical from the local reference into a separately reviewable team integration branch.

Architecture: retain team auth, profile editor, artist routes and dashboard as dependency commits. Extract only byte validation, derivatives, storage lifecycle, upload/publication/reordering routes and media UI; add an avatar adapter for the existing profile owner. Keep schema changes additive and retain session-based ownership and RLS. No remote writes or shared-database resets.

Tech: Node 22, Next.js 16, Supabase, Sharp, Vitest.

## Acceptance and execution

- [ ] Independently review exact PR6 head in a separate clean worktree; test redirect refresh/deletion cookies, safe redirects, actual auth/access flows. Save local review with exact scope.
- [ ] Establish isolated Supabase project on 554xx ports and record team dependency SHAs. Keep credentials/runtime ignored.
- [ ] Copy existing media tests before implementation and observe missing route failures. Add regression cases for repeated/concurrent publication and owner boundaries. Import only required media implementation; no account/event/discovery replacement.
- [ ] Adapt a dashboard media page to existing portfolio columns, mount avatar upload alongside profile editor, and render published public derivatives on /artists/[handle]. Use BRAND.name in new UI.
- [ ] Fix demonstrated lifecycle defects with tests first. Verify corrupt/oversize/spoofed uploads, EXIF removal, original privacy, public removal, retries, media ordering, non-owner denial and anonymous denial.
- [ ] Add deployment runbook and CI media gate scoped to this vertical; production changes remain unexecuted.
- [ ] Run lint/typecheck/unit/build, database lint/invariants, media and existing auth/access/payment regressions; exercise real HTTP and browser workflow. Record actual exit codes and remaining limitations.
- [ ] Save extraction manifest, compatibility report, local review draft and portable patch against dependency base. Verify no secret or unrelated vertical is in the diff.

Dependencies: current PR6 88f8037; profile PR13 9005c33; artist PR14 f15dd2e; dashboard PR15 67aadff. Other pending schema PRs are not merged or imported. New migration uses a timestamp version to avoid their numbered migration collisions.
