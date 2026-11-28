-- @trak-suite mode=--games-switch in-all=true
-- TRAK-283 (Games 1/8): Games turns on per academy with the switch events use,
-- one row in academy_features. Only a coach of an academy with the row gets it;
-- app roles can't write switches; deleting the row turns Games off at once
-- (the kill switch); a new academy starts with events on and Games off.
-- Test people are named after footballers. Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing games-switch fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.g283id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('92830000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE g283_results(label text, ok boolean);
GRANT SELECT, INSERT ON g283_results TO authenticated, anon, service_role;
CREATE FUNCTION pg_temp.g283actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.g283id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.g283check(ok boolean, label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.g283_results VALUES(label, ok IS TRUE)
$$;
-- True when the statement fails with exactly this SQLSTATE.
CREATE FUNCTION pg_temp.g283refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- Two academies, both with events on (every new academy starts with them):
-- On (100) gets Games, Off (101) doesn't. Otto Rehhagel coaches at On,
-- Fernando Santos at Off; Ange Postecoglou has no academy; Theofanis Gekas
-- is a player.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.g283id(n),'synthetic-'||n||'@games283.invalid',now() FROM unnest(ARRAY[1,2,3,10,12,13,20]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.g283id(1),'club','Giorgos Karagounis'),(pg_temp.g283id(2),'club','Angelos Basinas'),
 (pg_temp.g283id(3),'club','Traianos Dellas'),(pg_temp.g283id(10),'coach','Otto Rehhagel'),
 (pg_temp.g283id(12),'coach','Fernando Santos'),(pg_temp.g283id(13),'coach','Ange Postecoglou'),
 (pg_temp.g283id(20),'player','Theofanis Gekas');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.g283id(100),pg_temp.g283id(1),'Games On Academy','G283N1'),
 (pg_temp.g283id(101),pg_temp.g283id(2),'Games Off Academy','G283F1');
-- Academies start with Matches and Training on (20261115140000). This suite switches them by hand, as an operator
-- still can: its academies start with neither.
DELETE FROM public.academy_features WHERE feature IN ('games','training');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.g283id(10),pg_temp.g283id(100)),(pg_temp.g283id(12),pg_temp.g283id(101)),(pg_temp.g283id(13),NULL);
INSERT INTO public.player_details(user_id,date_of_birth) VALUES(pg_temp.g283id(20),'2000-01-01');

-- ── 1. The operator's switch ───────────────────────────────────────────────
SELECT pg_temp.g283check(pg_temp.g283refused(format('INSERT INTO public.academy_features(organization_id,feature) VALUES(%L,%L)',
  pg_temp.g283id(100),'game'),'23514'),'1 a misspelt name is still refused, not silently off');
INSERT INTO public.academy_features(organization_id,feature) VALUES(pg_temp.g283id(100),'games');
SELECT pg_temp.g283check(EXISTS(SELECT 1 FROM public.academy_features WHERE organization_id=pg_temp.g283id(100) AND feature='games'),
  '1 the operator switches Games on with one row');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES(pg_temp.g283id(102),pg_temp.g283id(3),'New Academy','G283W1');
SELECT pg_temp.g283check((SELECT array_agg(feature ORDER BY feature) FROM public.academy_features WHERE organization_id=pg_temp.g283id(102))=ARRAY['announcements','events','family_look','games','season_plan','tasks','training'],
  '1 a new academy starts with events, Games, Training, the new look, Season plan, tasks and announcements on');

-- ── 2. Who gets Games ──────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT pg_temp.g283actor(10);
SELECT pg_temp.g283check(public.feature_on('games'),'2 a coach of an academy with Games gets it');
SELECT pg_temp.g283check(public.feature_on('events'),'2 and still has events');
SELECT pg_temp.g283actor(12);
SELECT pg_temp.g283check(NOT public.feature_on('games'),'2 a coach of an academy without Games doesn''t');
SELECT pg_temp.g283check(public.feature_on('events'),'2 and keeps events');
SELECT pg_temp.g283actor(13);
SELECT pg_temp.g283check(NOT public.feature_on('games'),'2 a coach with no academy doesn''t');
SELECT pg_temp.g283actor(20);
SELECT pg_temp.g283check(NOT public.feature_on('games'),'2 a player doesn''t');

-- ── 3. App roles can't switch it ───────────────────────────────────────────
SELECT pg_temp.g283actor(12);
SELECT pg_temp.g283check(pg_temp.g283refused(format('INSERT INTO public.academy_features(organization_id,feature) VALUES(%L,%L)',
  pg_temp.g283id(101),'games'),'42501'),'3 a coach can''t switch Games on');
SELECT pg_temp.g283actor(10);
SELECT pg_temp.g283check(pg_temp.g283refused(format('DELETE FROM public.academy_features WHERE organization_id=%L',
  pg_temp.g283id(100)),'42501'),'3 or off');
RESET ROLE;

-- ── 4. The kill switch ─────────────────────────────────────────────────────
DELETE FROM public.academy_features WHERE organization_id=pg_temp.g283id(100) AND feature='games';
SET LOCAL ROLE authenticated;
SELECT pg_temp.g283actor(10);
SELECT pg_temp.g283check(NOT public.feature_on('games'),'4 deleting the row switches Games off at once');
SELECT pg_temp.g283check(public.feature_on('events'),'4 and leaves events on');
RESET ROLE;

DO $$ DECLARE failures text; total integer;
BEGIN
 SELECT count(*) INTO total FROM pg_temp.g283_results;
 IF total <> 13 THEN RAISE EXCEPTION 'Games switch: % checks ran; expected 13', total; END IF;
 SELECT string_agg(label, E'\n') INTO failures FROM pg_temp.g283_results WHERE NOT ok;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Games switch checks failed:%', E'\n' || failures; END IF;
 RAISE NOTICE 'Games switch: % of % passed', total, total;
END $$;
ROLLBACK;
