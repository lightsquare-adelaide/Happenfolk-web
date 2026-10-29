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

Features in the proposal's **Future Implementation** tier — messaging,
opportunities and applications, team formation, follows/feeds/comments, MFA,
three-level privacy, moderation console, audit logs, payments and Stripe — are
**not built here**. They are preserved in the Future Implementation Register.

Every pull request must tag the requirement it serves with its source layer.

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 (see `.nvmrc`) | `brew install node@22` or `nvm install` |
| Supabase CLI | latest | `brew install supabase/tap/supabase` |
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
git clone https://github.com/lightsquare-adelaide/Lightsquare-web.git
cd Lightsquare-web

nvm use                 # or ensure node -v reports v22.x
npm ci

cp .env.example .env.local   # then fill in — ask the Project Lead for values

colima start            # one-time per boot; provides the Docker socket
supabase start          # local Postgres, Auth, Storage and Studio
supabase db reset       # replays every migration from scratch

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
| `npm run db:types` | Regenerate `src/types/database.ts` from the local schema |

Run `npm run db:types` after any migration and commit the result.

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
