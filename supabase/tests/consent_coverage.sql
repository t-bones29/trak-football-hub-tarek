-- @trak-suite mode=--consent-review in-all=false
-- ============================================================
-- P2 — What the parental-consent gate does and does not cover
--
-- Run:  npm run test:db -- --consent-review
--
-- This suite is EXPECTED TO FAIL. It is not in --all, because --all runs in
-- CI and this suite asserts things that are not true yet. Sections A and B
-- pass and must keep passing; section C fails until P2 is closed.
--
-- 20260912000001 already states the limitation in its own header: the gate
-- can only apply where a date of birth exists, which means roster rows linked
-- to an account, and it argues that an unlinked row "is the academy's own
-- paper record of its own squad."
--
-- Section A measures the hole precisely. Section B proves the gate genuinely
-- works where it can see an age, so section A is a gap in reach and not a
-- broken gate. Section C states the two properties that must hold before a
-- real child is assessed, written as properties of the data rather than of
-- any particular policy, so that any fix satisfies them.
--
-- C2 is the assertion that the header's reasoning does not survive: the
-- record does not stay the academy's own. When the child later links, every
-- assessment written while nobody could check consent attaches to their
-- account and becomes readable by them under "Players read own assessments".
-- The gate is a check at the moment of writing, not a property of the record.
--
-- Synthetic fixtures only. Disposable database only.
-- ============================================================
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing consent fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.cid(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('c0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE consent_results (description text, passed boolean, detail text);
GRANT INSERT ON consent_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.cassert(ok boolean, description text, detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  INSERT INTO pg_temp.consent_results VALUES (description, ok IS TRUE, detail);
END;
$test$;

-- Only 42501 (RLS/privilege) and P0001 (a RAISE in our own code) are denials.
-- Anything else means the statement failed for an unrelated reason and the
-- assertion proved nothing — three of my earlier suites went green that way.
CREATE FUNCTION pg_temp.cexpect_denied(statement text, description text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE denied boolean := false; failure text; state text;
BEGIN
  BEGIN
    EXECUTE statement;
    RAISE EXCEPTION 'trak-unexpectedly-allowed';
  EXCEPTION
    WHEN OTHERS THEN
      state := SQLSTATE;
      IF SQLERRM = 'trak-unexpectedly-allowed' THEN
        denied := false; failure := 'statement succeeded';
      ELSIF state IN ('42501', 'P0001') THEN
        denied := true; failure := state;
      ELSE
        denied := false;
        failure := 'NOT A DENIAL — ' || state || ': ' || left(SQLERRM, 60);
      END IF;
  END;
  INSERT INTO pg_temp.consent_results VALUES (description, denied, failure);
END;
$test$;

-- Records only that the statement ran. Whether it took effect is checked
-- afterwards from service_role, because an attacker's own view of a write is
-- not evidence that the write landed.
CREATE FUNCTION pg_temp.cattempt(statement text)
RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
  EXECUTE statement;
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$test$;


-- ── Fixtures ────────────────────────────────────────────────
-- 1 coach. 2 under-age child WITH an account, unconsented. 3 under-age child
-- WITH an account whose parent consents. 4 the parent. 5 club administrator.
-- 6 the under-age child a coach typed in, who signs up only in section C.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.cid(n), 'consent-' || n || '@test.invalid', now()
FROM generate_series(1, 6) n;

INSERT INTO public.profiles (user_id, role, full_name, invite_code) VALUES
  (pg_temp.cid(1), 'coach',  'Consent Coach',      'CONSENT1'),
  (pg_temp.cid(2), 'player', 'Unconsented Child',  NULL),
  (pg_temp.cid(3), 'player', 'Consented Child',    NULL),
  (pg_temp.cid(4), 'parent', 'Consenting Parent',  NULL),
  (pg_temp.cid(5), 'club',   'Consent Academy Admin', NULL),
  (pg_temp.cid(6), 'player', 'Typed In Child',     NULL);

INSERT INTO public.organizations (id, admin_user_id, name, join_code)
VALUES (pg_temp.cid(101), pg_temp.cid(5), 'Synthetic Consent Academy', 'CONSENT-ONLY');

INSERT INTO public.coach_details (user_id, organization_id)
VALUES (pg_temp.cid(1), pg_temp.cid(101));

-- Ten years old against a threshold of fifteen. Both are asserted below, so a
-- change to either is reported rather than silently making the suite vacuous.
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.cid(2), current_date - interval '10 years'),
  (pg_temp.cid(3), current_date - interval '10 years'),
  (pg_temp.cid(6), current_date - interval '10 years');

INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
VALUES (pg_temp.cid(3), pg_temp.cid(4));

-- 201 and 202 are accounts that linked themselves. 203 is what the coach's
-- add-player screen actually produces: a name, and an age BAND, nothing more.
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id, age_group) VALUES
  (pg_temp.cid(201), pg_temp.cid(1), 'Unconsented Child', pg_temp.cid(2), 'U12'),
  (pg_temp.cid(202), pg_temp.cid(1), 'Consented Child',   pg_temp.cid(3), 'U12'),
  (pg_temp.cid(203), pg_temp.cid(1), 'Typed In Child',    NULL,           'U12');


-- 7 is sixteen: above the statutory threshold this gate uses, below the
-- under-18 guardian approval Imad has chosen as pilot product policy. Section D
-- is about the band between those two numbers.
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES (pg_temp.cid(7), 'consent-7@test.invalid', now());
INSERT INTO public.profiles (user_id, role, full_name, invite_code)
VALUES (pg_temp.cid(7), 'player', 'Sixteen Year Old', NULL);
INSERT INTO public.player_details (user_id, date_of_birth)
VALUES (pg_temp.cid(7), (current_date - interval '16 years')::date - 7);
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id, age_group)
VALUES (pg_temp.cid(204), pg_temp.cid(1), 'Sixteen Year Old', pg_temp.cid(7), 'U17');


-- ── Section A: the reach of the gate ────────────────────────
-- These pass today and describe exactly how far the gate extends.

SELECT pg_temp.cassert(
  public.consent_threshold_age() = 18,
  'A1. Threshold is 18 (the fixture is under it)',
  'threshold is ' || public.consent_threshold_age());

SELECT pg_temp.cassert(
  public.player_age_years(pg_temp.cid(2)) = 10,
  'A2. The fixture child is 10 years old',
  'age is ' || coalesce(public.player_age_years(pg_temp.cid(2))::text, 'NULL'));

SELECT pg_temp.cassert(
  public.squad_player_consent_required(pg_temp.cid(201)) IS TRUE,
  'A3. Consent IS required for the linked under-age child');

SELECT pg_temp.cassert(
  public.squad_player_consent_required(pg_temp.cid(203)) IS FALSE,
  'A4. Consent is NOT required for the typed-in child — the hole, in one call');

-- The header proposes gating on a date of birth collected at add-player.
-- There is nowhere to put one, so that fix is a schema change, not a policy
-- change. Worth knowing before the work is estimated.
SELECT pg_temp.cassert(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'squad_players'
      AND column_name IN ('date_of_birth', 'dob')),
  'A5. squad_players has no date-of-birth column, so the row cannot carry an age');

SELECT pg_temp.cassert(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'squad_players'
      AND column_name = 'age_group'),
  'A6. squad_players carries only an age BAND, which is not a date of birth');


-- ── Section B: the gate works where it can see an age ───────
-- Without these, section A would be consistent with a gate that is simply
-- broken for everyone, which is a different defect with a different fix.

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role','authenticated','sub',pg_temp.cid(1))::text, true);

-- B1. NEGATIVE CONTROL. Linked, under-age, no consent: must be refused.
SELECT pg_temp.cexpect_denied($$
  INSERT INTO public.coach_assessments (coach_user_id, squad_player_id)
  VALUES ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000201')
$$, 'B1. CONTROL — coach is refused on the linked under-age child with no consent');

-- B2. THE FINDING. Same coach, same academy, same age, same absent consent.
-- The only difference is that nobody typed a date of birth for this one.
SELECT pg_temp.cattempt($$
  INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id)
  VALUES ('c0000000-0000-0000-0000-000000000401',
          'c0000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000203')
$$);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT pg_temp.cassert(
  EXISTS (SELECT 1 FROM public.coach_assessments WHERE id = pg_temp.cid(401)),
  'B2. The typed-in under-age child WAS assessed, with no guardian anywhere');

-- B3. SECOND CONTROL. Grant consent for the linked child and the same insert
-- must now succeed. This is what proves B1 was refused for consent and not
-- for ownership, academy pinning or the role check.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role','authenticated','sub',pg_temp.cid(4))::text, true);

SELECT public.record_parental_consent(
  pg_temp.cid(3), 'parent',
  '{"coaching_records": true, "ai_feedback": true}'::jsonb,
  'test-notice-v1', 'Synthetic consent wording for the disposable harness.');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role','authenticated','sub',pg_temp.cid(1))::text, true);

SELECT pg_temp.cattempt($$
  INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id)
  VALUES ('c0000000-0000-0000-0000-000000000402',
          'c0000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000202')
$$);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT pg_temp.cassert(
  EXISTS (SELECT 1 FROM public.coach_assessments WHERE id = pg_temp.cid(402)),
  'B3. CONTROL — with consent recorded, the same insert succeeds');

-- B4. The same hole on awards, which carry a child''s name into a record too.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role','authenticated','sub',pg_temp.cid(1))::text, true);

SELECT pg_temp.cattempt($$
  INSERT INTO public.recognition_awards (id, coach_user_id, squad_player_id, award_type)
  VALUES ('c0000000-0000-0000-0000-000000000501',
          'c0000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000203', 'player_of_the_week')
$$);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT pg_temp.cassert(
  EXISTS (SELECT 1 FROM public.recognition_awards WHERE id = pg_temp.cid(501)),
  'B4. Awards have the same reach, so the gap is not specific to assessments');


-- B5 and C5 lived here: a consent granting NOTHING still satisfied the gate,
-- because player_has_parental_consent() asked only whether a record existed.
-- Imad fixed it in #62 at both ends — the predicate now requires
-- coaching_records, the RPC rejects a grant without it, and a CHECK mirrors it
-- on the table. His privilege_and_consent_security.sql covers it better than
-- these did, including the direct-INSERT path that bypasses the RPC (his B3).
-- Removed rather than kept, because two suites asserting the same property is
-- how they drift.

-- ── Section C: what must be true before a real child ────────
-- EXPECTED TO FAIL. Each is a property of the stored data, not of a policy,
-- so any fix that actually closes P2 turns these green.

SELECT pg_temp.cassert(
  NOT EXISTS (
    SELECT 1
    FROM public.coach_assessments ca
    JOIN public.squad_players sp ON sp.id = ca.squad_player_id
    WHERE sp.linked_player_id IS NULL),
  'C1. EXPECTED FAIL — no assessment exists against a roster row whose age nobody knows');

-- Now the child signs up and links, which is the ordinary pilot flow and the
-- whole point of T4. Everything written during the unconsented period follows
-- them into their account.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role','authenticated','sub',pg_temp.cid(6))::text, true);

-- TRAK-48 slice 4: app roles can no longer call link_player_to_coach; the
-- link still happens, run as the owner with the player's claims.
RESET ROLE;
SELECT public.link_player_to_coach('CONSENT1');
SET LOCAL ROLE authenticated;

-- The gate now engages correctly for anything written from here on...
SELECT pg_temp.cexpect_denied($$
  INSERT INTO public.coach_assessments (coach_user_id, squad_player_id)
  VALUES ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000203')
$$, 'C3. After linking, NEW assessments are correctly blocked (this one passes)');

-- ...but the child can read what was written before it engaged.
SELECT pg_temp.cassert(
  EXISTS (SELECT 1 FROM public.coach_assessments WHERE id = pg_temp.cid(401)),
  'C4. The child can now read the assessment written before consent was checkable');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT pg_temp.cassert(
  NOT EXISTS (
    SELECT 1
    FROM public.coach_assessments ca
    JOIN public.squad_players sp ON sp.id = ca.squad_player_id
    WHERE sp.linked_player_id IS NOT NULL
      AND public.player_age_years(sp.linked_player_id) < public.consent_threshold_age()
      AND NOT EXISTS (
        SELECT 1 FROM public.parental_consents pc
        WHERE pc.player_user_id = sp.linked_player_id
          AND pc.granted_at <= ca.created_at
          AND pc.withdrawn_at IS NULL)),
  'C2. EXPECTED FAIL — no under-age child holds an assessment that predates their consent');


-- ── Section D: the band between the two thresholds ─────────
-- Until 20260921120000, two numbers governed consent and they were not the
-- same number: consent_threshold_age() said 15 (Greece, and the only one any
-- write policy consulted) while trak_consent (#70) said 18. Between them —
-- 15, 16, 17 — a verified parent could record a decision, including a
-- WITHDRAWAL, and what a coach could write did not change.
--
-- That migration moves consent_threshold_age() to 18 for both markets, so the
-- band is closed: D2 and D3 flipped from documenting the gap to guarding
-- against its return. If either goes red again, the statutory function and
-- the product policy have drifted apart; read 20260921120000 before touching
-- the number.

SELECT pg_temp.cassert(
  public.player_age_years(pg_temp.cid(7)) = 16,
  'D1-control The band fixture is 16 years old',
  'age is ' || coalesce(public.player_age_years(pg_temp.cid(7))::text, 'NULL'));

SELECT pg_temp.cassert(
  public.squad_player_consent_required(pg_temp.cid(204)) IS TRUE,
  'D2. Consent IS required for a 16-year-old — the 15-17 band is closed',
  'threshold is ' || public.consent_threshold_age());

-- The consequence, stated as the write rather than as the predicate, because
-- "the function returns false" is not what harms anyone.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  jsonb_build_object('role','authenticated','sub',pg_temp.cid(1))::text, true);

SELECT pg_temp.cattempt($$
  INSERT INTO public.coach_assessments (id, coach_user_id, squad_player_id)
  VALUES ('c0000000-0000-0000-0000-000000000403',
          'c0000000-0000-0000-0000-000000000001',
          'c0000000-0000-0000-0000-000000000204')
$$);

-- Read back as service_role, not by RESET ROLE alone: returning to the owner
-- bypasses RLS entirely and would make this assertion pass whatever happened.
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT pg_temp.cassert(
  NOT EXISTS (SELECT 1 FROM public.coach_assessments WHERE id = pg_temp.cid(403)),
  'D3. A coach may NOT assess that child while no consent record exists');

SELECT pg_temp.cassert(
  NOT EXISTS (SELECT 1 FROM public.parental_consents WHERE player_user_id = pg_temp.cid(7)),
  'D4-control and no consent record exists for them, so D3 is the gate refusing, not consent missing');

RESET ROLE;


-- ── Report ──────────────────────────────────────────────────
RESET ROLE;
DO $test$
DECLARE failures text; n_passed int; total int;
BEGIN
  SELECT count(*) FILTER (WHERE passed), count(*) INTO n_passed, total
  FROM pg_temp.consent_results;

  SELECT string_agg(description || coalesce(' [' || detail || ']', ''), E'\n' ORDER BY description)
  INTO failures FROM pg_temp.consent_results WHERE NOT passed;

  RAISE NOTICE 'Consent coverage: % of % assertions passed', n_passed, total;

  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'Consent coverage: % of % assertions failed', total - n_passed, total
      USING DETAIL = failures;
  END IF;
END;
$test$;

ROLLBACK;
