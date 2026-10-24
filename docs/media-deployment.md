# Media deployment and rollback

Owner: Wenheng Xie — Multimedia, Storage & Deployment.

## Scope and prerequisites

This slice requires the team's auth/profile/artist/dashboard PRs (#6, #13,
#14, #15). Their commits are preserved as dependency history; they are not
Wenheng's extracted implementation. The extraction does not replace account,
event, discovery, recommendation or payment code.

Install on Node22 with `npm ci --include=dev`. Media integration fixtures
require ffmpeg and exiftool. Sharp is pinned to the version already present
in the team lockfile (0.35.4), promoted to a direct dependency.

New migrations are timestamped to avoid colliding with pending numbered team
migrations. Review with the Accounts/Portfolios owner before applying them.

- `20261013000100`: explicit table privileges for current Supabase defaults;
  existing RLS remains enabled. No raw analytics or payment-table writes.
- `20261013000200`: retry-key uniqueness, private operation leases and atomic
  original/derivative ordering. It retains one row from pre-existing duplicate
  object keys; inspect/back up such rows before a hosted migration.

## Upload and storage policy

JPEG, PNG, WebP and H.264 MP4 are validated by bytes. File limit is 4 MiB;
multipart request limit is 4 MiB +64 KiB. The Node stream is bounded before
multipart parsing. This leaves room under Vercel's 4.5 MB payload limit:
https://vercel.com/docs/functions/limitations#request-body-size

Image decoding is limited to 20 million pixels. Originals are private drafts;
published images are 480/1080 WebP derivatives without EXIF metadata. MP4 is
not transcoded; a validated H.264 copy is published. Each media item requires
alt text. Avatar uploads accept only images and store a 256px public WebP;
the UI tells users avatars are public. No service-role key is used by the
application pipeline.

Uploads targeting an existing published work are rejected: unpublish, add
media, then republish. New uploads otherwise provision a draft work using
the existing team's columns. This adapter does not own portfolio metadata
editing, tags/year fields, event covers or large-video streaming.

Unique keys make repeated publication converge. A database lease prevents
simultaneous upload/publication/unpublication/reordering for the same work
across processes. Leases expire after five minutes following a process crash;
retry after expiry rather than modifying the lock table manually. Reorder
uses one database transaction and updates public derivative positions too.

Storage/database transitions are not a distributed transaction. Masters are
preflighted before any public writes; ordinary publication failures attempt
cleanup. Abrupt process termination may leave a public object or pending
lease. Retry publication/unpublication and verify actual storage state before
calling the operation complete. Public objects cannot be retroactively
removed from a visitor's browser/cache once downloaded.

## Local gates

```
npm ci --include=dev
npm run lint
npm run typecheck
npm test
npm run build
supabase db lint
npm run check:invariants
npm run test:auth
npm run test:access
npm run test:payments
npm run test:media
```

The browser rehearsal is profile avatar upload → dashboard media upload →
alt text → publish → anonymous artist page → reorder → unpublish. Confirm
the private original survives and the public storage URL is no longer served.
Include a foreign-account attempt and a corrupt/oversize file.

## Hosted release (not executed locally)

Verify API privileges, RLS, private drafts and owner folder policies on the
hosted database. Set only `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL` in the public app.
Never copy local credentials or introduce a service-role key into the browser.
Build a preview of the reviewed commit and run the browser rehearsal against
that exact deployment. Check its actual Vercel logs; earlier PR6 Vercel Error
status is not diagnosed or cleared by a local successful build.

Rollback the app to the previous deployment first. Leave additive schema/RLS
in place rather than dropping media tables or deleting private originals.
Database rollback requires a reviewed backup/restore plan, particularly if a
unique-key cleanup retained one of multiple historical rows.

Existing shared dependencies have npm audit advisories; the auth review
records them separately. Upgrade/retest the team baseline before claiming
production readiness. No hosted release, key rotation or production seed is
part of this local integration.
