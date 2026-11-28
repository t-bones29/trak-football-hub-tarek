-- @trak-suite mode=--training-themes-review in-all=true
-- TRAK-635: a training keeps any number of the seven catalogue themes, each once. A match or other event has none,
-- and a misspelt key fails loudly. The coach's own insert passes the same check (the helper is callable by them).
-- Synthetic fixtures only; one transaction that rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $test$
BEGIN
  IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
    RAISE EXCEPTION 'Refusing training-theme fixtures outside the disposable test harness';
  END IF;
END;
$test$;

CREATE FUNCTION pg_temp.tt(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $test$
  SELECT ('98e00000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
$test$;

CREATE TEMP TABLE tt_results (description text, passed boolean, detail text);
GRANT INSERT ON tt_results TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.tt_check(ok boolean, description text) RETURNS void
LANGUAGE sql AS $test$
  INSERT INTO pg_temp.tt_results VALUES (description, coalesce(ok, false), NULL);
$test$;

CREATE FUNCTION pg_temp.tt_event(p_id integer, p_type text, p_themes text[]) RETURNS text LANGUAGE sql AS $test$
  SELECT format($$INSERT INTO public.coach_calendar_events(id,coach_user_id,title,event_type,starts_at,event_date,start_time,published,training_themes)
    VALUES (%L,%L,'Synthetic',%L,now() + interval '2 days',(now() AT TIME ZONE 'Asia/Dubai' + interval '2 days')::date,'17:00',false,%L)$$,
    pg_temp.tt(p_id), pg_temp.tt(10), p_type, p_themes);
$test$;

CREATE FUNCTION pg_temp.tt_allowed(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.tt_results VALUES (description, failure IS NULL, failure);
END;
$test$;

CREATE FUNCTION pg_temp.tt_refused(statement text, description text) RETURNS void
LANGUAGE plpgsql AS $test$
DECLARE failure text;
BEGIN
  BEGIN
    EXECUTE statement;
    failure := 'unexpectedly allowed';
  EXCEPTION WHEN check_violation THEN failure := NULL;
            WHEN OTHERS THEN failure := SQLSTATE || ': ' || SQLERRM;
  END;
  INSERT INTO pg_temp.tt_results VALUES (description, failure IS NULL, failure);
END;
$test$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
  (pg_temp.tt(1),'admin@themes.invalid',now()), (pg_temp.tt(10),'coach@themes.invalid',now());
INSERT INTO public.profiles(user_id,role,full_name) VALUES (pg_temp.tt(1),'club','TT Admin'), (pg_temp.tt(10),'coach','TT Coach');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES (pg_temp.tt(100),pg_temp.tt(1),'TT Academy','TT635A');
INSERT INTO public.coach_details(user_id,organization_id) VALUES (pg_temp.tt(10),pg_temp.tt(100));

-- ── 1. The column ──────────────────────────────────────────────────────────
SELECT pg_temp.tt_check(NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'coach_calendar_events' AND column_name = 'training_theme'),
  '1 the single training_theme column is gone');
SELECT pg_temp.tt_check(has_function_privilege('authenticated', 'trak_private.no_repeats(text[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'trak_private.no_repeats(text[])', 'EXECUTE'),
  '1 a signed-in coach can run the each-once check their insert needs; anon cannot');

-- ── 2. What a training may hold ────────────────────────────────────────────
SELECT pg_temp.tt_allowed(pg_temp.tt_event(800, 'training', ARRAY['attacking','transition']), '2 TRAK-635 a training with two themes');
SELECT pg_temp.tt_allowed(pg_temp.tt_event(801, 'training',
  ARRAY['technical','attacking','defending','transition','goalkeeping','physical','psychological']), '2 TRAK-635 a training with all seven');
SELECT pg_temp.tt_allowed(pg_temp.tt_event(802, 'training', ARRAY[]::text[]), '2 a training with none');
SELECT pg_temp.tt_check((SELECT training_themes FROM public.coach_calendar_events WHERE id = pg_temp.tt(800)) = ARRAY['attacking','transition'],
  '2 the themes are stored as picked');
SELECT pg_temp.tt_refused(pg_temp.tt_event(803, 'training', ARRAY['attacking','attacking']), '2 the same theme twice is refused');
SELECT pg_temp.tt_refused(pg_temp.tt_event(804, 'training', ARRAY['Attacking']), '2 a misspelt key is refused');
SELECT pg_temp.tt_refused(pg_temp.tt_event(805, 'match', ARRAY['attacking']), '2 a match cannot have a theme');
SELECT pg_temp.tt_allowed(pg_temp.tt_event(806, 'match', ARRAY[]::text[]), '2 CONTROL a match with none');

-- ── Report ─────────────────────────────────────────────────────────────────
DO $test$
DECLARE failed integer; total integer;
BEGIN
  SELECT count(*) FILTER (WHERE NOT passed), count(*) INTO failed, total FROM pg_temp.tt_results;
  IF total <> 10 THEN
    RAISE EXCEPTION 'Training themes: % assertions ran; expected exactly 10', total;
  END IF;
  IF failed > 0 THEN
    RAISE EXCEPTION 'Training themes: % of % failed: %', failed, total,
      (SELECT string_agg(description || ' [' || coalesce(detail, '') || ']', ' || ') FROM pg_temp.tt_results WHERE NOT passed);
  END IF;
  RAISE NOTICE 'Training themes: % of % passed', total - failed, total;
END;
$test$;

ROLLBACK;
