-- @trak-suite mode=--roster-consent-review in-all=true
-- TRAK-11 phase 1 (J2/J3, docs/superpowers/specs/2026-09-25-consent-first-admission-design.md):
-- a guardian the academy rostered consents for a child who has no account yet,
-- and that consent becomes the child's the moment they sign up.
-- Synthetic fixtures only; run after real migrations in a disposable database.
-- The whole suite is one transaction and rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing roster consent fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.rc(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98800000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE rc_results (description text, passed boolean, detail text);
GRANT INSERT ON rc_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.rc_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.rc_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.rc_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- Expects a refusal with this SQLSTATE; any other outcome fails.
CREATE FUNCTION pg_temp.rc_refused(statement text, expected_state text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> expected_state THEN failure := SQLSTATE || ': ' || SQLERRM; END IF;
  END;
  INSERT INTO pg_temp.rc_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.rc_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.rc_results VALUES (description, coalesce(ok, false), detail);
$test$;

CREATE FUNCTION pg_temp.rc_consent(p_roster_child uuid, p_purposes text DEFAULT '{"coaching_records":true,"recognition":false,"parent_visibility":true}')
RETURNS text LANGUAGE sql AS $test$
  SELECT format($$SELECT public.record_roster_consent(%L, 'legal_guardian', %L::jsonb,
    '2026-09-12.1', 'Synthetic roster consent.')$$, p_roster_child, p_purposes);
$test$;
CREATE FUNCTION pg_temp.rc_signup(p_role text, p_name text) RETURNS text LANGUAGE sql AS $test$
  SELECT CASE p_role
    WHEN 'parent' THEN format($$SELECT public.provision_my_profile(jsonb_build_object('role', 'parent', 'full_name', %L))$$, p_name)
    ELSE format($$SELECT public.provision_my_profile(jsonb_build_object('role', 'player', 'full_name', %L,
      'player_details', jsonb_build_object('date_of_birth', '2013-01-01', 'position', 'Defender')))$$, p_name)
  END;
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Children: 70 Ana (13, account later), 71 Ben (13, removed from the roster),
-- 72 Cleo (adult), 73 Dan (13, consent withdrawn before signup).
-- Guardians: 20 of Ana, Cleo and Dan; 21 of Ben; 22 named for Ben but never claimed.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.rc(1),  'admin@roster-consent.test',      now()),
  (pg_temp.rc(2),  'coach@roster-consent.test',      now()),
  (pg_temp.rc(10), 'ana@roster-consent.test',        now()),
  (pg_temp.rc(13), 'dan@roster-consent.test',        now()),
  (pg_temp.rc(20), 'guardian-a@roster-consent.test', now()),
  (pg_temp.rc(21), 'guardian-b@roster-consent.test', now()),
  (pg_temp.rc(22), 'unclaimed@roster-consent.test',  now());
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.rc(1),  'club',   'RC Admin'),
  (pg_temp.rc(2),  'coach',  'RC Coach'),
  (pg_temp.rc(22), 'parent', 'Unclaimed Guardian');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.rc(50), pg_temp.rc(1), 'RC Academy', 'RC-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.rc(2), pg_temp.rc(50));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group) VALUES
  (pg_temp.rc(60), pg_temp.rc(2), 'Ana Synthetic',  'U14'),
  (pg_temp.rc(61), pg_temp.rc(2), 'Ben Synthetic',  'U14'),
  (pg_temp.rc(62), pg_temp.rc(2), 'Cleo Synthetic', 'Senior'),
  (pg_temp.rc(63), pg_temp.rc(2), 'Dan Synthetic',  'U14');
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, loaded_by) VALUES
  (pg_temp.rc(70), pg_temp.rc(50), pg_temp.rc(60), '2013-03-04', 'ana@roster-consent.test',  'fixture'),
  (pg_temp.rc(71), pg_temp.rc(50), pg_temp.rc(61), '2013-05-06', 'ben@roster-consent.test',  'fixture'),
  (pg_temp.rc(72), pg_temp.rc(50), pg_temp.rc(62), '2000-01-01', 'cleo@roster-consent.test', 'fixture'),
  (pg_temp.rc(73), pg_temp.rc(50), pg_temp.rc(63), '2013-07-08', 'dan@roster-consent.test',  'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by) VALUES
  (pg_temp.rc(70), 'guardian-a@roster-consent.test', 'fixture'),
  (pg_temp.rc(72), 'guardian-a@roster-consent.test', 'fixture'),
  (pg_temp.rc(73), 'guardian-a@roster-consent.test', 'fixture'),
  (pg_temp.rc(71), 'guardian-b@roster-consent.test', 'fixture'),
  (pg_temp.rc(71), 'unclaimed@roster-consent.test',  'fixture');

SET LOCAL ROLE authenticated;
-- The two guardians sign up the real way, which claims their roster rows.
SELECT pg_temp.rc_as(pg_temp.rc(20));
SELECT pg_temp.rc_allowed(pg_temp.rc_signup('parent', 'Guardian A'), '0 CONTROL guardian A signs up and claims their roster rows');
SELECT pg_temp.rc_as(pg_temp.rc(21));
SELECT pg_temp.rc_allowed(pg_temp.rc_signup('parent', 'Guardian B'), '0 CONTROL guardian B signs up and claims their roster row');

-- ── 1. Guardian A sees the account-less children waiting for them ───────────
SELECT pg_temp.rc_as(pg_temp.rc(20));
SELECT pg_temp.rc_check(
  (SELECT array_agg(roster_child_id ORDER BY roster_child_id) FROM public.get_roster_children_awaiting_consent())
    = ARRAY[pg_temp.rc(70), pg_temp.rc(73)],
  '1 J2 a guardian sees their account-less under-18 children waiting (not the adult, not another family''s)');
SELECT pg_temp.rc_check(
  (SELECT first_name = 'Ana' AND age_years = date_part('year', age(current_date, DATE '2013-03-04'))::int
   FROM public.get_roster_children_awaiting_consent() WHERE roster_child_id = pg_temp.rc(70)),
  '1 J2 each waiting child carries only a first name and an age');
SELECT pg_temp.rc_check(NOT EXISTS (SELECT 1 FROM public.get_children_awaiting_consent() WHERE player_user_id IS NULL),
  '1 CONTROL the account-based list never returns an account-less row (its screen parser rejects one)');

-- ── 2. Who may not consent ─────────────────────────────────────────────────
SELECT pg_temp.rc_as(pg_temp.rc(21));
SELECT pg_temp.rc_refused(pg_temp.rc_consent(pg_temp.rc(70)), '42501',
  '2 J2 a guardian of another child cannot consent for this one');
SELECT pg_temp.rc_as(pg_temp.rc(22));
SELECT pg_temp.rc_refused(pg_temp.rc_consent(pg_temp.rc(71)), '42501',
  '2 J2 an unclaimed guardian address cannot consent');
SELECT pg_temp.rc_as(pg_temp.rc(20));
SELECT pg_temp.rc_refused(pg_temp.rc_consent(pg_temp.rc(72)), '22023',
  '2 J2 an adult child needs no guardian consent, so none is recorded');
SELECT pg_temp.rc_refused(pg_temp.rc_consent(pg_temp.rc(70), '{"coaching_records":false}'), 'P0001',
  '2 G1 a consent that does not grant coaching_records is refused');
SELECT pg_temp.rc_as(NULL);
SELECT pg_temp.rc_refused(pg_temp.rc_consent(pg_temp.rc(70)), '42501',
  '2 J2 no signed-in guardian, no consent');

-- ── 3. Guardian A consents for Ana, who has no account ─────────────────────
SELECT pg_temp.rc_as(pg_temp.rc(20));
SELECT pg_temp.rc_allowed(pg_temp.rc_consent(pg_temp.rc(70)), '3 J2 a claimed guardian consents for an account-less roster child');
SELECT pg_temp.rc_check(
  (SELECT array_agg(roster_child_id) FROM public.get_roster_children_awaiting_consent()) = ARRAY[pg_temp.rc(73)],
  '3 J2 a consented child leaves the waiting list');
RESET ROLE;
SELECT pg_temp.rc_check((
  SELECT count(*) = 1 AND bool_and(c.player_user_id IS NULL AND c.parent_user_id = pg_temp.rc(20)
    AND c.threshold_age = public.consent_threshold_age()
    AND c.player_age_at_consent = date_part('year', age(current_date, DATE '2013-03-04'))::int)
  FROM public.parental_consents c WHERE c.roster_child_id = pg_temp.rc(70) AND c.withdrawn_at IS NULL),
  '3 J2 the consent names the roster child, the guardian, the threshold and the age at consent');
SELECT pg_temp.rc_check((
  SELECT relationship = 'legal_guardian' FROM public.roster_guardians
  WHERE roster_child_id = pg_temp.rc(70) AND parent_user_id = pg_temp.rc(20)),
  '3 J2 the guardian''s declared relationship is written to their roster row');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rc_as(pg_temp.rc(21));
SELECT pg_temp.rc_refused($$SELECT public.withdraw_roster_consent('98800000-0000-0000-0000-000000000070')$$, '42501',
  '3 G6 a guardian of another child cannot withdraw this child''s consent');

-- ── 4. Ana signs up: the consent becomes hers ──────────────────────────────
SELECT pg_temp.rc_as(pg_temp.rc(10));
SELECT pg_temp.rc_allowed(pg_temp.rc_signup('player', 'Ana Synthetic'), '4 CONTROL Ana signs up and claims her roster place');
RESET ROLE;
SELECT pg_temp.rc_check(public.player_has_parental_consent(pg_temp.rc(10))
    AND NOT public.squad_player_consent_required(pg_temp.rc(60)),
  '4 J3 the roster consent carries over: Ana''s account and squad row are consented');
SET LOCAL ROLE authenticated;
SELECT pg_temp.rc_as(pg_temp.rc(20));
SELECT pg_temp.rc_refused(pg_temp.rc_consent(pg_temp.rc(70)), '42501',
  '4 J3 once the child has an account, consent goes through their account, not the roster');

-- ── 5. Withdrawn before signup stays withdrawn after it (Dan) ──────────────
SELECT pg_temp.rc_allowed(pg_temp.rc_consent(pg_temp.rc(73)), '5 CONTROL guardian A consents for Dan');
SELECT pg_temp.rc_check((SELECT public.withdraw_roster_consent(pg_temp.rc(73))) = 1,
  '5 G6 guardian A withdraws before Dan has an account');
SELECT pg_temp.rc_as(pg_temp.rc(13));
SELECT pg_temp.rc_allowed(pg_temp.rc_signup('player', 'Dan Synthetic'), '5 CONTROL Dan signs up');
RESET ROLE;
SELECT pg_temp.rc_check(public.player_consent_required(pg_temp.rc(13))
    AND EXISTS (SELECT 1 FROM public.parental_consents c
                WHERE c.roster_child_id = pg_temp.rc(73) AND c.player_user_id = pg_temp.rc(13) AND c.withdrawn_at IS NOT NULL),
  '5 G6 a consent withdrawn before signup is carried over still withdrawn');

-- ── 6. Consent is evidence: removing the roster row keeps it ───────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.rc_as(pg_temp.rc(21));
SELECT pg_temp.rc_allowed(pg_temp.rc_consent(pg_temp.rc(71)), '6 CONTROL guardian B consents for Ben');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);  -- the operator, not an app account
DELETE FROM public.squad_players WHERE id = pg_temp.rc(61);
SELECT pg_temp.rc_check(NOT EXISTS (SELECT 1 FROM public.roster_children WHERE id = pg_temp.rc(71))
    AND EXISTS (SELECT 1 FROM public.parental_consents WHERE roster_child_id = pg_temp.rc(71)),
  '6 J2 removing the child from the roster leaves the consent record in place');
SELECT pg_temp.rc_refused($$INSERT INTO public.parental_consents (parent_user_id, relationship_declared,
    verification_method, purposes, notice_version, consent_text, threshold_age, player_age_at_consent)
  VALUES ('98800000-0000-0000-0000-000000000020', 'parent', 'email_confirmed', '{"coaching_records":true}', 'v', 't', 18, 13)$$,
  '23514', '6 J2 a consent row must name a child, by account or by roster place');

-- ── 7. Who can call what ───────────────────────────────────────────────────
SELECT pg_temp.rc_check(
  NOT has_function_privilege('anon', 'public.record_roster_consent(uuid, text, jsonb, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.withdraw_roster_consent(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.get_roster_children_awaiting_consent()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.record_roster_consent(uuid, text, jsonb, text, text)', 'EXECUTE'),
  '7 the three guardian functions are for signed-in accounts only');

SELECT set_config('request.jwt.claims', '', true);

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.rc_results;
  IF total <> 26 THEN
    RAISE EXCEPTION 'Roster consent before account: % assertions ran; expected exactly 26', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Roster consent before account: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.rc_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Roster consent before account: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;
