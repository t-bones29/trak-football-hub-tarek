-- @trak-suite mode=--roster-signup-review in-all=true
-- TRAK-48 slice 3 (J1, decided by Imad 24 Sep): only rostered children and the
-- guardians the academy supplied get a player or parent profile. The database
-- decides, in provision_my_profile, from the caller's CONFIRMED auth email:
--   player  -> an unclaimed roster_children row with that child_email
--   parent  -> a roster_guardians row with that email
-- Anyone else is refused with 42501 "Your academy hasn't added this email yet".
-- On success the roster wins over what the child typed (date of birth, team),
-- the roster row and squad row are claimed, and guardians are linked to the
-- children already claimed (siblings too, in either signup order).
-- Existing profiles are not re-checked, so accounts made before this keep
-- working. Synthetic fixtures only; run after real migrations in a disposable
-- database. The whole suite is one transaction and rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing roster-signup fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.rs(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98400000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE rs_results (description text, passed boolean, detail text);
GRANT INSERT ON rs_results TO anon, authenticated, service_role;

-- Expects the admission refusal: SQLSTATE 42501 with the agreed wording.
CREATE FUNCTION pg_temp.rs_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      ok := SQLERRM = 'Your academy hasn''t added this email yet';
      IF NOT ok THEN failure := '42501 with another message: ' || SQLERRM; END IF;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.rs_results VALUES (description, ok, failure);
END;
$test$;

CREATE FUNCTION pg_temp.rs_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.rs_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.rs_as(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true);
END;
$test$;

CREATE FUNCTION pg_temp.rs_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.rs_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- ── Fixtures (trusted setup, as the table owner) ───────────────────────────
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (pg_temp.rs(1),  'admin@roster-signup.test',        now()),
  (pg_temp.rs(2),  'coach@roster-signup.test',        now()),
  (pg_temp.rs(10), 'Child@Roster-Signup.test',        now()),  -- rostered; mixed case on purpose
  (pg_temp.rs(11), 'unlisted@roster-signup.test',     now()),  -- confirmed, not on any roster
  (pg_temp.rs(12), 'unconfirmed@roster-signup.test',  NULL),   -- on the roster, email not confirmed
  (pg_temp.rs(13), 'claimed@roster-signup.test',      now()),  -- roster place already claimed by 14
  (pg_temp.rs(14), 'claimer@roster-signup.test',      now()),
  (pg_temp.rs(15), 'legacy@roster-signup.test',       now()),  -- pre-slice-3 player account
  (pg_temp.rs(16), 'sibling@roster-signup.test',      now()),  -- rostered sibling, signs up last
  (pg_temp.rs(20), 'guardian@roster-signup.test',     now()),  -- guardian of child and sibling
  (pg_temp.rs(21), 'stranger@roster-signup.test',     now()),  -- confirmed, on no guardian row
  (pg_temp.rs(22), 'guardian2@roster-signup.test',    now());  -- a guardian trying to be the player

INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.rs(1),  'club',   'Roster Signup Admin'),
  (pg_temp.rs(2),  'coach',  'Roster Signup Coach'),
  (pg_temp.rs(14), 'player', 'Earlier Claimer'),
  (pg_temp.rs(15), 'player', 'Legacy Player');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.rs(30), pg_temp.rs(1), 'Roster Signup Academy', 'RS-ACADEMY');
INSERT INTO public.coach_details (user_id, organization_id) VALUES (pg_temp.rs(2), pg_temp.rs(30));
INSERT INTO public.squad_players (id, coach_user_id, player_name, age_group, linked_player_id) VALUES
  (pg_temp.rs(40), pg_temp.rs(2), 'Child Synthetic',       'U14', NULL),
  (pg_temp.rs(41), pg_temp.rs(2), 'Claimed Synthetic',     'U14', pg_temp.rs(14)),
  (pg_temp.rs(42), pg_temp.rs(2), 'Sibling Synthetic',     'U12', NULL),
  (pg_temp.rs(43), pg_temp.rs(2), 'Unconfirmed Synthetic', 'U14', NULL);
INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, player_user_id, loaded_by) VALUES
  (pg_temp.rs(50), pg_temp.rs(30), pg_temp.rs(40), '2012-05-06', 'child@roster-signup.test',       NULL,           'fixture'),
  (pg_temp.rs(51), pg_temp.rs(30), pg_temp.rs(41), '2012-01-01', 'claimed@roster-signup.test',     pg_temp.rs(14), 'fixture'),
  (pg_temp.rs(52), pg_temp.rs(30), pg_temp.rs(42), '2014-03-03', 'sibling@roster-signup.test',     NULL,           'fixture'),
  (pg_temp.rs(53), pg_temp.rs(30), pg_temp.rs(43), '2012-09-09', 'unconfirmed@roster-signup.test', NULL,           'fixture');
INSERT INTO public.roster_guardians (roster_child_id, email, loaded_by) VALUES
  (pg_temp.rs(50), 'guardian@roster-signup.test',  'fixture'),
  (pg_temp.rs(52), 'guardian@roster-signup.test',  'fixture'),
  (pg_temp.rs(50), 'guardian2@roster-signup.test', 'fixture');
-- The coach's personal player-link code, as coach home used to show it (section 7).
UPDATE public.profiles SET invite_code = 'RSC1' WHERE user_id = pg_temp.rs(2);

-- Expects a plain permission refusal (SQLSTATE 42501, any wording): a revoked
-- grant or a row-level policy, rather than the admission message above.
CREATE FUNCTION pg_temp.rs_denied(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE ok boolean := false; failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN ok := true;
    WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.rs_results VALUES (description, ok, failure);
END;
$test$;

CREATE FUNCTION pg_temp.rs_player(p_name text, p_dob text) RETURNS text LANGUAGE sql AS $test$
  SELECT format($$SELECT public.provision_my_profile(jsonb_build_object('role', 'player', 'full_name', %L,
    'player_details', jsonb_build_object('date_of_birth', %L, 'position', 'Defender', 'current_club', 'Typed FC')))$$, p_name, p_dob);
$test$;
CREATE FUNCTION pg_temp.rs_parent(p_name text) RETURNS text LANGUAGE sql AS $test$
  SELECT format($$SELECT public.provision_my_profile(jsonb_build_object('role', 'parent', 'full_name', %L))$$, p_name);
$test$;

SET LOCAL ROLE authenticated;

-- ── 1. Refused: no roster invitation ───────────────────────────────────────
SELECT pg_temp.rs_as(pg_temp.rs(11));
SELECT pg_temp.rs_refused(pg_temp.rs_player('Unlisted Synthetic', '2012-01-01'), '1 J1 a child with no roster row is refused');
SELECT pg_temp.rs_as(pg_temp.rs(12));
SELECT pg_temp.rs_refused(pg_temp.rs_player('Unconfirmed Synthetic', '2012-09-09'), '1 J1 an unconfirmed email is refused even when rostered');
SELECT pg_temp.rs_as(pg_temp.rs(13));
SELECT pg_temp.rs_refused(pg_temp.rs_player('Late Synthetic', '2012-01-01'), '1 J1 a roster place already claimed by another account is refused');
SELECT pg_temp.rs_as(pg_temp.rs(21));
SELECT pg_temp.rs_refused(pg_temp.rs_parent('Stranger Synthetic'), '1 J1 a parent on no guardian row is refused');
SELECT pg_temp.rs_as(pg_temp.rs(22));
SELECT pg_temp.rs_refused(pg_temp.rs_player('Guardian As Child', '2012-01-01'), '1 J1 a guardian email cannot become the player');

-- ── 2. Allowed: the rostered child, and the roster wins ────────────────────
SELECT pg_temp.rs_as(pg_temp.rs(10));
SELECT pg_temp.rs_allowed(pg_temp.rs_player('Child Synthetic', '2000-01-01'), '2 CONTROL the rostered child signs up (email case ignored)');
RESET ROLE;
SELECT pg_temp.rs_check((SELECT role::text = 'player' FROM public.profiles WHERE user_id = pg_temp.rs(10)), '2 the child has a player profile');
SELECT pg_temp.rs_check((SELECT date_of_birth = '2012-05-06' FROM public.player_details WHERE user_id = pg_temp.rs(10)),
  '2 J1 the date of birth comes from the roster, not what the child typed',
  (SELECT date_of_birth::text FROM public.player_details WHERE user_id = pg_temp.rs(10)));
SELECT pg_temp.rs_check((SELECT current_club = 'Roster Signup Academy' AND age_group = 'U14' FROM public.player_details WHERE user_id = pg_temp.rs(10)),
  '2 TRAK-54 the team is the academy and the age group is the roster''s',
  (SELECT current_club || ' / ' || coalesce(age_group, 'null') FROM public.player_details WHERE user_id = pg_temp.rs(10)));
SELECT pg_temp.rs_check((SELECT player_user_id = pg_temp.rs(10) FROM public.roster_children WHERE id = pg_temp.rs(50)), '2 the roster row is claimed by the child');
SELECT pg_temp.rs_check((SELECT linked_player_id = pg_temp.rs(10) FROM public.squad_players WHERE id = pg_temp.rs(40)), '2 the squad row is linked to the child');
SELECT pg_temp.rs_check((SELECT count(*) = 0 FROM public.profiles WHERE user_id IN (pg_temp.rs(11), pg_temp.rs(12), pg_temp.rs(13), pg_temp.rs(21), pg_temp.rs(22))),
  '2 nothing refused above left a profile behind');
SET LOCAL ROLE authenticated;

-- ── 3. Allowed: the guardian, linked to the claimed child ──────────────────
SELECT pg_temp.rs_as(pg_temp.rs(20));
SELECT pg_temp.rs_allowed(pg_temp.rs_parent('Guardian Synthetic'), '3 CONTROL the academy-supplied guardian signs up');
RESET ROLE;
SELECT pg_temp.rs_check((SELECT count(*) = 2 FROM public.roster_guardians WHERE email = 'guardian@roster-signup.test' AND parent_user_id = pg_temp.rs(20)),
  '3 both of the guardian''s roster rows are claimed');
SELECT pg_temp.rs_check(EXISTS (SELECT 1 FROM public.player_parent_links WHERE player_user_id = pg_temp.rs(10) AND parent_user_id = pg_temp.rs(20)),
  '3 J2 the guardian is linked to the child who already signed up');
SET LOCAL ROLE authenticated;

-- ── 4. The sibling signs up after the guardian: linked on arrival ─────────
SELECT pg_temp.rs_as(pg_temp.rs(16));
SELECT pg_temp.rs_allowed(pg_temp.rs_player('Sibling Synthetic', ''), '4 CONTROL the rostered sibling signs up');
RESET ROLE;
SELECT pg_temp.rs_check(EXISTS (SELECT 1 FROM public.player_parent_links WHERE player_user_id = pg_temp.rs(16) AND parent_user_id = pg_temp.rs(20)),
  '4 J2 a guardian who signed up first is linked to the sibling who arrives later');
SELECT pg_temp.rs_check((SELECT date_of_birth = '2014-03-03' FROM public.player_details WHERE user_id = pg_temp.rs(16)),
  '4 the sibling''s date of birth also comes from the roster');
SET LOCAL ROLE authenticated;

-- ── 5. Existing accounts keep working ──────────────────────────────────────
SELECT pg_temp.rs_as(pg_temp.rs(10));
SELECT pg_temp.rs_allowed($$SELECT public.provision_my_profile(jsonb_build_object('role', 'player', 'full_name', 'Child Synthetic'))$$,
  '5 CONTROL the child can repeat signup');
SELECT pg_temp.rs_as(pg_temp.rs(15));
SELECT pg_temp.rs_allowed($$SELECT public.provision_my_profile(jsonb_build_object('role', 'player', 'full_name', 'Legacy Player'))$$,
  '5 CONTROL a player account made before this change is not re-checked');

-- ── 6. A claimed rostered child can erase their account (TRAK-48 acceptance) ─
-- #128's delete trigger trusts roster_children.player_user_id; slice 3 is what
-- sets it, so the child's own erasure now succeeds and takes the admission.
SELECT pg_temp.rs_as(pg_temp.rs(16));
SELECT pg_temp.rs_allowed($$SELECT public.delete_my_account()$$, '6 CONTROL a claimed rostered child deletes their own account');
RESET ROLE;
SELECT pg_temp.rs_check(NOT EXISTS (SELECT 1 FROM auth.users WHERE id = pg_temp.rs(16))
  AND NOT EXISTS (SELECT 1 FROM public.roster_children WHERE id = pg_temp.rs(52)),
  '6 the account and its admission are gone');

-- ── 7. The roster is the only way into a squad (slice 4) ──────────────────
-- No linking by a coach's code, and no coach creating squad rows: a child is
-- in a squad only because the operator admitted them.
SET LOCAL ROLE authenticated;
SELECT pg_temp.rs_as(pg_temp.rs(15));
SELECT pg_temp.rs_denied($$SELECT public.link_player_to_coach('TRK-RSC1')$$,
  '7 J1 an existing player account cannot join a squad with a coach''s code');
SELECT pg_temp.rs_denied($$SELECT public.get_coach_id_by_invite_code('RSC1')$$,
  '7 J1 a coach''s code cannot be looked up');
-- The side door: provisioning used to call link_player_to_coach itself (as its
-- owner) when the payload carried a code. Signup still succeeds; it must not link.
SELECT pg_temp.rs_allowed($$SELECT public.provision_my_profile(jsonb_build_object('role', 'player', 'full_name', 'Legacy Player',
    'coach_invite_code', 'TRK-RSC1', 'player_details', jsonb_build_object('position', 'Forward')))$$,
  '7 CONTROL an existing player repeats signup with a coach code in the payload');
SELECT pg_temp.rs_as(pg_temp.rs(10));
SELECT pg_temp.rs_denied($$SELECT public.link_player_to_coach('TRK-RSC1')$$,
  '7 J1 a rostered child cannot use a code either');
SELECT pg_temp.rs_as(pg_temp.rs(2));
SELECT pg_temp.rs_denied(format($$INSERT INTO public.squad_players (coach_user_id, player_name, age_group) VALUES (%L, 'Direct Insert', 'U14')$$, pg_temp.rs(2)),
  '7 UC-C02 a coach cannot add a squad row');
SELECT pg_temp.rs_denied(format($$INSERT INTO public.squad_players (id, coach_user_id, player_name) VALUES (%L, %L, 'Upserted') ON CONFLICT (id) DO UPDATE SET player_name = excluded.player_name$$, pg_temp.rs(44), pg_temp.rs(2)),
  '7 UC-C02 a coach cannot upsert a squad row');
SELECT pg_temp.rs_allowed(format($$UPDATE public.squad_players SET shirt_number = 7 WHERE id = %L$$, pg_temp.rs(43)),
  '7 CONTROL the coach still edits their own squad row');
RESET ROLE;
SELECT pg_temp.rs_check((SELECT shirt_number = 7 FROM public.squad_players WHERE id = pg_temp.rs(43))
  AND NOT EXISTS (SELECT 1 FROM public.squad_players WHERE player_name IN ('Direct Insert', 'Upserted') OR linked_player_id = pg_temp.rs(15)),
  '7 the edit landed, and nothing refused above created or linked a squad row');
SET LOCAL ROLE service_role;
SELECT pg_temp.rs_allowed(format($$SELECT public.admit_roster_child(%L, %L, 'Operator Admitted', 'U14', '2012-02-02', 'operator.child@roster-signup.test', ARRAY['operator.guardian@roster-signup.test'], 'fixture')$$,
  pg_temp.rs(30), pg_temp.rs(2)),
  '7 CONTROL the operator''s roster load still creates the squad row');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.rs_results;
  IF total <> 31 THEN
    RAISE EXCEPTION 'Roster signup admission: % assertions ran; expected exactly 31', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Roster signup admission: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.rs_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Roster signup admission: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;
