-- @trak-suite mode=--parent-consent-journey-review in-all=true
-- Monday's first assessment, end to end, as the real accounts.
--
-- Synthetic fixtures only. Run after real migrations in a disposable database.
--
-- Since 20260921120000 the consent threshold is 18, so every academy player is
-- a child whose parent must approve before a coach can record anything. If any
-- link in this chain breaks, the pilot stalls at its first assessment:
--
--   player signs up and names a parent -> the invite exists for that address
--   -> the parent signs up with that address and accepts
--   -> the parent approves, with the app's exact notice version and wording
--   -> the coach's assessment, refused until now, is accepted
--   -> withdrawing consent closes the gate again
--
-- Every call is the one the app makes (src/lib/parent-invites.ts,
-- src/lib/parent-consent.ts, AuthContext provisioning), with its argument
-- names. Every "allowed" has a "refused" beside it, so a gate that is simply
-- open cannot pass, and a step that did not run cannot pass either.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing consent-journey fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.cj(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE cj_results (description text, passed boolean, detail text);
GRANT INSERT ON cj_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.cj_assert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.cj_results VALUES (description, ok IS TRUE, detail);
END;
$test$;

-- Refused means refused. Success, or any other error, is recorded as a failure
-- with its SQLSTATE, so a typo in the statement cannot pass as "refused".
CREATE FUNCTION pg_temp.cj_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege OR raise_exception OR check_violation THEN ok := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.cj_results VALUES (description, ok, failure);
END;
$test$;

CREATE FUNCTION pg_temp.cj_as(p_uid uuid, p_email text) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text, 'email', p_email)::text, true);
END;
$test$;

-- The accounts. The parent's address is the one the player types at signup.
-- The stranger is a second, unrelated parent: the negative control throughout.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.cj(1),  'admin@consent-journey.test',    now()),
  (pg_temp.cj(10), 'coach@consent-journey.test',    now()),
  (pg_temp.cj(20), 'player@consent-journey.test',   now()),
  (pg_temp.cj(30), 'parent@consent-journey.test',   now()),
  (pg_temp.cj(40), 'stranger@consent-journey.test', now());

INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.cj(100), pg_temp.cj(1), 'Consent Journey FC', 'CJRN01');

-- TRAK-12: Trak sets up staff. The operator admits the coach to the academy;
-- the coach's own signup below then completes an existing profile.
SELECT public.admit_staff_member(pg_temp.cj(10), 'coach', 'Journey Coach', pg_temp.cj(100));

SET LOCAL ROLE authenticated;

-- ── 1. The coach completes signup in the academy Trak placed them in ───────

SELECT pg_temp.cj_as(pg_temp.cj(10), 'coach@consent-journey.test');
DO $test$
BEGIN
  PERFORM public.provision_my_profile(jsonb_build_object(
    'role', 'coach', 'full_name', 'Journey Coach',
    'coach_details', jsonb_build_object('academy_code', 'CJRN01', 'current_club', 'Consent Journey FC')));
  PERFORM pg_temp.cj_assert(EXISTS (SELECT 1 FROM public.coach_details
      WHERE user_id = pg_temp.cj(10) AND organization_id = pg_temp.cj(100)),
    '1 the coach is in the academy, ready for the roster');
END;
$test$;

-- TRAK-48 slices 3 and 4: the roster is the only way into a squad. The
-- operator creates the coach's squad row with the child's roster place, and
-- the parent the child will name.
RESET ROLE;
INSERT INTO public.squad_players (coach_user_id, player_name, status)
VALUES (pg_temp.cj(10), 'Omar Synthetic', 'active');
SELECT set_config('trak.cj_sp', (SELECT id::text FROM public.squad_players
  WHERE coach_user_id = pg_temp.cj(10) AND player_name = 'Omar Synthetic'), true);
INSERT INTO public.roster_children (organization_id, squad_player_id, date_of_birth, child_email, loaded_by)
VALUES (pg_temp.cj(100), current_setting('trak.cj_sp')::uuid, (current_date - interval '15 years 2 months')::date,
        'player@consent-journey.test', 'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by)
SELECT id, 'parent@consent-journey.test', 'fixture' FROM public.roster_children WHERE child_email = 'player@consent-journey.test';
SET LOCAL ROLE authenticated;

-- ── 2. A 15-year-old signs up, names a parent, and joins the roster ─────────

SELECT pg_temp.cj_as(pg_temp.cj(20), 'player@consent-journey.test');
DO $test$
DECLARE v_sq uuid; v_invites integer; v_age integer;
BEGIN
  -- The payload AuthContext sends: provisioning creates the parent invite.
  PERFORM public.provision_my_profile(jsonb_build_object(
    'role', 'player', 'full_name', 'Omar Synthetic',
    'parent_email', 'Parent@Consent-Journey.test ',
    'player_details', jsonb_build_object('date_of_birth', (current_date - interval '15 years 2 months')::date::text,
                                         'position', 'Midfielder')));
  -- Signup claims the roster place and links its squad row (no code step).
  SELECT id INTO v_sq FROM public.squad_players WHERE linked_player_id = pg_temp.cj(20);
  PERFORM pg_temp.cj_assert(v_sq = current_setting('trak.cj_sp')::uuid,
    '2 the player joins the roster row the operator loaded', coalesce(v_sq::text, 'null'));

  SELECT (public.my_consent_status()->>'age')::integer INTO v_age;
  PERFORM pg_temp.cj_assert(v_age = 15 AND public.consent_threshold_age() = 18,
    '2 the player is 15 and the threshold is 18, so consent is required',
    'age ' || coalesce(v_age::text, 'null') || ', threshold ' || public.consent_threshold_age());

  -- What PlayerParentInviteCard lists for the player.
  SELECT count(*) INTO v_invites FROM public.get_player_invites_for_current_user()
  WHERE status = 'pending' AND lower(trim(parent_email)) = 'parent@consent-journey.test';
  PERFORM pg_temp.cj_assert(v_invites = 1,
    '2 signing up with a parent address creates one pending invite for it (case and spaces ignored)',
    v_invites || ' matching invite(s)');
  -- Kept for step 4's negative control. Read the way the app reads it: client
  -- roles have no direct grant on parent_invites (20260919120001).
  PERFORM set_config('trak.cj_invite', (SELECT id::text FROM public.get_player_invites_for_current_user()
    WHERE status = 'pending' LIMIT 1), true);
END;
$test$;

-- ── 3. Before consent: the coach is refused, and the screen can know why ────

SELECT pg_temp.cj_as(pg_temp.cj(10), 'coach@consent-journey.test');
DO $test$
BEGIN
  PERFORM pg_temp.cj_assert(public.coach_squad_player_consent_required(current_setting('trak.cj_sp')::uuid) IS TRUE,
    '3 the predicate #94 asks says consent is required');
END;
$test$;
SELECT pg_temp.cj_refused(format(
  'INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability)
   VALUES (%L, %L, 7,7,7,7,7,7)', pg_temp.cj(10), current_setting('trak.cj_sp')),
  '3 CONTROL the coach cannot assess the child before a parent approves');

-- ── 4. The parent: an unrelated adult sees nothing and can do nothing ───────

SELECT pg_temp.cj_as(pg_temp.cj(40), 'stranger@consent-journey.test');
DO $test$
DECLARE v_seen integer;
BEGIN
  SELECT count(*) INTO v_seen FROM public.get_my_pending_parent_invites();
  PERFORM pg_temp.cj_assert(v_seen = 0,
    '4 CONTROL an unrelated adult sees no invitation', v_seen || ' visible');
END;
$test$;
-- Slice 3: an adult the roster does not name cannot even create a parent profile.
SELECT pg_temp.cj_refused($$SELECT public.provision_my_profile(jsonb_build_object('role', 'parent', 'full_name', 'Stranger Synthetic', 'nationality', NULL))$$,
  '4 J1 an unrelated adult cannot create a parent profile');
SELECT pg_temp.cj_refused(format('SELECT public.accept_parent_invite(%L)', current_setting('trak.cj_invite')),
  '4 CONTROL an unrelated adult cannot accept the invitation');
SELECT pg_temp.cj_refused(format(
  $$SELECT public.record_parental_consent(%L, 'parent', '{"coaching_records":true,"recognition":false,"parent_visibility":true}'::jsonb, '2026-09-12.1', %L)$$,
  pg_temp.cj(20), 'I confirm I hold parental responsibility for this child and I authorise the processing I have selected above. I understand I can withdraw at any time from my profile, and that withdrawing stops future processing.'),
  '4 CONTROL an unrelated adult cannot give consent for the child');

-- ── 5. The named parent signs up with that address and accepts ──────────────

SELECT pg_temp.cj_as(pg_temp.cj(30), 'parent@consent-journey.test');
DO $test$
DECLARE v_invite uuid; v_name text; v_links integer;
BEGIN
  -- What loadParentInvitations reads before the parent has a profile.
  SELECT invite_id, player_name INTO v_invite, v_name FROM public.get_my_pending_parent_invites() LIMIT 1;
  PERFORM pg_temp.cj_assert(v_invite IS NOT NULL AND v_name = 'Omar Synthetic',
    '5 the named parent sees the invitation, with the child''s name', coalesce(v_name, 'nothing visible'));

  -- completeParentInvitation: provision as parent, then accept.
  PERFORM public.provision_my_profile(jsonb_build_object('role', 'parent', 'full_name', 'Parent Synthetic', 'nationality', NULL));
  PERFORM public.accept_parent_invite(v_invite);

  SELECT count(*) INTO v_links FROM public.player_parent_links
  WHERE parent_user_id = pg_temp.cj(30) AND player_user_id = pg_temp.cj(20);
  PERFORM pg_temp.cj_assert(v_links = 1, '5 accepting links the parent to the child', v_links || ' link(s)');
END;
$test$;

-- ── 6. The parent approves, with the app's exact notice and wording ─────────

DO $test$
DECLARE v_waiting integer; v_consent uuid; v_after integer;
BEGIN
  SELECT count(*) INTO v_waiting FROM public.get_children_awaiting_consent() WHERE player_user_id = pg_temp.cj(20);
  PERFORM pg_temp.cj_assert(v_waiting = 1, '6 the child appears on the parent''s approval screen', v_waiting || ' row(s)');

  -- recordParentApproval's payload: CONSENT_NOTICE_VERSION and CONSENT_STATEMENT
  -- from src/lib/consent.ts. consent-threshold-agreement-style drift between
  -- these literals and the app is caught by the seed mirror test (#81).
  v_consent := public.record_parental_consent(
    p_player_user_id => pg_temp.cj(20),
    p_relationship   => 'parent',
    p_purposes       => '{"coaching_records":true,"recognition":false,"parent_visibility":true}'::jsonb,
    p_notice_version => '2026-09-12.1',
    p_consent_text   => 'I confirm I hold parental responsibility for this child and I authorise the processing I have selected above. I understand I can withdraw at any time from my profile, and that withdrawing stops future processing.');
  PERFORM pg_temp.cj_assert(v_consent IS NOT NULL, '6 the parent''s approval is recorded');

  SELECT count(*) INTO v_after FROM public.get_children_awaiting_consent() WHERE player_user_id = pg_temp.cj(20);
  PERFORM pg_temp.cj_assert(v_after = 0, '6 the child leaves the approval screen once approved', v_after || ' row(s)');
END;
$test$;

-- ── 7. The coach's assessment is now accepted, and the player can see it ────

SELECT pg_temp.cj_as(pg_temp.cj(10), 'coach@consent-journey.test');
DO $test$
DECLARE v_sp uuid := current_setting('trak.cj_sp')::uuid; v_id uuid;
BEGIN
  PERFORM pg_temp.cj_assert(public.coach_squad_player_consent_required(v_sp) IS FALSE,
    '7 the predicate #94 asks now says no consent is required');
  INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability)
  VALUES (pg_temp.cj(10), v_sp, 7,7,7,7,7,7) RETURNING id INTO v_id;
  PERFORM set_config('trak.cj_assessment', v_id::text, true);
  PERFORM pg_temp.cj_assert(v_id IS NOT NULL, '7 the coach''s first assessment is accepted');
END;
$test$;

SELECT pg_temp.cj_as(pg_temp.cj(20), 'player@consent-journey.test');
DO $test$
DECLARE v_seen integer;
BEGIN
  SELECT count(*) INTO v_seen FROM public.coach_assessments WHERE id = current_setting('trak.cj_assessment')::uuid;
  PERFORM pg_temp.cj_assert(v_seen = 1, '7 the player can read the assessment', v_seen || ' visible');
END;
$test$;

-- ── 8. Withdrawing consent closes the gate again ────────────────────────────

SELECT pg_temp.cj_as(pg_temp.cj(30), 'parent@consent-journey.test');
DO $test$
DECLARE v_withdrawn integer;
BEGIN
  v_withdrawn := public.withdraw_parental_consent(pg_temp.cj(20));
  PERFORM pg_temp.cj_assert(v_withdrawn >= 1, '8 the parent can withdraw', v_withdrawn || ' withdrawn');
END;
$test$;
SELECT pg_temp.cj_as(pg_temp.cj(10), 'coach@consent-journey.test');
SELECT pg_temp.cj_refused(format(
  'INSERT INTO public.coach_assessments (coach_user_id, squad_player_id, work_rate, tactical, attitude, technical, physical, coachability)
   VALUES (%L, %L, 6,6,6,6,6,6)', pg_temp.cj(10), current_setting('trak.cj_sp')),
  '8 after withdrawal the coach is refused again');

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── Report ──────────────────────────────────────────────────────────────────
-- Failures are named in the exception itself: the runner does not print
-- WARNINGs, so a count alone would say that something broke but not what.
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.cj_results;
  IF total <> 20 THEN
    RAISE EXCEPTION 'Parent consent journey: % assertions ran; expected exactly 20', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Parent consent journey: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.cj_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Parent consent journey: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;
