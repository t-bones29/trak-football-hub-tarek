# Pilot use cases: source map

Reviewed 8 October 2026 against repository source at
[`d0ed55f`](https://github.com/kostasanastasioubusiness-lang/trak-football-hub/tree/d0ed55ff618ee0a0b943399236527f9e3f7ebbb5)
and the dated decisions and rehearsal records linked below. This is a map for
finding the relevant contract, code and evidence. It does not certify current
production behavior, the absence of defects or readiness to admit real children.

## Read the right source

| Question | Source |
|---|---|
| What belongs in the first pilot? | [MVP Requirements](../MVP%20Requirements), J1–J8 and G1–G7 |
| What passed on a deployed build, and when? | [Pilot journey index](use-cases/PILOT-INDEX.md), with build, device, role and date |
| Which use-case tests block commits? | [Generated registry report](use-cases/README.md); `enforced`, `pending` and `parked` are harness statuses |
| What wording remains unresolved? | [Use-case questions](use-cases/OPEN-QUESTIONS.md) and the open items in MVP Requirements |
| Who owns implementation and acceptance? | The linked Linear issue; a PR or a passing local test is not completion |
| How do changes reach production? | [Release gate](release/merge-gate.md) |
| How are admission, recovery and incidents operated? | [Pilot runbook](pilot-runbook.md) and [restore procedure](release/s5-restore-rehearsal.md) |
| What data and legal decisions need review? | [Data inventory](data-inventory.html) and [UAE counsel brief](lawyer-meeting-brief-uae.md) |

## Journey map

The code links identify the audited source paths. Read the complete flow and
its migrations before changing it; file existence is not behavioral proof.

| Journey | Required behavior | Source entry points | Evidence / remaining work |
|---|---|---|---|
| J1 Admission | Concierge roster; only rostered children and supplied guardians; child email optional; roster name throughout. No child self-linking or coach add-player path. | [Roster loader](../scripts/load-roster.mjs), [audited email correction](../scripts/correct-roster-email.mjs), [AuthContext](../src/contexts/AuthContext.tsx), [consent-before-account migration](../supabase/migrations/20260927090000_roster_consent_before_account.sql) | TRAK-8/48/84/103; dated synthetic evidence in PILOT-INDEX. Real academy configuration remains an admission gate. |
| J2 Guardian consent | Guardian invitation names child and purpose; recorded consent, siblings, one-tap withdrawal and no wrong-adult delivery. | [Invitation handler](../supabase/functions/send-roster-invites/handler.ts), [parent consent](../src/lib/parent-consent.ts), [withdrawal](../src/lib/parent-consent-withdrawal.ts), [parent profile](../src/pages/parent/ParentProfilePage.tsx) | Runs 3–6 cover the invitation and consent journeys. Optional consent wording/enforcement discrepancy is open in MVP Requirements. |
| J3 Activation and recovery | Consent first. Email invitations use a typed code; no-email children use guardian-created credentials. Resets invalidate child sessions; roster name is retained. | [AuthCode](../src/pages/AuthCode.tsx), [child-login creation](../supabase/functions/create-child-login/handler.ts), [password reset](../supabase/functions/reset-child-password/handler.ts), [guardian credentials](../src/components/parent/ParentChildCredentials.tsx) | TRAK-84/103/104/107; run-6 resend evidence on TRAK-11 and PR #243. Signup confirmation remains a separate [AuthConfirm](../src/pages/AuthConfirm.tsx) flow. |
| J4 Completed sessions | Coach records matches and training with attendance, consent checks and explicit save failures. | [CoachAddSession](../src/pages/coach/CoachAddSession.tsx), [squad](../src/pages/coach/CoachSquadPage.tsx), `log_match_for_player` and session/attendance migrations | TRAK-7/102; synthetic run-3 through run-5 evidence. J8 conversion must preserve this flow. |
| J5 Assessment and message | Assessment on an attended completed session; one Save publishes the child-facing message; private note is coach-only. | [CoachAssessPage](../src/pages/coach/CoachAssessPage.tsx), [coach player profile](../src/pages/coach/CoachPlayerProfilePage.tsx), [private/shared split](../supabase/migrations/20260918135500_private_notes_and_shared_feedback.sql) | TRAK-5/63/64/68/100; registry UC-C04 remains enforced. |
| J6 Family readback | Child sees message and bands; parent sees selected child's bands/history, never the message or private notes. Failed load is distinguishable from empty data. | [PlayerHome](../src/pages/player/PlayerHome.tsx), [ParentHome](../src/pages/parent/ParentHome.tsx), [family context](../src/contexts/ParentChildrenContext.tsx), [parent-message exclusion](../supabase/migrations/20260926120000_parents_do_not_read_coach_messages.sql), [consent-aware family reads](../supabase/migrations/20260927130000_family_reads_follow_consent.sql) | TRAK-6/71/74/77; run-4 sibling-switch proof is recorded in PILOT-INDEX. |
| J7 Measurement | Weekly coach-assessment counts and distinct player/parent assessment opens for the configured cohort; exclude synthetic accounts. | [J7 measurement views](../supabase/migrations/20260926130000_pilot_j7_measure.sql), PlayerHome and ParentHome telemetry, [runbook](pilot-runbook.md) | TRAK-10. A player open means the message was shown, not deliberate reading. Value targets and a better reading measure remain open. |
| J8 Events | Weekly schedules; fixture import; match kit; family app views and private calendar links with one-tap setup; change/cancellation delivery; parent absence response and coach attendance; withdrawal and isolation; manual WhatsApp sharing. | [TRAK-25](https://linear.app/trak-football/issue/TRAK-25), its 18 scoped subissues TRAK-124–141, MVP Requirements J8, registry UC-E01–UC-E09 | Required before launch. TRAK-25 is Todo as of 8 Oct, 14:19 UTC; specific choices remain open in the slices. No implementation or real-phone rehearsal proof established. Existing calendar code is not proof of the new contract. |

## Safety and parked surfaces

G1–G7 require tests as authenticated roles, including negative tests with
positive controls. The existing synthetic rehearsal evidence does not cover
J8's new event and calendar access paths. Inspect the [route table](../src/App.tsx),
backend permissions and [G7 closure migration](../supabase/migrations/20260923110906_pilot_g7_disable_media_and_ai.sql)
together: a retained screen or schema is not permission to use a parked feature.

AI tools and AI schedule import, player passport/sharing, child photos, recognition,
player-entered match logging and academy console remain outside the pilot.
Lineups and broader matchday planning remain parked under
[TRAK-123](https://linear.app/trak-football/issue/TRAK-123). Match kit, CSV/PDF
fixture import and a parent's “Can't make it” response are now J8. Automatic
WhatsApp posting and direct Google/Microsoft calendar connections remain out.
Coach-only birthday
reminders on the day and profile preferred-foot/stat additions are post-pilot;
any UAE FA synchronization is future work, with no height or weight collection
in that agreed scope. Account-data export is distinct from the parked player
passport: `export_my_account()` exists, while the self-service screen remains
tracked under [TRAK-81](https://linear.app/trak-football/issue/TRAK-81).

## Limits of this audit

- The production records cited in PILOT-INDEX are dated synthetic rehearsals,
  not new production checks performed by this documentation update.
- J8 now has 18 scoped slices. Its remaining choices, feature controls and
  operator procedures still need resolution, implementation and proof; see
  [OPEN-QUESTIONS](use-cases/OPEN-QUESTIONS.md). The pilot change policy and
  launch date remain open.
- No PITR and an unrehearsed restore are recorded as accepted pilot risks in
  TRAK-23 (2 Oct). Academy briefing and risk disclosure have not yet happened.
- Counsel sign-off, academy agreement, actual cohort configuration and the
  founder-majority admission decision still belong to the launch gate.
- Source migration counts, historical dashboards and old “no open defects”
  statements are not readiness evidence. Use the dated issue and deployment
  record for the question being answered.
