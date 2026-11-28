-- @trak-suite mode=--training-drills in-all=true
-- TRAK-294 (Training 1/5, spec TRAK-293): the training switch and My drills.
-- Training turns on per academy with one academy_features row; a new academy
-- starts without it. A coach's drills are theirs alone: no other coach, player,
-- guardian or anon reads or changes them. Writes need the switch on; reads
-- don't, so switching off loses nothing. Bad values are refused.
-- Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing training-drills fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t294id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('92940000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t294_results(label text, ok boolean);
GRANT SELECT, INSERT ON t294_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.t294actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t294id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t294check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t294_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.t294refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
-- How many rows a statement changed (0 when a rule hid them).
CREATE FUNCTION pg_temp.t294changed(statement text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
 EXECUTE statement; GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Two academies: On (100) gets Training, Off (101) doesn't. Jürgen Klopp
-- coaches at On, Pep Guardiola also at On, Carlo Ancelotti at Off; Thierry
-- Henry is a player and Patrick Vieira a guardian.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t294id(n),'synthetic-'||n||'@training294.invalid',now() FROM unnest(ARRAY[1,2,3,10,11,12,20,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t294id(1),'club','Arsène Wenger'),(pg_temp.t294id(2),'club','Alex Ferguson'),
 (pg_temp.t294id(3),'club','Johan Cruyff'),(pg_temp.t294id(10),'coach','Jürgen Klopp'),
 (pg_temp.t294id(11),'coach','Pep Guardiola'),(pg_temp.t294id(12),'coach','Carlo Ancelotti'),
 (pg_temp.t294id(20),'player','Thierry Henry'),(pg_temp.t294id(30),'parent','Patrick Vieira');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.t294id(100),pg_temp.t294id(1),'Training On Academy','T294N1'),
 (pg_temp.t294id(101),pg_temp.t294id(2),'Training Off Academy','T294F1');
-- Academies start with Matches and Training on (20261115140000). This suite switches them by hand, as an operator
-- still can: its academies start with neither.
DELETE FROM public.academy_features WHERE feature IN ('games','training');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.t294id(10),pg_temp.t294id(100)),(pg_temp.t294id(11),pg_temp.t294id(100)),(pg_temp.t294id(12),pg_temp.t294id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES(pg_temp.t294id(20),'2000-01-01');

-- ── 1. The operator's switch ───────────────────────────────────────────────
SELECT pg_temp.t294check(pg_temp.t294refused(format('INSERT INTO public.academy_features(organization_id,feature) VALUES(%L,%L)',
  pg_temp.t294id(100),'trainings'),'23514'),'1 a misspelt name is still refused, not silently off');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.t294id(100),'training');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES(pg_temp.t294id(102),pg_temp.t294id(3),'New Academy','T294W1');
SELECT pg_temp.t294check((SELECT array_agg(feature ORDER BY feature) FROM public.academy_features WHERE organization_id=pg_temp.t294id(102))=ARRAY['announcements','events','family_look','games','season_plan','tasks','training'],
  '1 a new academy starts with events, Games, Training, the new look, Season plan, tasks and announcements on');

SET LOCAL ROLE authenticated;
SELECT pg_temp.t294actor(10);
SELECT pg_temp.t294check(public.feature_on('training'),'1 a coach of an academy with Training gets it');
SELECT pg_temp.t294check(NOT public.feature_on('games'),'1 and not Games with it');
SELECT pg_temp.t294actor(12);
SELECT pg_temp.t294check(NOT public.feature_on('training'),'1 a coach of an academy without Training doesn''t');
SELECT pg_temp.t294check(pg_temp.t294refused(format('INSERT INTO public.academy_features(organization_id,feature) VALUES(%L,%L)',
  pg_temp.t294id(101),'training'),'42501'),'1 a coach can''t switch Training on');

-- ── 2. A coach's own drills ────────────────────────────────────────────────
SELECT pg_temp.t294actor(10);
INSERT INTO public.coach_drills(id,name,minutes,how,tell,area) VALUES
 (pg_temp.t294id(500),'Rondos 4v1',15,'Four round one in a 10 m square.','Two touches.','10 × 10 m');
SELECT pg_temp.t294check((SELECT coach_user_id FROM public.coach_drills WHERE id=pg_temp.t294id(500))=pg_temp.t294id(10),
  '2 a coach adds a drill, and it is theirs');
SELECT pg_temp.t294check(pg_temp.t294changed(format('UPDATE public.coach_drills SET minutes=20 WHERE id=%L',pg_temp.t294id(500)))=1,
  '2 the coach changes their own drill');
SELECT pg_temp.t294check(pg_temp.t294refused(format('INSERT INTO public.coach_drills(coach_user_id,name,minutes) VALUES(%L,%L,15)',
  pg_temp.t294id(11),'For Pep'),'42501'),'2 a coach can''t add a drill in another coach''s name');

-- ── 3. Nobody else reads or changes them ───────────────────────────────────
SELECT pg_temp.t294actor(11);
SELECT pg_temp.t294check(NOT EXISTS(SELECT 1 FROM public.coach_drills),'3 another coach of the same academy reads none');
SELECT pg_temp.t294check(pg_temp.t294changed(format('UPDATE public.coach_drills SET name=%L WHERE id=%L','Mine now',pg_temp.t294id(500)))=0,
  '3 or changes one');
SELECT pg_temp.t294check(pg_temp.t294changed(format('DELETE FROM public.coach_drills WHERE id=%L',pg_temp.t294id(500)))=0,
  '3 or deletes one');
SELECT pg_temp.t294actor(20);
SELECT pg_temp.t294check(NOT EXISTS(SELECT 1 FROM public.coach_drills),'3 a player reads none');
SELECT pg_temp.t294check(pg_temp.t294refused('INSERT INTO public.coach_drills(name,minutes) VALUES(''Mine'',15)','42501'),
  '3 or adds one');
SELECT pg_temp.t294actor(30);
SELECT pg_temp.t294check(NOT EXISTS(SELECT 1 FROM public.coach_drills),'3 a guardian reads none');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.t294check(pg_temp.t294refused('SELECT 1 FROM public.coach_drills','42501'),'3 anon can''t read the table at all');
RESET ROLE;

-- ── 4. Bad values are refused ──────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.t294actor(10);
SELECT pg_temp.t294check(pg_temp.t294refused('INSERT INTO public.coach_drills(name,minutes) VALUES(''   '',15)','23514'),'4 a blank name');
SELECT pg_temp.t294check(pg_temp.t294refused(format('INSERT INTO public.coach_drills(name,minutes) VALUES(%L,15)',repeat('x',81)),'23514'),
  '4 a name over 80');
SELECT pg_temp.t294check(pg_temp.t294refused('INSERT INTO public.coach_drills(name,minutes) VALUES(''Long'',90)','23514'),'4 minutes over 60');
SELECT pg_temp.t294check(pg_temp.t294refused(format('INSERT INTO public.coach_drills(name,minutes,how) VALUES(%L,15,%L)','How',repeat('x',1001)),'23514'),
  '4 how it works over 1000');
SELECT pg_temp.t294check(pg_temp.t294refused(format('INSERT INTO public.coach_drills(name,minutes,conditions) VALUES(%L,15,%L)','Cond',repeat('x',121)),'23514'),
  '4 a detail over 120');

-- ── 5. Switched off: writes stop, reads stay ───────────────────────────────
SELECT pg_temp.t294actor(12);
SELECT pg_temp.t294check(pg_temp.t294refused('INSERT INTO public.coach_drills(name,minutes) VALUES(''Off'',15)','42501'),
  '5 a coach of an academy without Training can''t add a drill');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id=pg_temp.t294id(100) AND feature='training';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t294actor(10);
SELECT pg_temp.t294check(EXISTS(SELECT 1 FROM public.coach_drills WHERE id=pg_temp.t294id(500)),'5 switched off, the coach still reads their drills');
SELECT pg_temp.t294check(pg_temp.t294refused('INSERT INTO public.coach_drills(name,minutes) VALUES(''After'',15)','42501'),
  '5 but can''t add one');
SELECT pg_temp.t294check(pg_temp.t294changed(format('UPDATE public.coach_drills SET minutes=25 WHERE id=%L',pg_temp.t294id(500)))=0,
  '5 or change one');
SELECT pg_temp.t294check(pg_temp.t294changed(format('DELETE FROM public.coach_drills WHERE id=%L',pg_temp.t294id(500)))=0,
  '5 or delete one');
RESET ROLE;

-- ── 6. Back on: the coach deletes their own drill ──────────────────────────
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.t294id(100),'training');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t294actor(10);
SELECT pg_temp.t294check(pg_temp.t294changed(format('DELETE FROM public.coach_drills WHERE id=%L',pg_temp.t294id(500)))=1,
  '6 the coach deletes their own drill');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.t294_results;
 IF total <> 27 THEN RAISE EXCEPTION 'Training drills: % checks ran; expected 27', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.t294_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Training drills checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Training drills: % of % passed', total, total;
END $$;
ROLLBACK;
