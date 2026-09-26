-- @trak-suite mode=--coach-departure-review in-all=true
-- F1/F6 compatibility: actual authenticated access, immutable academy IDs,
-- legitimate linked-player edits, and independent-coach roster adoption.
BEGIN;
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing academy-access fixtures outside the disposable test harness';
  END IF;
END;
$test$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

CREATE FUNCTION pg_temp.academy_id(n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('92000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
$$;
CREATE FUNCTION pg_temp.academy_assert(ok boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Academy assertion failed: %', description; END IF;
END;
$$;
CREATE FUNCTION pg_temp.academy_denied(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'Expected denied operation: %', description;
END;
$$;

INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.academy_id(i), 'academy-access-' || i || '@test.invalid', now()
FROM generate_series(1, 9) i;
INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.academy_id(1), 'club', 'Academy A Admin', NULL),
  (pg_temp.academy_id(2), 'club', 'Academy B Admin', NULL),
  (pg_temp.academy_id(3), 'coach', 'Academy A Coach', 'ACCA03'),
  (pg_temp.academy_id(4), 'coach', 'Academy B Coach', 'ACCA04'),
  (pg_temp.academy_id(5), 'player', 'Linked Adult A', NULL),
  (pg_temp.academy_id(6), 'player', 'Other Adult', NULL),
  (pg_temp.academy_id(7), 'parent', 'Linked Parent', NULL),
  (pg_temp.academy_id(8), 'coach', 'Independent Coach', 'ACCA08'),
  (pg_temp.academy_id(9), 'player', 'Adopt Me', NULL);
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.academy_id(10), pg_temp.academy_id(1), 'Access Academy A', 'ACCESS-A'),
  (pg_temp.academy_id(11), pg_temp.academy_id(2), 'Access Academy B', 'ACCESS-B');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.academy_id(3), pg_temp.academy_id(10)),
  (pg_temp.academy_id(4), pg_temp.academy_id(11)),
  (pg_temp.academy_id(8), NULL);
INSERT INTO public.player_details (user_id, date_of_birth)
SELECT pg_temp.academy_id(i), '2000-01-01'::date FROM unnest(ARRAY[5,6,9]) i;
INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
VALUES (pg_temp.academy_id(5), pg_temp.academy_id(7));
INSERT INTO public.squad_players (id, coach_user_id, linked_player_id, player_name) VALUES
  (pg_temp.academy_id(20), pg_temp.academy_id(3), pg_temp.academy_id(5), 'Linked Adult A'),
  -- Trusted fixture for old invalid link data: academy membership must not
  -- expose a guardian's profile merely because a legacy row points at it.
  (pg_temp.academy_id(21), pg_temp.academy_id(3), pg_temp.academy_id(7), 'Legacy wrong-role link'),
  (pg_temp.academy_id(22), pg_temp.academy_id(8), NULL, 'Adopt Me');
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id) VALUES
  (pg_temp.academy_id(30), pg_temp.academy_id(3), pg_temp.academy_id(20)),
  (pg_temp.academy_id(31), pg_temp.academy_id(8), pg_temp.academy_id(22));
INSERT INTO public.recognition_awards (id, coach_user_id, squad_player_id, award_type)
VALUES (pg_temp.academy_id(40), pg_temp.academy_id(3), pg_temp.academy_id(20), 'effort');

-- A normal coach edit must work after a player has linked themselves.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(3), 'role', 'authenticated')::text, true);
UPDATE public.squad_players SET shirt_number = 17 WHERE id = pg_temp.academy_id(20);
SELECT pg_temp.academy_assert(
  (SELECT shirt_number = 17 AND linked_player_id = pg_temp.academy_id(5) FROM public.squad_players WHERE id = pg_temp.academy_id(20)),
  'coach can edit an owned linked player without changing the child identity'
);
SELECT pg_temp.academy_denied(
  $$UPDATE public.squad_players SET linked_player_id = pg_temp.academy_id(6) WHERE id = pg_temp.academy_id(20)$$,
  'coach cannot retarget an existing row to another player'
);
SELECT pg_temp.academy_denied($$SELECT public.link_player_to_coach('TRK-ACCA04')$$, 'coach cannot claim a player relationship');

-- A coach in another academy must not edit this row, even by its known UUID.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(4), 'role', 'authenticated')::text, true);
WITH changed AS (UPDATE public.squad_players SET shirt_number = 99 WHERE id = pg_temp.academy_id(20) RETURNING id)
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM changed), 'foreign coach cannot edit the roster');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(3), 'role', 'authenticated')::text, true);

-- Neither foreign UUIDs nor NULL can defeat organization pinning while the
-- original organization exists. Exercise all three trigger-bearing tables.
UPDATE public.squad_players SET organization_id = pg_temp.academy_id(11) WHERE id = pg_temp.academy_id(20);
UPDATE public.squad_players SET organization_id = NULL WHERE id = pg_temp.academy_id(20);
UPDATE public.coach_assessments SET organization_id = pg_temp.academy_id(11) WHERE id = pg_temp.academy_id(30);
UPDATE public.coach_assessments SET organization_id = NULL WHERE id = pg_temp.academy_id(30);
-- Award authoring is parked for application roles. Exercise the actual pin
-- through trusted maintenance, then resume the original authenticated reads.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(3), 'role', 'service_role')::text, true);
WITH changed AS (
  UPDATE public.recognition_awards SET organization_id = pg_temp.academy_id(11)
  WHERE id = pg_temp.academy_id(40) RETURNING id
)
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM changed), 'trusted award lateral UPDATE reaches the pin trigger');
WITH changed AS (
  UPDATE public.recognition_awards SET organization_id = NULL
  WHERE id = pg_temp.academy_id(40) RETURNING id
)
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM changed), 'trusted award clearing UPDATE reaches the pin trigger');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(3), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert(
  (SELECT organization_id = pg_temp.academy_id(10) FROM public.squad_players WHERE id = pg_temp.academy_id(20))
  AND (SELECT organization_id = pg_temp.academy_id(10) FROM public.coach_assessments WHERE id = pg_temp.academy_id(30))
  AND (SELECT organization_id = pg_temp.academy_id(10) FROM public.recognition_awards WHERE id = pg_temp.academy_id(40)),
  'direct UPDATE cannot move or clear a valid academy from roster, assessment or award'
);

-- Original academy retains player history, not merely the coach's current org.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_denied($$SELECT public.link_player_to_coach('TRK-ACCA04')$$, 'club admin cannot claim a player relationship');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'current academy reads its player profile');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'current academy reads its player DOB');
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.profiles WHERE user_id = pg_temp.academy_id(7)), 'legacy wrong-role roster link does not reveal parent profile to admin');
SELECT pg_temp.academy_assert(NOT public.player_in_my_org(pg_temp.academy_id(7)), 'helper rejects a non-player legacy target');
-- Departure is now a trusted incident operation with an owning-admin
-- identity; all transfer/history access assertions remain authenticated.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(1), 'role', 'service_role')::text, true);
SELECT public.remove_coach_from_org(pg_temp.academy_id(3));
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(3), 'role', 'authenticated')::text, true);
-- TRAK-12: putting a coach into an academy is an operator step now (Trak
-- moves the coach); this is the same coach_details update join_organization made.
SELECT set_config('trak.saved_claims', current_setting('request.jwt.claims', true), true);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.coach_details
SET organization_id = (SELECT id FROM public.organizations WHERE upper(join_code) = upper('ACCESS-B'))
WHERE user_id = (current_setting('trak.saved_claims')::jsonb->>'sub')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', current_setting('trak.saved_claims'), true);
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'original academy keeps profile access after removal and transfer');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'original academy keeps DOB access after removal and transfer');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(2), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'new academy cannot read former player profile');
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'new academy cannot read former player DOB');

-- Player and verified-link parent reads must remain independent of the coach.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(7), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_denied($$SELECT public.link_player_to_coach('TRK-ACCA04')$$, 'parent cannot claim a player relationship');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'parent retains linked child profile');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'parent retains linked child DOB');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(5), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(5)), 'player retains own profile');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.player_details WHERE user_id = pg_temp.academy_id(5)), 'player retains own details');
SELECT pg_temp.academy_assert(NOT public.player_in_my_org(pg_temp.academy_id(5)), 'direct helper call does not confer admin privileges on player');

-- Independent roster adoption is an existing supported workflow. The coach
-- joins A; the player then uses the code to claim the uniquely named stub.
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(8), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT organization_id IS NULL FROM public.squad_players WHERE id = pg_temp.academy_id(22)), 'independent roster starts without academy');
-- TRAK-12: putting a coach into an academy is an operator step now (Trak
-- moves the coach); this is the same coach_details update join_organization made.
SELECT set_config('trak.saved_claims', current_setting('request.jwt.claims', true), true);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.coach_details
SET organization_id = (SELECT id FROM public.organizations WHERE upper(join_code) = upper('ACCESS-A'))
WHERE user_id = (current_setting('trak.saved_claims')::jsonb->>'sub')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', current_setting('trak.saved_claims'), true);
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(9), 'role', 'authenticated')::text, true);
-- TRAK-48 slice 4: app roles can no longer call link_player_to_coach (refused
-- in roster_signup_admission section 7). Its adoption logic is still asserted
-- here, run as the function owner with the player's identity in the claims.
RESET ROLE;
SELECT pg_temp.academy_assert(public.link_player_to_coach('TRK-ACCA08') = pg_temp.academy_id(22), 'player adopts existing independent roster row');
SELECT pg_temp.academy_assert(public.link_player_to_coach('TRK-ACCA08') = pg_temp.academy_id(22), 'repeated adoption is idempotent');
SET LOCAL ROLE authenticated;
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.coach_assessments WHERE id = pg_temp.academy_id(31)), 'adoption retains assessment history');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(1), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT organization_id = pg_temp.academy_id(10) FROM public.squad_players WHERE id = pg_temp.academy_id(22)), 'adopted NULL roster acquires current coach academy');
SELECT pg_temp.academy_assert((SELECT count(*) = 1 FROM public.profiles WHERE user_id = pg_temp.academy_id(9)), 'academy sees newly adopted player');

-- Actual RPC regression: a deleted academy's matching-name stub is history,
-- not a new player's proof of identity or a coach's independent roster.
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.academy_id(i), 'academy-closed-' || i || '@test.invalid', now()
FROM generate_series(51, 54) i;
INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.academy_id(51), 'club', 'Closing Admin', NULL),
  (pg_temp.academy_id(52), 'coach', 'Closing Coach', 'ACCA52'),
  (pg_temp.academy_id(53), 'player', 'Same Name After Closure', NULL),
  (pg_temp.academy_id(54), 'player', 'Previously Linked Child', NULL);
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.academy_id(53), '2000-01-01'), (pg_temp.academy_id(54), '2000-01-01');
INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.academy_id(55), pg_temp.academy_id(51), 'Closing Academy', 'ACCESS-CLOSED');
INSERT INTO public.coach_details (user_id, organization_id)
VALUES (pg_temp.academy_id(52), pg_temp.academy_id(55));
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.academy_id(60), pg_temp.academy_id(52), 'Same Name After Closure', NULL),
  (pg_temp.academy_id(61), pg_temp.academy_id(52), 'Previously Linked Child', pg_temp.academy_id(54));
INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id) VALUES
  (pg_temp.academy_id(70), pg_temp.academy_id(52), pg_temp.academy_id(60)),
  (pg_temp.academy_id(71), pg_temp.academy_id(52), pg_temp.academy_id(61));
INSERT INTO public.recognition_awards (id,coach_user_id,squad_player_id,award_type)
VALUES (pg_temp.academy_id(72),pg_temp.academy_id(52),pg_temp.academy_id(61),'effort');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(51), 'role', 'authenticated')::text, true);
SELECT public.delete_my_account();
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(52), 'role', 'authenticated')::text, true);
-- TRAK-12: putting a coach into an academy is an operator step now (Trak
-- moves the coach); this is the same coach_details update join_organization made.
SELECT set_config('trak.saved_claims', current_setting('request.jwt.claims', true), true);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.coach_details
SET organization_id = (SELECT id FROM public.organizations WHERE upper(join_code) = upper('ACCESS-B'))
WHERE user_id = (current_setting('trak.saved_claims')::jsonb->>'sub')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', current_setting('trak.saved_claims'), true);
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.coach_assessments WHERE id IN (pg_temp.academy_id(70), pg_temp.academy_id(71))), 'coach cannot read closed history after joining another academy');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(53), 'role', 'authenticated')::text, true);
-- TRAK-48 slice 4: as above, the owner runs the link with the player's claims.
RESET ROLE;
SELECT pg_temp.academy_assert(public.link_player_to_coach('TRK-ACCA52') <> pg_temp.academy_id(60), 'same-name player gets a fresh row instead of adopting closed academy history');
SET LOCAL ROLE authenticated;
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.coach_assessments WHERE id = pg_temp.academy_id(70)), 'new player does not inherit closed same-name assessment');
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(52), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.coach_assessments WHERE id IN (pg_temp.academy_id(70), pg_temp.academy_id(71))), 'player RPC does not restore coach access to closed history');
WITH changed AS (
  UPDATE public.squad_players SET organization_deleted_at = NULL, status = 'active'
  WHERE id = pg_temp.academy_id(60) RETURNING id
)
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM changed), 'coach cannot clear the closure marker directly');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
-- Even later trusted bookkeeping must not infer B from the coach's current
-- organization, or that would silently transfer old child identity to B.
UPDATE public.squad_players SET shirt_number = 21, organization_deleted_at = NULL,
  organization_id = pg_temp.academy_id(11), status = 'active'
WHERE id IN (pg_temp.academy_id(60), pg_temp.academy_id(61));
SELECT pg_temp.academy_assert(
  (SELECT count(*) = 2 FROM public.squad_players WHERE id IN (pg_temp.academy_id(60), pg_temp.academy_id(61))
   AND organization_deleted_at IS NOT NULL AND organization_id IS NULL AND status = 'coach_departed'),
  'closure marker, cleared org and departed status survive later updates'
);
-- Ordinary later bookkeeping must not reattribute assessment/award history
-- via the coach's current academy, even when performed by maintenance code.
SELECT pg_temp.academy_assert(
  (SELECT count(*)=2 FROM public.coach_assessments WHERE id IN (pg_temp.academy_id(70),pg_temp.academy_id(71)))
  AND EXISTS (SELECT 1 FROM public.recognition_awards WHERE id=pg_temp.academy_id(72)),
  'closed assessment and award fixtures survive before reattribution checks');
UPDATE public.coach_assessments SET organization_id=pg_temp.academy_id(11), appearance='training'
WHERE id IN (pg_temp.academy_id(70),pg_temp.academy_id(71));
UPDATE public.recognition_awards SET organization_id=pg_temp.academy_id(11)
WHERE id=pg_temp.academy_id(72);
SELECT pg_temp.academy_assert(
  (SELECT count(*)=2 FROM public.coach_assessments WHERE id IN (pg_temp.academy_id(70),pg_temp.academy_id(71)) AND organization_id IS NULL)
  AND (SELECT organization_id IS NULL FROM public.recognition_awards WHERE id=pg_temp.academy_id(72)),
  'closed assessments and awards cannot acquire the coach current academy');
SELECT pg_temp.academy_denied(
  $$UPDATE public.coach_assessments SET squad_player_id=pg_temp.academy_id(22) WHERE id=pg_temp.academy_id(70)$$,
  'even maintenance cannot retarget closed assessment history to another roster identity');
SELECT pg_temp.academy_denied(
  $$UPDATE public.recognition_awards SET squad_player_id=pg_temp.academy_id(22) WHERE id=pg_temp.academy_id(72)$$,
  'even maintenance cannot retarget closed award history to another roster identity');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.academy_id(2), 'role', 'authenticated')::text, true);
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.profiles WHERE user_id = pg_temp.academy_id(54)), 'new academy admin cannot acquire old child profile through a later update');
SELECT pg_temp.academy_assert((SELECT count(*) = 0 FROM public.player_details WHERE user_id = pg_temp.academy_id(54)), 'new academy admin cannot acquire old child DOB through a later update');

RESET ROLE;
SELECT pg_temp.academy_assert(NOT has_function_privilege('anon', 'public.player_in_my_org(uuid)', 'EXECUTE'), 'anonymous helper execution revoked');
SELECT pg_temp.academy_assert(NOT has_function_privilege('authenticated', 'public.pin_org_id_on_update()', 'EXECUTE'), 'pin trigger is not a caller API');
SELECT pg_temp.academy_assert(NOT has_function_privilege('authenticated', 'public.set_squad_player_org_id()', 'EXECUTE'), 'roster trigger is not a caller API');
ROLLBACK;
