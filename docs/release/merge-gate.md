# Merge and deployment gate

Reviewed for the 8 October 2026 documentation audit. Imad coordinates releases.
Every PR needs one approval from someone who did not author it. Imad merges in
the agreed order, one at a time. Use a task branch; no direct pushes to main.

Real children join only when the J1–J8 launch gate in
[MVP Requirements](../../MVP%20Requirements) passes and a founder majority
agrees. J8 events have their own nine acceptance checks and production-phone
rehearsal. Neither a past synthetic rehearsal nor a configured start date
waives the gate.

## Review and approval

The 19 September review decision remains in force. A non-author's review:

1. States what they ran or exercised, with results relevant to the change.
2. Lists findings and their fixes or explicit acceptance.
3. Ends with **MERGE**, **MERGE AFTER <fix>**, or **DO NOT MERGE**.

A human non-author must also approve in GitHub after the latest push, with
required checks green and conversations resolved. An author's self-review or
an agent reviewing its own human's PR is not independent approval. Updating
the branch may invalidate approval; finish branch updates before requesting it.

The 8 October API check reported main as protected and named the required
checks `test` and `Base branch still reaches main`. The full protection endpoint
was not accessible to the audit account, so this does not verify every admin
setting. The reviewed target configuration is
[main-branch-protection.json](main-branch-protection.json): one independent
approval after the last push, current-base checks, resolved conversations and
admin enforcement. `Supabase` and `Deploy` run after merge, not as PR checks.
An administrator should compare the live settings with that file before
changing protection; committing the JSON does not apply it.

The old unprotected-branch Slack-verdict fallback no longer applies. CODEOWNERS
exists, but the proposed reduced-approval route for documentation is not an
agreed replacement for the one-approval rule.

## Before merge

- Read the assigned issue and name its journey, guarantee or launch-gate purpose.
  Agree the acceptance checks in the PR description. Use one issue per PR.
- Coordinate migration/RPC changes and shared-file reservations in
  #coding-agents-at-work. The author or an explicitly authorized delegate posts
  the notice. Keep private child data out of public evidence.
- Update from current main; identify dependent PRs and compatibility between SQL,
  edge functions, callers and generated types. Keep historical migrations intact.
- Run `npm test`, `npm run test:harness`, `npm run typecheck`, `npm run build`,
  `npm run lint` and `npm run uc:check`. Run the executable SQL checks when a
  migration changes. For documentation, also check references, generated
  registries and deleted-file backlinks. Record pending use-case failures as
  debt, not proof of correctness; the changed journey must pass its own checks.
- Behaviour changes need regression evidence that fails without the fix.
  Documentation changes need source and reference verification. Preserve the
  pre-commit hook; never bypass it to manufacture a green commit.
- Obtain the independent review and GitHub approval, then let the coordinator
  merge when all required checks pass on the final commit.

## During the pilot: decision open

The 8 October discussion has not settled which features or fixes may ship,
notice periods, the deployment window, urgent-change approval or a duty rota.
A 48-hour notice, a quiet deployment window, a 15-minute verification period
and rollback in seconds are proposals, not established policy or measured
capabilities. Existing review and release requirements continue until an agreed
replacement is recorded here and implemented. Do not infer an emergency bypass.

There is no separate staging environment. Synthetic and real organizations use
the same website and database; a second academy fixture tests isolation only.
The academy has not yet been briefed as of 8 October. The forthcoming briefing
must cover this and the recorded backup/recovery limitations; record completion
rather than describing it as already disclosed.

## After merge

Wait for the full workflow before the next schema merge. Canonical main's
workflow serializes production releases. It applies pending migrations and
edge functions, then deploys the frontend only after a successful Supabase job.
Missing production credentials fail the workflow. Fork CI cannot deploy
production. Preview deployments share the backend and do not prove a new
migration before it is applied.

Verify both production jobs and the affected routed journey on trakfootball.com
with designated synthetic accounts. Record commit, workflow URL, migration
version, role, expected and observed outcome, device/browser and limitations.
The owner posts the result on the issue and coordinates its Slack notice,
distinguishing merged, deployed and verified. Move to Done only with deployed
proof; otherwise leave Verifying and record the blocker.

## Failed release and recovery

1. Stop the merge queue. Record the commit, failed job and observed user impact.
   For a wrong recipient, consent bypass, cross-child read, safeguarding concern
   or stop/delete request, also pause the affected scope and new admissions as
   required by the pilot incident rule.
2. Determine which migrations and functions actually applied. A failed workflow
   does not undo earlier steps. Preserve deployment logs and identify the last
   known compatible frontend and backend state.
3. Choose the repair with the coordinator. Repair schema/permissions using a
   reviewed forward migration. If restoring a previous frontend, first verify
   it remains compatible with the current backend and retains security fixes.
   Do not erase migration history or restore a former access-control defect.
4. The operator records the exact deployment selected, executes the reviewed
   recovery action, verifies both service state and the affected journey with
   synthetic accounts, and records timing and limitations. There is no verified
   one-command rollback or promised recovery time in this audit.
5. The coordinator resumes the merge queue after the release is verified.
   Restart after an incident covered by the pilot pause rule requires a founder
   majority, subject to legal duties. A privacy or safeguarding incident also
   follows the runbook's escalation path. The urgent-change approval policy
   remains open; these steps do not create a bypass.

The last recorded decision (2 October, TRAK-23, superseding the earlier open
TRAK-46 note) accepts daily backups retained for seven days, no point-in-time
recovery and an unrehearsed restore for the pilot. These settings need checking
at admission; recovery duration remains unmeasured. A restore can lose writes
since the selected backup. See [the restore record](s5-restore-rehearsal.md)
before any restore; a database restore is not a frontend rollback.

## Fork-first development

The existing rule places Imad/Codex changes in `imadd23x/trak-football-hub`,
with `kostasanastasioubusiness-lang/trak-football-hub` as canonical upstream.
Use the assigned human's agreed fork and permissions; resolve an account/fork
mismatch with the coordinator before pushing rather than assuming an identity.
Keep regression tests on the task branch. Fork CI runs checks only; never copy
production credentials into the fork. After checks pass, open the PR against
canonical main and follow the independent review gate above.
