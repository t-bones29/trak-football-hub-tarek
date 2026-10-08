# S5 — recovery procedure and restore rehearsal

Owner: Kostas. Updated 8 October 2026. **Restore remains unrehearsed; no recovery
duration has been measured.** This is an unexecuted procedure, not recovery proof.

## Accepted risk and pending disclosure

The decision on TRAK-23, 2 October 2026 at 19:18:57 UTC, supersedes the older open
TRAK-46 note: daily backups retained for seven days, no point-in-time recovery
(PITR), and acceptance of the unrehearsed
restore risk for the pilot. There is no staging environment. A second synthetic
academy inside production is an isolation fixture, not a separate environment or
backup.

**The academy has not been briefed. Disclosure is pending**, with a meeting expected
in the coming weeks. Record that disclosure and the accepted risk in the launch
decision. A backup and this written procedure do not establish a recovery time or
prove that all application services can be restored. Admission still requires the
full [MVP launch gate](../../MVP%20Requirements), including J8, and founder-majority go.

Before relying on a backup, Kostas must inspect the actual available backups and
record the selected timestamp, completion state and retention window. The 2 October
decision is not evidence that today's backup succeeded. Writes after the selected
backup may be lost; measure that interval in an incident rather than promising a
fixed maximum.

## What must be recovered

This procedure uses a restore into a new project. Supabase documents that it copies
the database, while service configuration needs further work. Recheck these
[restore-to-new-project requirements](https://supabase.com/docs/guides/platform/clone-project)
when executing:

- Restore the selected database and validate schema, data, grants, policies and Auth
  records against a captured baseline, allowing for writes newer than the backup.
- Restore/deploy edge functions from the reviewed source and `supabase/config.toml`;
  do not rely on the old four-function inventory.
- Reconfigure Auth settings, API keys, SMTP, redirect allow-list, function secrets
  and any applicable Realtime or extension settings. Export the actual settings
  securely before execution; do not reconstruct them from an old document.
- Storage file bytes are not included in database backups. Metadata can survive
  without its file: an empty `storage.objects` result is not the expected recovery
  test. Verify required objects separately. Child photos remain out of pilot scope.
  See [Supabase backup limitations](https://supabase.com/docs/guides/platform/backups).

Database extensions that perform external work may run immediately in a restored
project. Inspect scheduled jobs, webhook triggers and other outbound integrations
before starting; a rehearsal must not contact real families or repeat production
side effects. If this cannot be controlled, resolve the isolation method before
executing the restore.

Email templates are dashboard configuration, not CI output. The repository's four
legacy templates are awaiting Kostas's live export (TRAK-107); do not restore them
from the repository. Preserve and verify the code-based invitation, sign-in and
password-recovery templates, their SMTP configuration, `/auth/code` flow and the
`/reset-password` destination. **Confirm signup stays separate:** preserve its
`/auth/confirm` verification-then-sign-out flow (TRAK-117); do not convert it to
`/auth/code`, which accepts only invitation, sign-in and recovery types. Keep
exports containing private configuration out of the public repository.

### Planned J8 services and access state

The expanded [TRAK-25](https://linear.app/trak-football/issue/TRAK-25) scope has nine
acceptance checks and 18 implementation issues, all Todo when reviewed on 8 October.
It introduces recovery concerns that must be added to an executed procedure once
the services exist; this document supplies no invented tables or commands:

- Capture per-academy event-switch state and prove off/missing/error settings fail
  closed, including database writes (TRAK-124). Restore must not enable events for
  an academy that was disabled after the backup.
- Reconcile personal and extra family/driver feed links, revocations, replacements,
  guardian/child access and departures (TRAK-132/133/140). The planned store holds
  token hashes; a database backup does not recover the original bearer URLs. An old
  backup can revive an old hash/revocation state, so reconcile later revocations
  before permitting requests. Validate every still-valid link after a target change;
  the feed endpoint remains undecided. Cached phone entries are a separate limitation.
- Configure the new ordinary-email sender separately from Supabase Auth mail.
  Provider, region, sender and server-side secrets remain to be selected (TRAK-126).
  Do not assume an Auth template or SMTP setting recovers event notifications.
- Inspect urgent-change delivery state and two-day reminder schedules, opt-outs,
  retry/deduplication records and job failures (TRAK-135/136). Restoring old state
  must not resend already delivered notices, send stale changes or ignore a later
  opt-out. Keep outbound work controlled until this is reconciled; no approved
  scheduler installation or retry procedure is established here.
- Compare events, cancellations, fixture imports, reported absences and completed
  attendance to the backup age (TRAK-129/137/138). Do not recreate events through
  an import or register retry without proving duplicate protection.

These checks do not establish recovery readiness. Record implementation gaps and
keep the affected service paused when reconciliation cannot be proved.

## Prepare the target and record the baseline

Kostas confirms the target, current dashboard cost and rehearsal cleanup plan
before starting a charged restore. Keep the original project intact. There is no
standing staging project to reuse.

Capture current source commit, applied migration versions, table counts, RLS and
grant definitions, function definitions, relevant settings and available backup
timestamps in an authorized private record. Counts from September are not expected
values for a new run. Never include credentials, tokens or family data in public
proof.

Before repointing anything, find every source and configuration reference to the
current project:

```bash
rg -n 'xbykbqolvqyqmipikuae|SUPABASE_PROJECT_ID|SUPABASE_DB_URL|VITE_SUPABASE' \
  .github src supabase scripts e2e vercel.json seed-admin-data.mjs
```

| Configuration | Check for the restored target |
|---|---|
| `vercel.json` | CSP `connect-src` and `img-src` permit the intended backend. |
| Frontend build | `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, plus fallbacks in `src/integrations/supabase/client.ts`, name the intended target. |
| CI credentials | `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL` and the deployment token's access scope match the intended target. Never change production CI credentials for a rehearsal. |
| `supabase/config.toml` | Review project configuration and every function's authentication setting. CI uses explicit target arguments. |
| Auth and functions | Verify actual site URL, redirect destinations, SMTP, live code templates, function secrets and API keys. |
| J8, when implemented | Review feed endpoint/credentials, revocations and event switches; separately configure ordinary event mail, reminder jobs, opt-outs and delivery deduplication. |
| Test/operator tools | Check hardcoded hosts and safety guards before any invocation. |

The canonical workflow in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
deploys production from main. A throwaway branch does not automatically create a
usable recovery preview. Review the exact preview deployment method and target
configuration before starting the rehearsal.

## Rehearsal — production remains on its original backend

These steps have not been executed end to end. Use designated synthetic accounts
and explicitly authorized infrastructure; recording this plan authorizes no live
restore, email or configuration change.

1. Record `T0`, the baseline, chosen backup timestamp, new-project cost and the
   controls preventing outbound side effects. Save the original configuration.
2. Restore that backup to a new project. Record the new ref, database version and
   time the database is ready. Keep production secrets, production frontend
   configuration and main unchanged.
3. Compare restored schema, data and access controls to the backup's expected
   state. Explain differences caused by writes after that backup; do not expect
   a stale backup to equal today's production row counts.
4. Configure the isolated target's Auth, SMTP, live exported email templates and
   necessary function secrets. Deploy the reviewed functions with their target
   set explicitly. Keep pilot-disabled AI disabled.
5. Build an isolated preview using a throwaway branch and preview-scoped backend
   values/CSP. Verify its served bundle and network requests point only to the
   restored target. Verify production still points to the original target.
6. Complete current admission, consent, activation/recovery and coach-to-family
   readback using synthetic identities. Include negative access and withdrawal
   checks. Test username-child creation/reset separately from email recovery.
   When J8 exists, include its nine acceptance checks and the recovery controls
   above, with approved synthetic inboxes and isolated feed URLs. Record gaps
   caused by differences from the production environment.
7. Record `T_done` only once the synthetic journey succeeds on the isolated
   preview. Capture failures and missing services explicitly. This is rehearsal
   duration; it is not a measured production recovery duration.
8. After preserving evidence and confirming production is unaffected, remove the
   approved disposable resources and preview configuration. Confirm billing and
   outbound integrations no longer depend on the rehearsal target. Verify the
   original production journey again.

## Real recovery — incident only

Stop the merge queue and follow the [incident/release gate](merge-gate.md). The
incident owner establishes the affected scope, preserves the original system and
records the backup choice and known loss window. Recovery steps remain subject to
that incident's authorization.

Restore and validate the new backend as above. Before reconnecting real users,
reconcile security-sensitive changes newer than the backup, especially consent
withdrawals, account deletions, corrected recipients and staff access. An old
backup must not silently restore processing permission that was withdrawn.
For J8, also reconcile later calendar-link revocations/replacements, event-switch
changes, notification opt-outs and already delivered mail. Record unresolved
differences and keep affected processing paused.

Prepare a reviewed change for the frontend target/CSP and the exact production
configuration changes. Repoint CI's database/project credentials and frontend
build values only as part of that coordinated cutover. A main merge runs migrations,
functions and frontend deployment: inspect which steps actually completed.

Verify the served build, backend target, Auth/code recovery, permission boundaries
and synthetic routed journeys on `trakfootball.com`. For an event-enabled release,
verify calendar links and delivery after cutover too. Record `T_done` after this
verification, then obtain the incident restart decision. Keep the original project
and evidence until the founders agree what can be retired. Do not delete the
restored project: it is now the production target.

A database restore is not a general release rollback. Prefer the compatible
frontend/forward-repair options in the merge gate when those address the incident
without losing newer data or security fixes.

## Verification and evidence record

Run metadata queries through the authorized operator workflow. Compare with the
captured baseline and backup age; there are no fixed table/policy counts here:

```sql
SELECT count(*), max(version) FROM supabase_migrations.schema_migrations;
SELECT count(*) FILTER (WHERE c.relrowsecurity) AS rls_on, count(*) AS tables
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname IN ('public', 'storage', 'trak_private')
ORDER BY schemaname, tablename, policyname;
```

Counts and SQL definitions alone cannot prove isolation. Use authenticated-role
checks with controls showing the protected rows exist: another family's data and
another academy's data remain unreadable; private notes remain inaccessible to
children and parents; withdrawn consent blocks development writes/readback. Prove
the applicable G1–G7 guarantees and record every failure.

```text
Run type: rehearsal / incident recovery
Owner and independent reviewer:
Source commit, workflow and served build:
Start/end timestamps (UTC):
Source and restored project refs:
Backup timestamp and completion state:
Baseline captured at; expected differences since backup:
Database-ready time; complete-journey time:
Data loss interval and affected records/categories:
Schema/data/grants/policies comparison:
Auth, code emails, functions and session checks:
Authenticated-role controls and negative checks:
Consent/deletion/recipient corrections reconciled:
Storage metadata versus actual files:
J8 nine checks, or not yet implemented:
J8 feed revocations, switches, mail jobs/opt-outs/deduplication reconciled:
Device, synthetic identities, expected/observed outcomes:
Production target verified before/after:
Missing services, failures and limitations:
Cost; cleanup/cutover authorization and verification:
Academy disclosure and incident communications record:
```

This file stays marked unrehearsed until an executed evidence record supports a
new status. Enabling PITR or establishing staging would be a new decision; neither
is assumed by this procedure.
