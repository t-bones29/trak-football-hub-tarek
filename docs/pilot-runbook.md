# Trak pilot — operational runbook

Updated 8 October 2026. This is the maintained runbook. [MVP Requirements](../MVP%20Requirements)
defines scope and admission; the [journey index](use-cases/PILOT-INDEX.md) holds dated
verification evidence. Instructions below do not establish that the launch gate has passed.

## Before admitting real children

All J1–J8 journeys and G1–G7 guarantees must pass the launch gate, followed by a
founder-majority go decision. J8 events are required for the first pilot but are not
implemented or rehearsed yet. The start date, deployment window and rule for changes
during the pilot remain open.

There is no staging environment; production previews share the backend. An
isolated restore rehearsal requires a separate, explicitly configured target.
The decision recorded on TRAK-23 on 2 October 2026 at 19:18:57 UTC supersedes the
older open TRAK-46 note: daily backups retained for seven days, no PITR,
and, since 9 October, a required restore rehearsal on an isolated copy before
real families (TRAK-150). No recovery duration is
proven. **Academy disclosure is pending:** the academy has not been briefed.
Record the disclosure and go decision before launch. See [the restore procedure](release/s5-restore-rehearsal.md).

## Support and incidents

The agreed support path is a WhatsApp group for academy staff and the founders;
parents and children are not members. The first of Tarek, Imad or Kostas to read a
message replies and owns the fix. The internal aim is a reply within two hours;
no response time is promised to the academy. This policy still needs to be
communicated at the academy briefing.

In that group, use a child's first name and the problem only: no dates of birth,
contact details or screenshots of child data. More detail goes by direct call or
to support@trakfootball.com. Keep personal data and live calendar links out of
public issues and the repository.

For a wrong recipient, consent bypass or cross-child read, pause the affected
scope and new admissions immediately. The founders jointly own support and
escalation; a founder majority decides restart, subject to legal duties. Record
the affected journey, time, build and observed outcome without exposing family data.

## Releases and pilot configuration

Follow the [merge and deployment gate](release/merge-gate.md). The canonical main
workflow applies pending migrations and deploys edge functions before the frontend;
wait for both deployment jobs and verify the routed journey. Do not replay a short
historical migration list or assume a failed workflow undid earlier steps.

Before rehearsal or launch, the authorized operator reads the configured cohort:

```sql
SELECT org_id, starts_on, weeks, count_synthetic FROM public.pilot_config;
```

Match the organization, start date and reporting window to the agreed run. Use exact
organization IDs. A date never authorizes admission. `count_synthetic` may be enabled
for a designated synthetic rehearsal; it must be false for real-pilot reporting.
Record any configuration change and restore the previous settings after a rehearsal.

## Staff and roster admission

Trak creates staff accounts; coaches do not sign themselves up, choose their
academy or add children. An authorized operator creates each staff Auth user with
an auto-confirmed email and a long random password that is neither retained nor
sent, then admits the user through `admit_staff_member` as `postgres` in the SQL
editor. Create the admin before coaches:

```sql
SELECT public.admit_staff_member(
  (SELECT id FROM auth.users WHERE email = lower('<admin email>')),
  'club', '<Full Name>', NULL, '<Academy name>');
SELECT public.admit_staff_member(
  (SELECT id FROM auth.users WHERE email = lower('<coach email>')),
  'coach', '<Full Name>', '<academy UUID>'::uuid);
```

Check the resulting role and organization before contacting the person:

```sql
SELECT p.role, p.full_name, o.id AS organization_id, o.name AS academy
FROM public.profiles p
LEFT JOIN public.coach_details cd ON cd.user_id = p.user_id
LEFT JOIN public.organizations o
  ON o.id = cd.organization_id OR o.admin_user_id = p.user_id
WHERE p.user_id = (SELECT id FROM auth.users WHERE email = lower('<email>'));
```

**Set the academy's clock before its first event (TRAK-175).** Every academy
starts on `Asia/Dubai`. Events, emails, reminders, the calendar feed and the
age check all read `event_date` + `start_time` on this clock, so set it right
after admitting the admin; once the academy has an event it can't change.
An academy in Greece is `Europe/Athens`:

```sql
UPDATE public.organizations SET time_zone = 'Europe/Athens' WHERE id = '<academy UUID>'::uuid;
SELECT name, time_zone, min_player_age FROM public.organizations WHERE id = '<academy UUID>'::uuid;
```

Pass the same zone to the roster loader with `--time-zone`.

**Set the academy's consent age before its roster is loaded (TRAK-177).** Every
academy starts at 18: a guardian approves every under-18. Where the country's
digital-consent age is lower (Greece: 15), set it in the same step as the
clock, **before** loading the roster. Loaded at 18 and changed later, guardians
of 15–17s would be invited and approve, and those approvals stop counting at
the change, so the children wait for their own consent overnight.

```sql
UPDATE public.organizations SET consent_age = 15 WHERE id = '<academy UUID>'::uuid;
SELECT name, time_zone, consent_age, min_player_age FROM public.organizations WHERE id = '<academy UUID>'::uuid;
```

Pass the same age to the roster loader with `--consent-age`.

The staff member uses **Forgot password?** with their email, opens the email's
code-entry page, types the code and sets a password. Their profile is already
provisioned. Stored legacy invite codes are not an admission mechanism.

The academy supplies the child and guardian roster. Use
[`scripts/load-roster.mjs`](../scripts/load-roster.mjs); first validate without writes:

```bash
node scripts/load-roster.mjs --file '<roster.csv>' --org '<academy UUID>' --loaded-by '<operator name>'
```

For an academy not on Dubai time, add `--time-zone '<zone>'` (for example
`Europe/Athens`), matching `organizations.time_zone`. For an academy whose
consent age is below 18, add `--consent-age <n>` (for example `15`), matching
`organizations.consent_age`: a 15–17 child with their own email may then have
no guardian on the roster.

The CSV fields are `child_name,date_of_birth,age_group,child_email,guardian_emails,coach_email`.
Date of birth uses `YYYY-MM-DD`; multiple guardian addresses are separated with
semicolons. `child_email` may be empty. Use only designated, approved inboxes when
rehearsing email delivery; invented addresses at real mail providers can contact strangers.

Applying the reviewed roster requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and
`TRAK_CONFIRM_HOST` in the operator's environment. `--apply` writes; adding
`--send-invites` also sends guardian email. `--no-invites` explicitly suppresses mail.
Keep secrets out of browser configuration, shell transcripts and the repository.
A partial load does not roll back earlier admitted children: fix the reported row
and rerun the same file. The loader skips admitted rows and does not correct them.

## Invitations, codes and child logins

Invitation, sign-in and password-recovery emails use a typed code at `/auth/code`
(TRAK-107). A scanner opening the page must not consume the code. Use the latest
email and its matching address; the current page describes codes as single-use
with a one-hour expiry. A wrong or used code must show a clear failure.

**Confirm signup is separate:** it retains `/auth/confirm`, which verifies the
email and then signs out (TRAK-117). `/auth/code` supports invitation, sign-in and
recovery only. Do not convert confirm signup to the code-entry flow.

The four repository email templates have not yet been reconciled with the live
dashboard exports. **Do not paste them into Supabase.** Kostas must export the live
versions and verify each against its actual Auth flow before they become deployment
instructions again. See [README](../README.md#email-templates-live-export-required).

A guardian consents for each child before activation. For a child with email, the
invitation goes to the academy-supplied address. For a child without email, the
consenting guardian creates a username and password in the consent flow (TRAK-84).
The child then signs in with that username. The technical Auth address is not a
mailbox; do not send password recovery to it. A forgotten username is visible on
the guardian's Profile.

### A guardian resets a username child's password

On Profile, open the child's login card and choose **Set a new password**. The
reset ends the child's server sessions (TRAK-104). The open player app checks the
session every 30 seconds and when its tab becomes visible; a failed/offline check
cannot confirm sign-out, so measure the actual outcome during rehearsal.

- If the card says the password changed but other devices could not be signed out,
  set it again to retry session termination.
- An already-issued access token can remain usable until expiry. Report a lost or
  shared phone to the founders the same day; the UI sign-out is not proof that a
  copied token has stopped working.
- Email-account recovery uses **Forgot password?** with that account's email. The
  recovery code opens `/reset-password`; a username child uses the guardian flow.

### Guardian invitations that were never sent

A resumed load skips already admitted children. Recover missing sends with the
same roster file and `--reinvite`, first without `--apply`:

```bash
node scripts/load-roster.mjs --file '<roster.csv>' --org '<academy UUID>' \
  --loaded-by '<operator name>' --reinvite
```

This read requires the operator environment above. Review its line-number report;
adding `--apply` sends only to guardians who were never invited and have not signed
up. It loads no children and cannot be combined with `--send-invites` or `--no-invites`.

A guardian with several children receives one fresh invitation during the handler's
one-hour suppression window; their consent screen must list all relevant siblings.
The other rows may be marked invited without another email. Check the family view
before treating that as a delivery failure.

`--reinvite` deliberately does not resend a previously sent invitation. For an
expired or unusable code, use the account's password-recovery flow where applicable;
if setup cannot complete, escalate with roster child ID and time. Do not clear
invitation timestamps or improvise delivery to a different address.

## Wrong address

When the academy gave a wrong child or guardian email (TRAK-16, G5), the
operator corrects it with `scripts/correct-roster-email.mjs`. The database
records who corrected it, when and why in `roster_email_corrections`, which
holds hashes of both addresses, never the addresses themselves. Needs
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `TRAK_CONFIRM_HOST`, like the loader.

```bash
# 1. Dry run: reads the roster, changes nothing
node scripts/correct-roster-email.mjs --roster-child '<roster child id>' --kind guardian \
  --old '<wrong address>' --new '<right address>' --by "<your name>" --reason "<why>"
# 2. The same command with --apply writes it
```

- **Refused, "already claimed":** someone has already signed up with the
  wrong address. Don't work around it. It's an incident: tell the founders the
  same day, because a wrong adult may be linked to the child.
- **"An invitation had already gone to the old address":** record a G5
  near-miss on TRAK-16 (roster child id and time; no addresses). After the
  correction, that address can no longer claim the child.
- **Then re-invite** that roster child. The script sends nothing; the
  correction cleared `invited_at` so the new address gets the invitation.
- **A guardian with more than one child: correct every roster child that
  has the wrong address.** The address is stored once per child, so it sits
  on one roster row per sibling. Run the correction once for each of them,
  or the other child's invitation still goes to the wrong address. Find them
  first (read-only, in the SQL editor):

  ```sql
  SELECT roster_child_id FROM roster_guardians
  WHERE lower(btrim(email)) = lower(btrim('<wrong address>'));
  ```
- Keep addresses and command history on the authorized operator's machine; never
  paste either into Slack, Linear or the public repository.

## Wrong child name

A rostered child's name is the academy's roster name, everywhere (TRAK-103):
the coach, the family and the child all see `squad_players.player_name`. The
child can't change it, and neither can a direct edit of `profiles.full_name`,
not even by the table owner in the SQL editor. That is refused with 42501
"Your academy sets your name". When the academy gave a wrong name, correct it
on the roster's squad row; the child's profile follows by itself:

```sql
-- Find the squad row first (read-only): the child's roster id, from the load output.
SELECT sp.id, sp.player_name FROM roster_children rc
JOIN squad_players sp ON sp.id = rc.squad_player_id WHERE rc.id = '<roster child id>';
-- Then correct it:
UPDATE squad_players SET player_name = '<right name>' WHERE id = '<squad player id>';
```

Only the operator does this; no coach screen edits a name. The child sees
the name at setup ("You're added as …"), so ask families to report a wrong one.


## J7 — weekly measurement

Operational reports require the authorized operator SQL workflow or a trusted
server-side `service_role` connection. A club user's application session does not
have that role. In the reviewed project's SQL editor:

```sql
BEGIN READ ONLY;
SET LOCAL ROLE service_role;
SELECT * FROM public.pilot_j7_this_week;
ROLLBACK;
```

The report gives assessments per pilot coach (including zero), player opens and
parent opens for the configured pilot week. Record project, migration/build,
organization/window, querying role, date and values. Check cohort configuration
before interpreting an empty result.

| Measure | What it counts |
|---|---|
| Assessments | Distinct owned assessments saved through the UI that week, with a valid `assessment_submitted` event. An edit counts as that week's work; repeated saves of the same assessment do not multiply the count. |
| Player opens | Distinct child/assessment pairs whose home displayed a published message (`feedback_opened`). |
| Parent opens | Distinct parent/assessment pairs whose home displayed the child's latest bands (`assessment_viewed`). Parents do not see the coach's message. |

**Known limit (TRAK-71):** displaying a message on home is not evidence the child
chose to open or read it. The founders want a better measure; that definition and
numeric success targets remain open. General app-opening retention is separate.
Synthetic accounts must be excluded from real-pilot reporting.

Use `pilot_j7_assessments` and `pilot_j7_opens` for drill-downs through the same
restricted workflow. `squad_duplicate_candidates` reports potential duplicate
roster rows; review them rather than merging automatically. Historical scorecard
views are not substitutes for the current J7 definition or the launch gate.

## J8 — event operations required before launch

Events are required scope. Only the off switch is built so far (TRAK-124); the
status of the other slices lives in [TRAK-25](https://linear.app/trak-football/issue/TRAK-25)
and Linear. Families see only events the coach has published; a saved event is
a coach-only draft until then. Before real families receive events, complete all **nine** checks
in [MVP Requirements](../MVP%20Requirements), including one-tap calendar setup,
and the final production rehearsal in TRAK-141. The controls below are specified
behavior to build and rehearse; they are not current UI or executable procedures.

| Operation | Decided behavior | Implementation and proof still needed |
|---|---|---|
| Create/repeat | Training, matches and other events; eight weeks of weekly training in under two minutes. Match fields include kit. | Create/edit/cancel controls, recurrence and saved values. |
| Import fixtures | CSV preview is editable and flags bad rows before confirmation; no writes before confirmation and no duplicates on repeat import. The template includes date, kickoff, meet time, opponent, home/away, venue and kit; no opponent means training. | CSV only (PDF reading is out for now); no AI extraction. [TRAK-129](https://linear.app/trak-football/issue/TRAK-129). |
| Change/cancel | Every affected family sees the change on next app load. The parent's existing bell includes the selected child's events; the player's Next up marker clears when the event is opened. | Preserve existing assessment alerts and family boundaries. [TRAK-134](https://linear.app/trak-football/issue/TRAK-134). |
| Urgent change email | Cancelling a published event (any date, Imad 9 October), and changing the date, time, meet time or venue of one on today or tomorrow in Dubai time, emails affected guardians with active consent, and players with active consent who have their own email (never a no-email child's login address). Same-day mail must reach Gmail and Microsoft inboxes within 60 seconds. The subject is generic ("Training cancelled: Sat 17 Oct"), never coach-typed. No child name anywhere, no coach notes, and no state-changing links; the cancel reason is shown only if it names no squad child and has no link (Imad, 10 October). No Reply-To: every email ends "Questions about this event? Ask your coach/academy. Feedback or questions about the app? Send us an email at support@trakfootball.com". Guardians of children not yet signed up get no email, as in the app: **sign the children up before switching events on** for an academy. | **In review, not deployed** ([TRAK-135](https://linear.app/trak-football/issue/TRAK-135)). A database trigger queues one notice per event in `public.event_change_notices`; edits within 15 s join it. The coach's app then calls `send-event-emails`, which sends through the TRAK-126 sender at 8 per second, retries HTTP 429, and replaces coach-typed links (bare ones like `maps.app.goo.gl/x` too) with "(link in the Trak app)". Never twice: each email carries a Resend `Idempotency-Key` made from the person and the notices (Resend keeps it 24 hours), and each recipient is recorded in `event_change_deliveries`, so a later try skips them. If that record can't be written, the notice still finishes as `sent` with `last_error = delivery_not_recorded`. **Check:** `SELECT status, count(*) FROM public.event_change_notices WHERE created_at > now() - interval '1 day' GROUP BY 1;`. Anything `failed`, or `pending` for more than a minute, needs attention: `last_error` holds a reason code and never an address. **Retry:** a failed notice is retried automatically on the next call (3 tries, a minute apart). To send now, call the function with the secret key on `apikey` and body `{}`. A notice stuck in `sending` (the function died) is retaken after 10 minutes. A notice whose call never came, because the coach's phone lost signal, also goes on the next call; once TRAK-136 is in, the scheduler's sweep sends it within a minute (Scheduler, below). |
| Event reminder | Two days before an event (academy time), one email per published, scheduled event that day across their children (TRAK-243, Kostas's wording: "Coming up: <name>.", then when, venue, arrive by, and kit for a match). Same recipients as the change email (consented guardians, players with their own email, never a username login or .test address); cancelled events, drafts and withdrawn children are left out. The subject is generic and nothing coach-typed that names a child goes in. Turned off in Settings → Notifications (no row = on); no unsubscribe link in the email. | **In review, not deployed** ([TRAK-136](https://linear.app/trak-football/issue/TRAK-136)). The scheduler calls `send-event-reminders` between 09:00 and 20:00 Dubai while anyone is due. `public.event_reminder_sends` has one row per person and day, so a re-run never sends twice. Each email carries a Resend idempotency key for that person, day and event, so a retried row resends only what failed. **Check:** `SELECT reminder_day, status, count(*) FROM public.event_reminder_sends WHERE reminder_day >= current_date GROUP BY 1, 2;`. A `failed` row has `last_error` (a reason code, never an address); it is retried up to 3 times, a minute apart, then stays `failed`. **Send now:** call `send-event-reminders` with the secret key on `apikey` and body `{}`. |
| Scheduler (pg_cron + pg_net) | Three jobs, all UTC: `trak-event-change-sweep` every minute calls `send-event-emails` only when a change email is due, failed with tries left, or stuck (J8.12's lost-signal gap); `trak-event-reminders` every 5 minutes calls `send-event-reminders` only between 09:00 and 20:00 Dubai while someone is due; `trak-cron-history-cleanup` deletes run history older than 7 days. pg_cron approved by Imad (10 October); pg_net, which lets the database call a function, is a founder decision on the TRAK-136 PR. The calls carry the scheduler's own token (`x-trak-cron`), never an API key: pg_net keeps each queued request's headers where any database login can read them, and the token can only start a run that sends what is due. One reminder per person per day: an event added for a day after that person's reminder went out isn't reminded. The 09:00–20:00 window is the scheduler's; an operator calling `send-event-reminders` by hand sends at once. | **Setup, once per project, before merge (operator):** enable `pg_cron` and `pg_net` in Supabase → Database → Extensions (then the migration's `CREATE EXTENSION IF NOT EXISTS` does nothing on prod); make a token with `openssl rand -hex 32`; add it as Edge Function secret `TRAK_CRON_TOKEN`; in Supabase → Vault add `trak_functions_url` = `https://xbykbqolvqyqmipikuae.supabase.co/functions/v1` and `trak_cron_token` = the same token. Without them each call fails loudly in `cron.job_run_details` and nothing is sent. **Never** add `net` to the API's exposed schemas (Settings → API). **Rotate:** a new token in both places; the old one stops working at once. **Check:** `SELECT jobname, schedule, active FROM cron.job;` and `SELECT j.jobname, d.status, d.return_message, d.start_time FROM cron.job_run_details d JOIN cron.job j USING (jobid) ORDER BY d.start_time DESC LIMIT 20;`; a call's HTTP answer is in `net._http_response`. **Pause:** `SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'trak-event-reminders'), active := false);` (true to resume). The schedules are only created where pg_cron and pg_net exist, so test databases have none. |
| Subscribe to a personal calendar | A private bearer link belongs to a person, not a squad. Signup offers a skippable, one-tap native-calendar choice; Settings → Calendar offers it later. The feed has stable occurrence IDs, explicit cancellations and no child names or coach notes. | Apple, Google and Outlook behavior on real phones; the Android fallback and feed endpoint remain open. Record last fetched separately from when a phone displays the update. Counsel reviews this privacy design before real-family links. [TRAK-132](https://linear.app/trak-football/issue/TRAK-132), [TRAK-133](https://linear.app/trak-football/issue/TRAK-133). |
| Lost/shared calendar link | Settings → Calendar → Get a new link replaces the personal link; the old link must lose access on its next fetch. Treat an exposed link as access to private schedule data. | Replacement/revocation tests and instructions for resubscribing. A revoked feed cannot erase copies already cached on a phone; measure that behavior. Until implemented, escalate through support and never post the URL. |
| Withdraw consent or depart | The affected child's events disappear from the app and feed on the next request. Departure or link revocation must also remove the affected access. | Clarify and prove mixed-consent sibling handling in the parent's feed (TRAK-132); see OPEN-QUESTIONS. Test direct feed requests and app access separately from calendar caches. Do not call a successful server fetch proof of phone refresh. |
| Report absence | Everyone is expected to attend unless a linked guardian with active consent chooses Can't make it for the selected child. Optional short reason; undo until start. Players do not respond in v1. | Own-squad coach visibility, sibling separation, withdrawal denial and no other family's absence data. [TRAK-137](https://linear.app/trak-football/issue/TRAK-137). |
| Complete a past event | Take register starts with everyone present except reported absences; coach corrects attendance. Save creates/links one completed session, and retry must not duplicate it. A match opens the existing match log with date/opponent. | Past-event-only controls; withdrawn children cannot be marked present; assessment selection uses attended sessions. Preserve J4/J5. [TRAK-138](https://linear.app/trak-football/issue/TRAK-138): **database part in review, no screen yet.** `public.take_event_register(event, present squad rows)` runs as the coach under the J4 policies, links one session per event (`coach_sessions.event_id`, unique) and makes attendance exactly the list sent; the screen follows once J8.14 (#260) and J8.5 (#263) are merged. |
| Share in WhatsApp | A manual button prefills event details, including kit and cancellation reason. No child names or absence lists. The coach chooses the group and taps Send. | Prove training, match and cancellation text on iPhone and Android; the Trak button must never send automatically. [TRAK-139](https://linear.app/trak-football/issue/TRAK-139). |
| Disable events for one academy | Operator-only, per-academy switch in `public.academy_features`, no deployment. No row, or a failed read in the app, means off. **Every academy has events, Matches, Training, the new family look, Season plan, tasks and announcements on unless the founders say otherwise**: creating an academy adds the rows (`events`, `games`, `training`, `family_look`, `season_plan`, `tasks`, `announcements`), and every existing academy was switched on by the same migrations (TRAK-124, Imad 17 Oct; Matches and Training: TRAK-470, Imad 15 Nov; family look: TRAK-441, 16 Nov; Season plan: TRAK-524, Imad 21 Nov; tasks: TRAK-632, Imad 28 Nov; announcements: TRAK-634, Imad 28 Nov, after a live check). On: `INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'events');` Off: `DELETE FROM public.academy_features WHERE organization_id = '<academy id>' AND feature = 'events';` To test the off behaviour, switch one synthetic academy off for the check and back on afterwards. | Built and proven live (TRAK-124, #249): while off, the database refuses coach event writes and the schedule shows Coming soon. **Off does not yet hide existing events, calendar feeds or emails**; whether it should is an open question (OPEN-QUESTIONS). Switching an academy off is a founder decision. [TRAK-124](https://linear.app/trak-football/issue/TRAK-124). |
| Show a demo academy's squad by name | Operator-only switch `demo` in `public.academy_features`. **Only for a demo academy the founders made, never a real club.** With it on, a squad player with no account counts as consented, so the coach sees names and can record for them; a player with an account keeps the normal consent rules. On: `INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'demo');` Off: `DELETE FROM public.academy_features WHERE organization_id = '<academy id>' AND feature = 'demo';` | Built (TRAK-629, Kostas 28 Nov; Imad agreed). Off everywhere until switched on. DB test `supabase/tests/demo_academy.sql`. [TRAK-629](https://linear.app/trak-football/issue/TRAK-629). |
| Coach-only adult club: record for players with no account | Operator-only switch `adult_squads` in `public.academy_features`. **Only for a club whose players are all adults and who never use Trak, and only after the club has signed the processing agreement, certified every rostered player is 18 or over, and told its players their coaching records are kept in Trak.** With it on, a squad player with no account counts as consented when the roster age is 18 or over; under 18 or no age still waits; a player with an account keeps the normal consent rules. A coach can edit a roster age, so the club's certificate is what keeps under-18s out. On: `INSERT INTO public.academy_features(organization_id, feature) VALUES ('<academy id>', 'adult_squads');` Off: `DELETE FROM public.academy_features WHERE organization_id = '<academy id>' AND feature = 'adult_squads';` | Built (TRAK-630, Imad 28 Nov). Off everywhere until switched on. DB test `supabase/tests/adult_squads.sql`. [TRAK-630](https://linear.app/trak-football/issue/TRAK-630). |

[TRAK-140](https://linear.app/trak-football/issue/TRAK-140) is a lower-priority J8
follow-up after the core slices: named extra family/driver links, one/all children
and matches/all events, with independent revocation and last-fetch information.
Revoking an extra link must preserve the guardian's own link; withdrawal or departure
must remove the affected access. This is planned work, with no deployment evidence.

Actual-role tests must prove cross-academy isolation. Lineups and broader matchday
planning remain parked; kit and guardian absence reporting are part of J8. Automatic
WhatsApp posting, AI schedule import, direct Google/Microsoft account connections
and the academy console are outside this scope.

## Rehearsal and evidence

Use the [rehearsal script](rehearsal-script.html) with designated synthetic
families, approved Gmail/Microsoft inboxes, an iPhone, an Android phone with Google
Calendar and an Outlook account. Use one synthetic academy with events on and another
with events off. Existing seeds provide fixtures;
they do not prove current admission, consent, mail delivery or calendar behavior.
Do not purge or reload shared rehearsal data without coordinating the affected run.

For each check record commit, deployment/workflow, device, synthetic identity,
date/time, expected and observed results, and remaining limitations. Keep tokens,
codes, passwords, full calendar URLs and child data out of public evidence. A
missing event or failed check stays open; passing earlier journeys does not waive J8.
After the nine J8 checks, rerun J1–J7 and G1–G7 on the same final build. Capture
database readback, Auth/function logs, inbox receipt times and calendar refresh
results before cleanup. A workaround does not turn a failed check into a pass
([TRAK-141](https://linear.app/trak-football/issue/TRAK-141)).
