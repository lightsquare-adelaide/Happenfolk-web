# Happenfolk

Formerly Lightsquare; the client approved the new name on 18 September 2026.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the shared branding convention and staged rename.

A Platform for Independent Artists — a collaborative showcasing platform for
independent artists in South Australia.

Group C262T-4103 · Client: Creative Professionals Network SA

## Scope

This repository implements **Section 3.1 (confirmed client requirements)** of the
Lightsquare Adelaide Project Proposal (final draft):

- A public discovery homepage requiring no sign-in, showing global trending
  artists and events.
- An artist sign-in and dashboard.
- Artist portfolios with multimedia work (images and descriptions at minimum;
  video is best-effort).
- Artist categories.
- Events carrying a name, location, date, time, optional images and at least one
  organising artist, **editable by every listed collaborator**.

The integrated implementation also includes free RSVP, simulated paid orders,
public work details, likes, collaboration availability, staff moderation, legal
pages and 90-day view retention with monthly aggregates. Payments are a simulator;
real charges, Stripe, messaging, follows/comments and an admin audit log are not
implemented.

Every pull request must tag the requirement it serves with its source layer.

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 (see `.nvmrc`) | `brew install node@22` or `nvm install` |
| Supabase CLI | repo-pinned 2.116.0 | `npx supabase` after `npm ci` |
| Colima + Docker CLI | latest | `brew install colima docker` |
| GitHub CLI | latest | `brew install gh` |

Node 22 is pinned deliberately: it matches the Vercel runtime. Building on a
newer Node locally can succeed while the deployment fails.

If you use Homebrew's `node@22`, it is keg-only — add it to your PATH:

```bash
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
```

## Setup

```bash
git clone https://github.com/lightsquare-adelaide/Happenfolk-web.git
cd Happenfolk-web

nvm use                 # or ensure node -v reports v22.x
npm ci

cp .env.example .env.local   # then fill in — ask the Project Lead for values

colima start            # one-time per boot; provides the Docker socket
npx supabase start      # local Postgres, Auth, Storage and Studio
npx supabase db reset   # replays migrations and loads fictional sample data

npm run seed:media      # upload generated sample placeholders
npm run dev             # http://localhost:3000
```

`supabase start` prints your local `API URL`, `anon key` and `service_role key`.
Put those in `.env.local` for local work.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, once |
| `npm run db:start` | Start the local Supabase stack |
| `npm run db:reset` | Drop and replay all migrations |
| `npm run db:lint` | Lint migrations |
| `npm run seed:media` | Upload generated images for the marked local sample dataset |
| `npm run smoke` | Read-only public/authorization probe; set `BASE_URL` |
| `npm run e2e` | Live temporary-account journey with cleanup; seeded staging/local target |
| `npm run smoke:browser` | Hydrated form/error-boundary probe with Chrome/Chromium |
| `npm run kill:next` | Stop only Next servers in this exact checkout |
| `npm run test:integration` | Seed, public surfaces and live HTTP journey |
| `npm run test:compliance` | Privacy, moderation, retention and accessibility checks |
| `npm run db:types` | Regenerate `src/types/database.ts` from the local schema |

Run `npm run db:types` after any migration and commit the result.

## Operations and verification

Read the [runbook](docs/runbook.md) for local environment mapping, deployment,
optional guarded remote sample seeding, smoke/e2e and rollback. Use the
[release checklist](docs/release-checklist.md) for handover, the
[architecture](docs/architecture.md) for data/access/test boundaries, and the
[defect log](docs/defect-log.md) for integrated fixes and remaining limitations.

`npm test` runs unit suites. DB suites run through their named commands against
a local stack; integration expects a fresh sample seed plus `seed:media` and
starts its own production server. Export `SUPABASE_DB_URL` or use
`node --env-file=.env.local scripts/check-invariants.mjs` for local invariants.
Sample data is fictional, includes private/hidden fixtures, grants no staff
access and leaves `demo.artist@happenfolk.test` available for the legacy demo.

## Secrets

`.env.local` is gitignored and must stay that way.

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row-Level Security. It must never appear in
a `NEXT_PUBLIC_*` variable, in a client component, or in any committed file. If
one is ever committed, rotate it in the Supabase dashboard immediately — removing
the commit is not sufficient.

## Branching and review

- `main` is protected. No direct pushes.
- Branch per vertical slice: `feat/events-joint-editing`, `fix/portfolio-upload`.
- Every change lands through a pull request with at least one reviewer. This is
  the risk register's mitigation for integration failures between the five
  verticals, and the evidence trail for individual assessment (criterion E6).
- A migration touching `profiles`, `media_assets` or `events` needs review from
  the other affected vertical owner (Ownership Change Register, C5).

## Verticals

| Member | Vertical |
|---|---|
| Mabin Noor Rashid | Accounts, Profiles & Portfolios |
| Yongzhe Shen | Events Module |
| Ziang Zhai | Public Discovery & Global Trending |
| Tingxuan Dai | Collaboration Layer |
| Wenheng Xie | Multimedia, Storage & Deployment |

## Stack

Next.js (App Router, TypeScript, Tailwind) · Supabase (Postgres, Auth, Storage) ·
Vercel. These are team implementation decisions under proposal Section 3.2, not
client-mandated technologies.
