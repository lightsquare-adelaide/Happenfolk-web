# Happenfolk QA / pilot deliverables — Tingxuan

- [Test plan and pilot checklist](test-plan-and-pilot-checklist.md): requirements, test matrix, limitations, and pilot readiness.
- [Execution log](test-execution-log.csv): fill the **Actual**, **Status**, **Run date**, and **Evidence link** columns only after executing each case in the appropriate environment.

**Current status: draft, tests NOT RUN.** No real-user data, credentials or service-role keys are included. The preview is a fake-data client demo and must not be merged into main.

Priority execution once a test environment is accessible: QA-01, QA-02, QA-03, QA-05; run QA-12 only when the registration integration is deployed to an approved test branch. Obtain Mabin's scope approval before any client pilot.

## Integration verification (team's current UI)

After the new stacked integration script has passed its checks, see
[Integrated registration verification](integrated-registration-verification.md)
and [Week 9 individual contribution](tingxuan-weekly-contribution.md).
The older `test-execution-log.csv` is a manual pilot checklist and its
`Not run` statuses must not be silently changed to `Pass` on the strength
of unrelated automated unit/API tests. The integrated browser workflow
and mobile appearance require a fresh human check before sign-off.
