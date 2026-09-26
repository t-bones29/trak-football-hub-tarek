-- @trak-suite mode=--family-training-review in-all=true
-- TRAK-76 (J6): the child and that child's linked parent read the training the
-- coach logged, through family_training_history() only. Kostas's contract
-- (TRAK-6, 25 Sep): the date, that it was training, the focus labels from
-- training_type, and attendance for their own child. Never the title, the
-- notes, or anything derived from them; coach_sessions stays closed to
-- families. Consent is required for an under-18, and a read after withdrawal
-- is refused. Synthetic fixtures; the whole suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing family training fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.ft(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('97600000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE ft_results (description text, passed boolean, detail text);
GRANT INSERT ON ft_results TO authenticated, anon;

CREATE FUNCTION pg_temp.ft_as(p_uid uuid) RETURNS void LANGUAGE sql AS $test$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_uid::text)::text, true)::text;
$test$;

CREATE FUNCTION pg_temp.ft_check(ok boolean, description text, detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.ft_results VALUES (description, coalesce(ok, false), detail);
$test$;

-- Records whether a statement is refused, and with which message.
CREATE FUNCTION pg_temp.ft_refused(statement text, message text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text := 'unexpectedly allowed';
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    failure := CASE WHEN SQLERRM = message THEN NULL ELSE SQLSTATE || ': ' || SQLERRM END;
  END;
  INSERT INTO pg_temp.ft_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- The caller's rows, as JSON text, so a leak of any column shows up.
SET LOCAL check_function_bodies = off;
CREATE FUNCTION pg_temp.ft_rows(p_child uuid) RETURNS jsonb LANGUAGE sql AS $test$
  SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.session_date DESC), '[]'::jsonb)
  FROM public.family_training_history(p_child) h;
$test$;
GRANT EXECUTE ON FUNCTION pg_temp.ft_rows(uuid) TO authenticated;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- 1 admin A, 2 coach A, 3 child A (10), 4 sibling (12), 5 parent of both,
-- 6 child C (10, no consent), 7 parent of C, 8 adult player (20),
-- 11 admin B, 12 coach B, 13 child B (10), 14 parent of B.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.ft(n), 'ft-' || n || '@family-training.test', now()
FROM unnest(ARRAY[1,2,3,4,5,6,7,8,11,12,13,14]) n;
INSERT INTO public.profiles (user_id, role, full_name) VALUES
  (pg_temp.ft(1), 'club', 'Admin A'), (pg_temp.ft(2), 'coach', 'Coach A'),
  (pg_temp.ft(3), 'player', 'Child A'), (pg_temp.ft(4), 'player', 'Sibling A'),
  (pg_temp.ft(5), 'parent', 'Parent A'), (pg_temp.ft(6), 'player', 'Child C'),
  (pg_temp.ft(7), 'parent', 'Parent C'), (pg_temp.ft(8), 'player', 'Adult Player'),
  (pg_temp.ft(11), 'club', 'Admin B'), (pg_temp.ft(12), 'coach', 'Coach B'),
  (pg_temp.ft(13), 'player', 'Child B'), (pg_temp.ft(14), 'parent', 'Parent B');
INSERT INTO public.organizations (id, admin_user_id, name, join_code) VALUES
  (pg_temp.ft(50), pg_temp.ft(1), 'Training Academy A', 'FTACADA'),
  (pg_temp.ft(51), pg_temp.ft(11), 'Training Academy B', 'FTACADB');
INSERT INTO public.coach_details (user_id, organization_id) VALUES
  (pg_temp.ft(2), pg_temp.ft(50)), (pg_temp.ft(12), pg_temp.ft(51));
INSERT INTO public.player_details (user_id, date_of_birth) VALUES
  (pg_temp.ft(3), current_date - interval '10 years'), (pg_temp.ft(4), current_date - interval '12 years'),
  (pg_temp.ft(6), current_date - interval '10 years'), (pg_temp.ft(8), current_date - interval '20 years'),
  (pg_temp.ft(13), current_date - interval '10 years');
INSERT INTO public.player_parent_links (player_user_id, parent_user_id) VALUES
  (pg_temp.ft(3), pg_temp.ft(5)), (pg_temp.ft(4), pg_temp.ft(5)),
  (pg_temp.ft(6), pg_temp.ft(7)), (pg_temp.ft(13), pg_temp.ft(14));
INSERT INTO public.squad_players (id, coach_user_id, player_name, linked_player_id) VALUES
  (pg_temp.ft(20), pg_temp.ft(2), 'Child A', pg_temp.ft(3)),
  (pg_temp.ft(21), pg_temp.ft(2), 'Sibling A', pg_temp.ft(4)),
  (pg_temp.ft(22), pg_temp.ft(2), 'Child C', pg_temp.ft(6)),
  (pg_temp.ft(23), pg_temp.ft(2), 'Adult Player', pg_temp.ft(8)),
  (pg_temp.ft(24), pg_temp.ft(12), 'Child B', pg_temp.ft(13));

-- Sessions, written as the coach's diary. SECRET words sit in title and notes
-- so a leak of either shows up in the family's rows.
INSERT INTO public.coach_sessions (id, coach_user_id, session_type, title, notes, session_date, training_type) VALUES
  (pg_temp.ft(30), pg_temp.ft(2), 'training', 'SECRET title one', 'SECRET note one', current_date - 3, 'Technical,Tactical'),
  (pg_temp.ft(31), pg_temp.ft(2), 'training', 'SECRET title two', 'SECRET note two', current_date - 1, NULL),
  (pg_temp.ft(32), pg_temp.ft(2), 'match',    'SECRET match',     NULL,              current_date - 2, NULL),
  (pg_temp.ft(33), pg_temp.ft(2), 'training', 'SECRET title three', NULL,            current_date - 5, 'Physical'),
  (pg_temp.ft(34), pg_temp.ft(12), 'training', 'SECRET academy B', NULL,             current_date - 1, 'Finishing');
INSERT INTO public.session_attendance (session_id, squad_player_id, status) VALUES
  (pg_temp.ft(30), pg_temp.ft(20), 'present'), (pg_temp.ft(31), pg_temp.ft(20), 'late'),
  (pg_temp.ft(32), pg_temp.ft(20), 'present'),                                   -- a match: not training
  (pg_temp.ft(30), pg_temp.ft(21), 'absent'),  (pg_temp.ft(33), pg_temp.ft(21), 'present'),
  (pg_temp.ft(30), pg_temp.ft(22), 'present'), (pg_temp.ft(30), pg_temp.ft(23), 'present'),
  (pg_temp.ft(34), pg_temp.ft(24), 'present'),
  -- Cross-linked: child A's squad row on academy B's training. The app can't
  -- write this (attendance needs the coach's own session and squad row), but
  -- old or operator data could, and it must not show.
  (pg_temp.ft(34), pg_temp.ft(20), 'present');

-- Consent through the parent's own RPC, the way the app records it.
SET LOCAL ROLE authenticated;
SELECT pg_temp.ft_as(pg_temp.ft(5));
SELECT public.record_parental_consent(pg_temp.ft(3), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
SELECT public.record_parental_consent(pg_temp.ft(4), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');
SELECT pg_temp.ft_as(pg_temp.ft(14));
SELECT public.record_parental_consent(pg_temp.ft(13), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');

-- ── 1. The child reads their own training ─────────────────────────────────
SELECT pg_temp.ft_as(pg_temp.ft(3));
SELECT pg_temp.ft_check(jsonb_array_length(pg_temp.ft_rows(pg_temp.ft(3))) = 2,
  '1 J6 the child reads their two trainings, not the match', pg_temp.ft_rows(pg_temp.ft(3))::text);
SELECT pg_temp.ft_check(
  pg_temp.ft_rows(pg_temp.ft(3)) -> 0 ->> 'attendance' = 'late'
  AND pg_temp.ft_rows(pg_temp.ft(3)) -> 0 -> 'focus' = 'null'::jsonb
  AND pg_temp.ft_rows(pg_temp.ft(3)) -> 1 ->> 'attendance' = 'present'
  AND pg_temp.ft_rows(pg_temp.ft(3)) -> 1 -> 'focus' = '["Technical", "Tactical"]'::jsonb,
  '1 J6 newest first, with the focus labels and this child''s own attendance; no focus stays empty',
  pg_temp.ft_rows(pg_temp.ft(3))::text);
SELECT pg_temp.ft_check(pg_temp.ft_rows(pg_temp.ft(3))::text !~ 'SECRET',
  '1 J6 nothing from the title or notes reaches the family');
SELECT pg_temp.ft_check(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.ft_rows(pg_temp.ft(3)) -> 0) k)
    = ARRAY['attendance', 'focus', 'session_date', 'session_id'],
  '1 J6 the rows carry the session id, date, focus and attendance and nothing else');
SELECT pg_temp.ft_check((SELECT count(*) FROM public.coach_sessions) = 0,
  '1 G3 the child still reads no coach_sessions row directly');

-- ── 2. Only their own child ───────────────────────────────────────────────
SELECT pg_temp.ft_refused(format('SELECT * FROM public.family_training_history(%L)', pg_temp.ft(4)), 'not_family',
  '2 G3 a child cannot read their sibling''s training');
SELECT pg_temp.ft_refused(format('SELECT * FROM public.family_training_history(%L)', pg_temp.ft(13)), 'not_family',
  '2 G3 a child cannot read a child in another academy');

SELECT pg_temp.ft_as(pg_temp.ft(5));
SELECT pg_temp.ft_check(jsonb_array_length(pg_temp.ft_rows(pg_temp.ft(3))) = 2
  AND pg_temp.ft_rows(pg_temp.ft(3))::text !~ 'SECRET',
  '2 J6 the linked parent reads the child''s trainings, with no title or notes');
SELECT pg_temp.ft_check(
  jsonb_array_length(pg_temp.ft_rows(pg_temp.ft(4))) = 2
  AND pg_temp.ft_rows(pg_temp.ft(4)) -> 0 ->> 'attendance' = 'absent'
  AND pg_temp.ft_rows(pg_temp.ft(4)) -> 1 ->> 'attendance' = 'present',
  '2 J6 the parent reads each sibling''s own attendance, not the other''s', pg_temp.ft_rows(pg_temp.ft(4))::text);
SELECT pg_temp.ft_refused(format('SELECT * FROM public.family_training_history(%L)', pg_temp.ft(13)), 'not_family',
  '2 G3 a parent cannot read a child they are not linked to');
SELECT pg_temp.ft_as(pg_temp.ft(14));
SELECT pg_temp.ft_refused(format('SELECT * FROM public.family_training_history(%L)', pg_temp.ft(3)), 'not_family',
  '2 G3 a parent in another academy cannot read this child');
SELECT pg_temp.ft_as(pg_temp.ft(12));
SELECT pg_temp.ft_refused(format('SELECT * FROM public.family_training_history(%L)', pg_temp.ft(3)), 'not_family',
  '2 G3 a coach in another academy cannot read this child through the family path');
SELECT pg_temp.ft_as(pg_temp.ft(13));
SELECT pg_temp.ft_check(jsonb_array_length(pg_temp.ft_rows(pg_temp.ft(13))) = 1,
  '2 CONTROL the child in academy B reads their own academy''s training');

-- ── 3. Consent ────────────────────────────────────────────────────────────
SELECT pg_temp.ft_as(pg_temp.ft(6));
SELECT pg_temp.ft_refused(format('SELECT * FROM public.family_training_history(%L)', pg_temp.ft(6)), 'consent_required',
  '3 G1 an under-18 without consent reads nothing');
SELECT pg_temp.ft_as(pg_temp.ft(7));
SELECT pg_temp.ft_refused(format('SELECT * FROM public.family_training_history(%L)', pg_temp.ft(6)), 'consent_required',
  '3 G1 nor does their parent, before approving');
SELECT pg_temp.ft_as(pg_temp.ft(8));
SELECT pg_temp.ft_check(jsonb_array_length(pg_temp.ft_rows(pg_temp.ft(8))) = 1,
  '3 CONTROL an adult player needs no parental consent');

SELECT pg_temp.ft_as(pg_temp.ft(5));
SELECT pg_temp.ft_check(public.withdraw_parental_consent(pg_temp.ft(3)) >= 1, '3 the parent withdraws for child A');
SELECT pg_temp.ft_refused(format('SELECT * FROM public.family_training_history(%L)', pg_temp.ft(3)), 'consent_required',
  '3 G6 after withdrawal, a fresh read by the parent is refused');
SELECT pg_temp.ft_as(pg_temp.ft(3));
SELECT pg_temp.ft_refused(format('SELECT * FROM public.family_training_history(%L)', pg_temp.ft(3)), 'consent_required',
  '3 G6 and by the child');
SELECT pg_temp.ft_as(pg_temp.ft(5));
SELECT pg_temp.ft_check(jsonb_array_length(pg_temp.ft_rows(pg_temp.ft(4))) = 2,
  '3 CONTROL the sibling''s own consent still stands');
RESET ROLE;

-- ── 4. The door ───────────────────────────────────────────────────────────
SELECT pg_temp.ft_check(
  has_function_privilege('authenticated', 'public.family_training_history(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.family_training_history(uuid)', 'EXECUTE'),
  '4 signed-in users may call it; anonymous callers may not');
SELECT pg_temp.ft_check(
  NOT has_table_privilege('authenticated', 'public.coach_sessions', 'SELECT')
  OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coach_sessions'
                 AND cmd IN ('SELECT', 'ALL') AND coalesce(qual, '') ~ '(player_parent_links|linked_player_id)'),
  '4 G3 no family read policy was added to coach_sessions');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.ft_results;
  IF total <> 22 THEN
    RAISE EXCEPTION 'Family training history: % assertions ran; expected exactly 22', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Family training history: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.ft_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Family training history: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;
