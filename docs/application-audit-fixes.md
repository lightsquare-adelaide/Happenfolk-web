# Application audit fixes

This layer addresses the application and tooling findings from the 26 October
2026 audit. Database integrity fixes are delivered alongside it as additive
migrations; the original applied migrations remain unchanged.

- Onboarding keeps the signed-in member's assigned handle without querying its
  availability as if it belonged to someone else. Pending responses for older
  input are ignored. Category conflicts receive a readable error; unexpected
  database errors are not exposed to the form.
- Sign-out validates Origin and cross-site fetch metadata before revoking the
  session. The shared origin check retains the proxy-host handling already used
  by media uploads, including local ports.
- Responses include content-type sniffing protection, frame denial, a referrer
  policy, and restrictive camera/microphone/geolocation permissions. These are
  baseline headers, not a claim that a nonce-based CSP has been implemented.
- Visible product names and page metadata use `BRAND.name`. Historical migration
  comments, repository URLs, and the existing Supabase project identifier remain
  unchanged in accordance with CONTRIBUTING.
- The anonymous profile test creates its own private and published fixtures. It
  proves the private fixture is hidden and the deliberately published fixture is
  visible; unrelated public data no longer makes the suite fail.
- Access scenario 12 has a reversible red guard. The original trending view is
  renamed intact while the local test substitutes an intentionally unsafe view;
  restoration preserves its columns, grants, options, and dependent objects.
- Test servers use available ports at or above 3801 and retain process cleanup.
  Vitest resolves the same `@/` source aliases as the application.

## Dependency remediation

Next.js and eslint-config-next are pinned together at 16.4.3, sharp at 0.35.5,
and zod at 4.6.7. `npm audit fix` updated vulnerable transitive dependencies
without forcing a major-version change. `npm audit --include=dev` reported zero
vulnerabilities locally after the lockfile update.

Sources reviewed before the update:

- [Next.js October security update](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
- [Next.js 16.4](https://nextjs.org/blog/next-16-4)
- [Next.js 16.4.3 release](https://github.com/vercel/next.js/releases/tag/v16.4.3)
- [Supabase changelog](https://supabase.com/changelog)

Use `npm ci --include=dev` for development and verification. A global npm
`omit=dev` configuration otherwise omits the test and lint tools.

## Verification boundaries

The sign-out regressions first returned 303 for two forbidden cross-site
requests; the corrected route rejects both with 403 before calling signOut.
The core lint, typecheck, unit and production build gates and an actual browser
registration-to-sign-out-to-sign-in journey are exercised during integration.
The signed-in narrow navigation issue is tracked for the following design-system
layer; a successful desktop journey does not imply that mobile visual check has
passed. The legacy Vercel project requires account access to inspect its failure;
this code change does not claim that deployment is fixed.
