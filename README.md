# Trak Football

Youth football coaching records for players, coaches and linked guardians.
The first pilot's required journeys, including events, are defined in
[MVP Requirements](MVP%20Requirements); recorded evidence is in
[PILOT-INDEX](docs/use-cases/PILOT-INDEX.md). A feature's presence in the source
does not establish that it is admitted to the pilot.

## Prerequisites

- Node.js 22.15 or later 22.x (matching CI; `.nvmrc` selects the latest 22.x). On 22.14 `npm test` fails with unhandled `BroadcastChannel` errors.
- npm 11.6.0 (the version declared by `packageManager`)
- A [Supabase](https://supabase.com) project (free tier works)

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/kostasanastasioubusiness-lang/trak-football-hub.git
cd trak-football-hub

# 2. Select Node 22 and install locked dependencies
# If you use nvm:
nvm install
nvm use
npm ci --legacy-peer-deps

# 3. Configure environment
cp .env.example .env
# Edit .env and fill in your Supabase URL and publishable key (sb_publishable_…)

# 4. Use a disposable development database
# Replay migrations in filename order; see AGENTS.md.
# Never run development SQL against the shared production project.

# 5. Start the dev server
npm run dev
```

The app runs at http://localhost:8080.

Without nvm, install Node 22 some other way. npm refuses a different Node major (`devEngines` in `package.json`). Don't bypass it: on Node 24 the enforced assessment test (UC-C04) fails because jsdom's AbortSignal is rejected by Node's native `Request`.

## Running Tests

```bash
npm test            # source tests, once (used in CI)
npm run test:watch  # watch mode
npm run test:harness
npm run uc:check    # enforced use cases block; pending failures are reported
```

## Linting & Build

```bash
npm run lint      # ESLint — warnings are fine, errors block CI
npm run build     # Vite production build → dist/
```

## Deployment

Production is **trakfootball.com**, hosted on Vercel. Vercel's own Git integration is
disabled (`git.deploymentEnabled: false` in `vercel.json`), so `.github/workflows/ci.yml`
is the only route to a deployment — the `deploy` job needs `test`, meaning nothing
reaches production unless lint, typecheck, tests and build all passed first.

Nothing else auto-deploys. The Supabase half of the app ships separately, and
forgetting this is the usual reason a merged change appears to do nothing:

| What changed | How it ships |
|---|---|
| `src/**` | `deploy` job, on merge to `main` |
| `supabase/migrations/*.sql` | `supabase` job (`db push`), on merge to `main` |
| `supabase/functions/**` | `supabase` job (`functions deploy`), on merge to `main` |
| `email-templates/*.html` | Supabase dashboard → Authentication → Email Templates, **by hand** |

Merging to `main` ships the frontend *and* the backend. The `supabase` job runs
before `deploy`, so a build that calls a new RPC can never reach production ahead
of the migration that creates it, and a failed migration stops the frontend from
shipping at all.

The `supabase` job deliberately does not run `supabase link`: linking fetches the
project's API keys, which would mean giving the CI token read access to the
service-role key. It passes `--db-url` and `--project-ref` explicitly instead, so
the token needs only Edge Functions and Migrations. Required secrets:
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL`.

Email templates are the one exception — they live in the dashboard and cannot be
deployed from the repo. `supabase/config.toml` is the source of truth for each
function's `verify_jwt`; a value changed in the dashboard is overwritten on the
next deploy.

For local work the CLIs need no global install (`npm i -g` fails against a
root-owned prefix on a stock macOS Node):

```bash
npx --yes supabase@latest login
npx --yes supabase@latest migration list
```

`vercel.json` holds the SPA rewrite, asset caching, and the security headers. Its
CSP pins the Supabase and Sentry hosts, so any new external origin must be added
to `connect-src` or it is blocked in production.

## Environment Variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key, `sb_publishable_…` (public; the legacy anon JWT stops working at the end of 2026, TRAK-96) |
| `VITE_SENTRY_DSN` | (Optional) Sentry DSN — only active in `PROD` |

See `.env.example` for the template.

## Project Structure

```
src/
  components/
    trak/           Shared design-system components (MobileShell, NavBar, BandPill, …)
    player/         Player-specific components (RatingTrendChart, CardRevealModal)
    club/           Club-specific components (ClubNavBar)
    icons/          TrakIcons SVG components
  contexts/
    AuthContext.tsx Auth state, sign-up / sign-in, profile creation
  lib/
    rating-engine.ts  computeMatchScore() — core rating algorithm
    types.ts          BANDS, BandType, UserRole
    telemetry.ts      trackEvent() helper
    squad-analytics.ts calculateSquadAnalytics()
  pages/
    player/         PlayerHome, PlayerMatches, PlayerEvolutionCard, PlayerPassport, …
    coach/          CoachHomePage, CoachSquadPage, CoachAssessPage, CoachAssistant, …
    parent/         ParentHome, ParentMatches, ParentAlerts
    club/           ClubHome, ClubSquads, ClubCoaches, ClubRadar
  integrations/
    supabase/       Generated Supabase client + types
supabase/
  migrations/       SQL migration files (apply in order)
  functions/        Edge Functions (coach-assistant, parse-schedule,
                    player-feedback, send-parent-invite)
```

## User Roles

| Role | Sign-up path | Key features |
|---|---|---|
| **Player** | Academy roster, guardian consent, then email invitation or guardian-created username/password | Bands, coach message, coach-recorded history |
| **Coach** | Coordinated academy setup | Squad, completed sessions, attendance and assessments |
| **Parent** | Academy-supplied guardian address and invitation | Consent, selected child's bands/history, child activation and recovery |
| **Club admin** | Coordinated academy setup | Academy console remains coming soon |

J8 events and family calendars are required for launch and still await their
implementation and deployed rehearsal. AI, recognition, passport/sharing and
child photos remain outside the pilot.

## Contributing

Read [AGENTS.md](AGENTS.md) and [the release gate](docs/release/merge-gate.md)
before editing. Work on the assigned issue in a branch, record checks and
limitations, and obtain an independent review. The CI workflow defines its
triggered branches and checks; a local commit alone does not run it.
