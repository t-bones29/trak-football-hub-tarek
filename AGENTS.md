# AGENTS.md — Trak Football

## Before changing the product

Read [MVP Requirements](MVP%20Requirements) and the assigned Linear issue.
The first real-child pilot requires J1–J8 and G1–G7; J8 events are required
but still await implementation and rehearsal. A configured date never admits
children. [PILOT-INDEX](docs/use-cases/PILOT-INDEX.md) separates required scope
from recorded deployment evidence.

Agents work their human's assigned issues. Use a task branch and one PR per
issue, with its `TRAK-#` and J/G or scope/launch-gate purpose in the title.
Follow [the release gate](docs/release/merge-gate.md) before review, merge or
release. Imad coordinates the merge queue in #coding-agents-at-work. The owner
moves merged work to Verifying, then Done after recording deployed proof.

This repository is public. Keep academy identities, competitor analysis and
private meeting/artifact links out of new documentation and evidence. Use
synthetic identities in public test records. Current unresolved decisions stay
explicitly open; an issue being Done does not prove a newer requirement passed.

## Find the implementation

| Task | Start here |
|---|---|
| Routes, parked screens and callers | `src/App.tsx`, then the routed component |
| Role guard | `src/components/layout/RouteGuard.tsx` |
| Authentication and admission | `src/contexts/AuthContext.tsx`, `src/lib/parent-consent.ts` |
| Database client and generated types | `src/integrations/supabase/` |
| Rating and bands | `src/lib/rating-engine.ts`, `src/lib/types.ts` (`BANDS`) |
| Shared UI | `src/components/trak/` |
| Backend permissions and RPCs | `supabase/migrations/` in filename order |
| Pilot operations and recovery | `docs/pilot-runbook.md`, `docs/release/s5-restore-rehearsal.md` |
| Use-case contracts | `docs/use-cases/registry.yaml`, `docs/use-cases/OPEN-QUESTIONS.md` |

Read the actual route and its callers before editing a component.
`CoachQuickMatchLog` is not the routed J4 match entry. `/coach/quick-assess`
remains hidden; the pilot uses `/coach/assess`. Existing AI handlers return
`PILOT_FEATURE_DISABLED`; their presence is not permission to enable them.

## Data and UI conventions

- Use `.maybeSingle()` when zero or one row is expected, arrays for one-to-many
  relationships, and handle errors separately from empty results.
- `coach_assessments.squad_player_id` refers to a `squad_players` row, not an
  Auth user ID. Resolve the player's squad rows before querying assessments.
- Coach match logging uses `log_match_for_player`; direct inserts do not
  substitute for its consent and assignment checks.
- Follow the existing mobile shell and design tokens. Use `BANDS` for band
  wording and colors; keep player-visible messages separate from private notes.
- The roster owns the child's name. A child email is optional. Use the existing
  guardian-created login/recovery flow for a child without email (TRAK-84).
- Before changing consent, read the discrepancy recorded in MVP J2: optional
  parent visibility is stored but does not control family reads. Reconcile
  wording and enforcement; do not promise a choice the backend ignores.

## Local work and checks

Use Node 22.15+ within 22.x and the npm version in `package.json`.

```sh
npm ci --legacy-peer-deps
cp .env.example .env  # configure a disposable development project
npm run dev          # localhost:8080
npm test             # source tests, once
npm run test:watch    # watch mode
npm run test:harness
npm run typecheck
npm run lint
npm run uc:check
npm run build
```

`package.json` and `.github/workflows/ci.yml` define the current commands and
full CI checks. Run checks appropriate to the change and the release gate.
Pending use cases report failures without blocking; they are not passes.
Edit `registry.yaml`, then regenerate its README with `npm run uc:report`.
Preserve enforced contracts and the registry lock/version rules.

Local dev accounts read `VITE_DEV_PASSWORD`. Keep credentials out of source,
evidence and built assets; a DEV-only route does not guarantee its chunk is
excluded from a production bundle.

## Database and deployment

Create new migrations; keep applied migration history unchanged. Replay on a
disposable database and test permissions under real authenticated roles. Some
historical migrations cannot safely be rerun. New public tables start without
`anon`/`authenticated` privileges; grant only operations backed by policies.

Production is `trakfootball.com` on Vercel, with Supabase as the backend.
The canonical main workflow applies pending migrations and deploys functions
before deploying the frontend. Vercel's Git integration is disabled. A PR
preview shares the backend; there is no separate staging environment. Use
reviewed deployments for production changes, never development SQL on the
shared project.

`supabase/config.toml` controls function JWT settings. `vercel.json` controls
rewrites, caching and CSP; verify allowed origins when adding an integration.
Email templates are managed separately in the dashboard. Read the
[README export warning](README.md#email-templates-live-export-required) before
touching them: repository copies are stale and must await the complete live
exports. Signup confirmation has a different flow from the three code emails.
