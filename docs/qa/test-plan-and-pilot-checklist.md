# Happenfolk — QA Test Plan & Pilot Checklist (DRAFT)

**Prepared:** 27 October 2026
**Owner:** Tingxuan — Registration / QA
**Workstream:** Registration / QA (Tingxuan)
**Environment under review:** Happenfolk client-feedback preview (`https://happenfolk-preview.vercel.app`) and integrated `main` as applicable.
**Execution status:** **NOT RUN**. This is a planning artifact, not proof that any test passed.

## Context and release boundary

- Team update describes the preview as a **demonstration** built from an isolated branch and a **fake-data** database. It should not be merged into `main` and should not be circulated outside the team/client.
- Accounts, profiles, portfolios, media uploads and dashboard are demonstrated as implemented.
- Newsfeed, events and search use sample data in the preview; Participate / Follow / Collaborate are marked **Coming soon**.
- PR #13, #14 and #15 were merged into `main` on 25 October 2026. The Events implementation is proposed in PR #32 and is **not yet merged** as of this plan. Register/Participate functionality needs separate verification and integration.
- Do not enter real customer details, real payment information or production credentials in the preview.

## Test matrix

| ID | Priority | Test case / steps | Expected outcome | Execution |
|---|---|---|---|---|
| QA-01 | P0 | Sign up with a disposable email; complete onboarding. | Profile/account is created and redirects to the intended protected page without exposing another user's data. | Not run |
| QA-02 | P0 | Log out, then open `/dashboard` directly. | User is redirected to sign-in. Previously authenticated information is not displayed. | Not run |
| QA-03 | P0 | Create a profile, set it unpublished, open `/artists/[handle]` in an anonymous/private window. | An unpublished profile is not visible to anonymous visitors; published profile can be viewed. | Not run |
| QA-04 | P1 | Change display name and handle; use a handle already owned by a different test account. | Valid edits save; duplicate handles show a safe user-facing error; stale handle-check results must not override current input. | Not run |
| QA-05 | P0 | Using two test accounts, inspect each user's dashboard and unpublished works. | The second account cannot view or edit the first account's private records. | Not run |
| QA-06 | P1 | Add a portfolio item, publish/unpublish it, and inspect the public artist page. | Public visitors see published items only; unpublishing removes the item from public display. | Not run |
| QA-07 | P1 | Check image/avatar or media upload with an allowed file and an unsupported file. | Allowed files upload; unsupported/oversized files fail clearly without leaking private originals. Confirm applicable size limit with the deployed branch. | Not run |
| QA-08 | P1 | Open Events and Newsfeed pages in the preview. | Pages load, but test report explicitly identifies sample content; do not mark event creation/registration as implemented from sample data alone. | Not run |
| QA-09 | P0 | Click **Participate** on a preview event. | **Known gap:** demo currently displays “Coming soon.” Record feature as not implemented, not as a successful end-to-end registration. | Not run |
| QA-10 | P1 | Click **Follow** and **Collaborate** actions. | **Known gaps:** preview shows “Coming soon.” Record as pending. | Not run |
| QA-11 | P1 | Check mobile viewport and keyboard navigation on sign-in, profile, dashboard, artist and Events pages. | Content remains readable, controls usable, no horizontal overflow or keyboard traps. | Not run |
| QA-12 | P0 | After actual registration integration, try sign-in continuation, duplicate registration, cancellations, sold-out events, and access to **My Registrations**. | Registration persists exactly once; errors and statuses are accurate; user sees only their own registrations. **Blocked until Participate/My Registrations integration is available.** | Not run / blocked |

## Pilot readiness checklist

- [ ] Confirm with Mabin which URL/branch and feature set the pilot will assess.
- [ ] Confirm a demo/test environment with fake data only and disposable test accounts.
- [ ] Identify 2–3 pilot testers and obtain permission to record feedback/screenshots.
- [ ] Record browser, device, date, page, expected result, actual result, and reproduction steps for every issue.
- [ ] Run critical P0 cases first; distinguish **Passed**, **Failed**, **Blocked**, and **Not run**.
- [ ] Separate known sample-data/Coming-soon limitations from unexpected defects.
- [ ] Review accessibility and responsive behavior on at least desktop and mobile.
- [ ] Do not include passwords, service-role credentials, real personal data or API secrets in bug reports.
- [ ] Agree with the team which blocking defects prevent a client-facing pilot.
- [ ] Present an evidence summary and create a PR for any QA files or test automation under your branch.

## Bug report template

**Title:** [P0/P1/P2] Component — concise issue
**Environment / branch:**
**Steps to reproduce:** 1. ... 2. ... 3. ...
**Expected:**
**Actual:**
**Evidence:** screenshot / logs with no credentials or personal data
**Owner / status:**

## Next engineering handoff for Tingxuan

1. Compare local Dashboard, Events and My Registrations code against the current `main` and PR #32 before making a PR. Avoid replacing already-merged Dashboard or overlapping the in-flight Events work.
2. Prioritise the real Participate → sign-in/onboarding continuation → registration → My Registrations flow, subject to confirming the agreed project scope and backend status with Mabin.
3. Add negative cases (unauthenticated, other user's registrations, duplicate click, cancellation, capacity) and tests; create a feature branch, note requirement IDs in the PR, and request team review.
4. Track QA execution separately from this unexecuted draft. Never report planned checks as passed checks.
