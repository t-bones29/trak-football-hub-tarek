-- @trak-suite mode=--announcements in-all=true
-- TRAK-602 (coach–player P16): a coach posts a short announcement to their own squad, with an optional https:// link
-- and an optional Got it by a day, and can withdraw it. The squad's players read it; another squad, another academy, a
-- player waiting for consent or off the roster, and a parent read nothing. The table refuses more than 500 characters
-- and a link that isn't https://. Withdrawing hides it from players, closes its Got it and keeps it for the coach. With
-- the switch off nothing is written or read. No app role touches the table directly.
-- Synthetic fixtures; the suite rolls back.
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_setting('trak.test_database', true) IS DISTINCT FROM 'disposable' THEN
  RAISE EXCEPTION 'Refusing announcement fixtures outside disposable harness';
 END IF;
END $$;
CREATE FUNCTION pg_temp.t602id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
 SELECT ('96020000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
CREATE TEMP TABLE t602_results(label text, ok boolean, detail text);
GRANT SELECT, INSERT ON t602_results TO authenticated, anon;
CREATE TEMP TABLE t602_kept(name text PRIMARY KEY, id uuid);
GRANT SELECT, INSERT ON t602_kept TO authenticated, anon;
CREATE FUNCTION pg_temp.t602actor(n integer) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.t602id(n))::text,true)::text
$$;
CREATE FUNCTION pg_temp.t602check(ok boolean, label text, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
 INSERT INTO pg_temp.t602_results VALUES(label, ok IS TRUE, detail)
$$;
-- True only when the statement fails with exactly this SQLSTATE: a failure for any other reason proves nothing.
CREATE FUNCTION pg_temp.t602refused(statement text, code text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;
 RETURN st IS NOT DISTINCT FROM code;
END $$;
CREATE FUNCTION pg_temp.t602kept(name text) RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT id FROM pg_temp.t602_kept WHERE t602_kept.name = $1
$$;
-- What the caller reads, as kept names in the order given ('' when nothing).
CREATE FUNCTION pg_temp.t602reads() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce(string_agg(coalesce(k.name, '?'), ',' ORDER BY m.ord), '')
 FROM public.my_announcements() WITH ORDINALITY m(id, body, link, published_at, time_zone, ord)
 LEFT JOIN pg_temp.t602_kept k ON k.id = m.id
$$;
CREATE FUNCTION pg_temp.t602withdraw(name text) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT format('SELECT public.withdraw_announcement(%L)', pg_temp.t602kept(name))
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Academy A (100): Coach One (10) has U16: Ola (40, adult, 20), Kai (42, 14, parent 30, consent) and Leo (46, 14, no
-- consent, 26); and U14: Zoe (47, adult, 27). Coach Two (11) is in A with no squad. Academy B (101): Coach Three (12)
-- has a U16 too, with Max (44, adult, 24). Both academies have the tasks and announcements switches on.
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT pg_temp.t602id(n),'synthetic-'||n||'@announce602.invalid',now() FROM unnest(ARRAY[1,2,10,11,12,20,22,24,26,27,30]) n;
INSERT INTO public.profiles(user_id,role,full_name) VALUES
 (pg_temp.t602id(1),'club','Synthetic Admin A'),(pg_temp.t602id(2),'club','Synthetic Admin B'),
 (pg_temp.t602id(10),'coach','Synthetic Coach One'),(pg_temp.t602id(11),'coach','Synthetic Coach Two'),
 (pg_temp.t602id(12),'coach','Synthetic Coach Three'),
 (pg_temp.t602id(20),'player','Synthetic Player Ola'),(pg_temp.t602id(22),'player','Synthetic Player Kai'),
 (pg_temp.t602id(24),'player','Synthetic Player Max'),(pg_temp.t602id(26),'player','Synthetic Player Leo'),
 (pg_temp.t602id(27),'player','Synthetic Player Zoe'),
 (pg_temp.t602id(30),'parent','Synthetic Parent Kai');
INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
 (pg_temp.t602id(100),pg_temp.t602id(1),'Announce Academy A','T602A1'),(pg_temp.t602id(101),pg_temp.t602id(2),'Announce Academy B','T602B1');
INSERT INTO public.coach_details(user_id,organization_id) VALUES
 (pg_temp.t602id(10),pg_temp.t602id(100)),(pg_temp.t602id(11),pg_temp.t602id(100)),(pg_temp.t602id(12),pg_temp.t602id(101));
INSERT INTO public.player_details(user_id,date_of_birth) VALUES
 (pg_temp.t602id(20), current_date - interval '20 years'),(pg_temp.t602id(22), current_date - interval '14 years'),
 (pg_temp.t602id(24), current_date - interval '20 years'),(pg_temp.t602id(26), current_date - interval '14 years'),
 (pg_temp.t602id(27), current_date - interval '20 years');
INSERT INTO public.player_parent_links(player_user_id,parent_user_id) VALUES (pg_temp.t602id(22),pg_temp.t602id(30));
INSERT INTO public.squad_players(id,coach_user_id,player_name,age_group,linked_player_id) VALUES
 (pg_temp.t602id(40),pg_temp.t602id(10),'Synthetic Player Ola','U16',pg_temp.t602id(20)),
 (pg_temp.t602id(42),pg_temp.t602id(10),'Synthetic Player Kai','U16',pg_temp.t602id(22)),
 (pg_temp.t602id(46),pg_temp.t602id(10),'Synthetic Player Leo','U16',pg_temp.t602id(26)),
 (pg_temp.t602id(47),pg_temp.t602id(10),'Synthetic Player Zoe','U14',pg_temp.t602id(27)),
 (pg_temp.t602id(44),pg_temp.t602id(12),'Synthetic Player Max','U16',pg_temp.t602id(24));
-- Academies start with tasks (20261128200000) and announcements (20261128210000) on. This suite switches them by hand,
-- as an operator still can.
DELETE FROM public.academy_features WHERE feature IN ('tasks', 'announcements');
INSERT INTO public.academy_features(organization_id,feature)
 SELECT o, f FROM unnest(ARRAY[pg_temp.t602id(100),pg_temp.t602id(101)]) o, unnest(ARRAY['tasks','announcements']) f;
SELECT pg_temp.t602check((SELECT count(*) FROM public.squad_players
    WHERE id IN (pg_temp.t602id(40),pg_temp.t602id(42),pg_temp.t602id(46),pg_temp.t602id(47))
    AND organization_id = pg_temp.t602id(100) AND status = 'active') = 4,
  '0 CONTROL the roster rows carry their coach''s academy and are active');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t602actor(30);
SELECT public.record_parental_consent(pg_temp.t602id(22), 'parent', '{"coaching_records":true}'::jsonb, 'synthetic-v1', 'Synthetic disposable consent.');

-- ── 1. The coach posts to their own squad ──────────────────────────────────
SELECT pg_temp.t602actor(10);
INSERT INTO pg_temp.t602_kept SELECT 'plain', public.post_announcement(' U16 ', E'  Training moves to 18:00 on Friday.\n ', 'https://example.org/pitch-map');
INSERT INTO pg_temp.t602_kept SELECT 'got-it', public.post_announcement('U16', 'Bring your passport for the tournament.', NULL, current_date + 2);
INSERT INTO pg_temp.t602_kept SELECT 'u14', public.post_announcement('U14', 'U14: no training on Monday.', '');
RESET ROLE;
-- Posted apart, so "newest first" has something to order.
UPDATE public.announcements SET published_at = now() - interval '2 hours' WHERE id = pg_temp.t602kept('plain');
UPDATE public.announcements SET published_at = now() - interval '1 hour' WHERE id = pg_temp.t602kept('got-it');
UPDATE public.announcements SET published_at = now() - interval '30 minutes' WHERE id = pg_temp.t602kept('u14');
INSERT INTO pg_temp.t602_kept SELECT 'got-it-task', id FROM public.trak_tasks WHERE source_type = 'announcement' AND source_id = pg_temp.t602kept('got-it');
SELECT pg_temp.t602check((SELECT squad = 'U16' AND body = 'Training moves to 18:00 on Friday.' AND link = 'https://example.org/pitch-map'
      AND got_it_by IS NULL AND withdrawn_at IS NULL AND organization_id = pg_temp.t602id(100) AND coach_user_id = pg_temp.t602id(10)
    FROM public.announcements WHERE id = pg_temp.t602kept('plain')),
  '1 an announcement is stored for the coach''s squad, with the squad and the message trimmed');
SELECT pg_temp.t602check((SELECT link IS NULL FROM public.announcements WHERE id = pg_temp.t602kept('u14')),
  '1 an empty link is no link');
SELECT pg_temp.t602check((SELECT count(*) FROM public.trak_tasks WHERE source_type = 'announcement') = 1
    AND (SELECT squad = 'U16' AND squad_player_id IS NULL AND answer_kind = 'got_it' AND status = 'open' AND coach_user_id = pg_temp.t602id(10)
          AND title = 'Bring your passport for the tournament.' AND due_at = (current_date + 3)::timestamp AT TIME ZONE 'Asia/Dubai'
        FROM public.trak_tasks WHERE id = pg_temp.t602kept('got-it-task')),
  '1 Got it asked: one squad task, due at the end of the coach''s day on the academy''s clock; none without it');
SET LOCAL ROLE authenticated;

-- ── 2. The squad reads it; nobody else does ────────────────────────────────
SELECT pg_temp.t602actor(20);
SELECT pg_temp.t602check(pg_temp.t602reads() = 'got-it,plain', '2 Ola reads her squad''s two, newest first, and not U14''s', pg_temp.t602reads());
SELECT pg_temp.t602check((SELECT m.body = 'Training moves to 18:00 on Friday.' AND m.link = 'https://example.org/pitch-map' AND m.time_zone = 'Asia/Dubai'
    FROM public.my_announcements(pg_temp.t602id(20)) m WHERE m.id = pg_temp.t602kept('plain')),
  '2 a row has the message, the link and the academy''s time zone (asked for herself by id too)');
SELECT public.respond_to_task(pg_temp.t602kept('got-it-task'));
SELECT pg_temp.t602check((SELECT t.answered FROM public.my_tasks() t WHERE t.task_id = pg_temp.t602kept('got-it-task')),
  '2 the Got it is in Ola''s My tasks, and she answers it');
SELECT pg_temp.t602actor(22);
SELECT pg_temp.t602check(pg_temp.t602reads() = 'got-it,plain', '2 Kai, with consent, reads them too', pg_temp.t602reads());
SELECT pg_temp.t602check((SELECT count(*) FROM public.my_announcements(pg_temp.t602id(20))) = 0, '2 Kai can''t read in Ola''s name');
SELECT pg_temp.t602actor(27);
SELECT pg_temp.t602check(pg_temp.t602reads() = 'u14', '2 Zoe, in the coach''s other squad, reads only U14''s', pg_temp.t602reads());
SELECT pg_temp.t602actor(26);
SELECT pg_temp.t602check(pg_temp.t602reads() = '', '2 Leo, waiting for consent, reads nothing', pg_temp.t602reads());
SELECT pg_temp.t602actor(24);
SELECT pg_temp.t602check(pg_temp.t602reads() = '', '2 Max, in another academy''s U16, reads nothing of academy A''s', pg_temp.t602reads());
SELECT pg_temp.t602actor(30);
SELECT pg_temp.t602check(pg_temp.t602reads() = '' AND (SELECT count(*) FROM public.my_announcements(pg_temp.t602id(22))) = 0,
  '2 a parent reads nothing yet, not even for their child');
SELECT pg_temp.t602actor(10);
SELECT pg_temp.t602check(pg_temp.t602reads() = '', '2 the coach has no player copy');

-- ── 3. Only the squad's coach posts ────────────────────────────────────────
SELECT pg_temp.t602actor(11);
SELECT pg_temp.t602check(pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''Not my squad'')', '42501'),
  '3 a coach without that squad can''t post to it');
SELECT pg_temp.t602actor(20);
SELECT pg_temp.t602check(pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''From a player'')', '42501'),
  '3 a player can''t post');
SELECT pg_temp.t602actor(12);
INSERT INTO pg_temp.t602_kept SELECT 'b-u16', public.post_announcement('U16', 'Academy B: kit check on Thursday.');
SELECT pg_temp.t602actor(24);
SELECT pg_temp.t602check(pg_temp.t602reads() = 'b-u16', '3 academy B''s coach posts to his own U16, and Max reads it', pg_temp.t602reads());
SELECT pg_temp.t602actor(20);
SELECT pg_temp.t602check(pg_temp.t602reads() = 'got-it,plain', '3 Ola, in academy A''s U16, doesn''t', pg_temp.t602reads());

-- ── 4. What is refused ─────────────────────────────────────────────────────
SELECT pg_temp.t602actor(10);
-- 500 characters, one of them two bytes: the limit counts characters.
INSERT INTO pg_temp.t602_kept SELECT 'long', public.post_announcement('U16', repeat('a', 499) || 'é', NULL, current_date + 1);
SELECT pg_temp.t602check(pg_temp.t602refused(format('SELECT public.post_announcement(''U16'', %L)', repeat('x', 501)), '23514'),
  '4 501 characters are refused; 500 are allowed');
SELECT pg_temp.t602check(pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''   '')', '23514')
    AND pg_temp.t602refused('SELECT public.post_announcement(''U16'', E''\n\t '')', '23514'),
  '4 an empty message is refused');
SELECT pg_temp.t602check(pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''Map'', ''http://example.org/map'')', '23514')
    AND pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''Map'', ''javascript:alert(1)'')', '23514')
    AND pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''Map'', ''https://example.org/a map'')', '23514')
    AND pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''Map'', ''https://'')', '23514'),
  '4 a link must be https:// and an address');
SELECT pg_temp.t602check(pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''Too late'', NULL, (now() AT TIME ZONE ''Asia/Dubai'')::date - 1)', '22023'),
  '4 a Got it day already past on the academy''s clock is refused');
RESET ROLE;
SELECT pg_temp.t602check((SELECT title = repeat('a', 79) || '…' FROM public.trak_tasks WHERE source_type = 'announcement' AND source_id = pg_temp.t602kept('long')),
  '4 a long message''s Got it has the task title''s 80 characters, cut with an ellipsis');
SET LOCAL ROLE authenticated;

-- ── 5. Withdrawing ─────────────────────────────────────────────────────────
SELECT pg_temp.t602actor(11);
SELECT pg_temp.t602check(pg_temp.t602refused(pg_temp.t602withdraw('got-it'), '42501'), '5 another coach in the academy can''t withdraw it');
SELECT pg_temp.t602actor(20);
SELECT pg_temp.t602check(pg_temp.t602refused(pg_temp.t602withdraw('got-it'), '42501'), '5 a player can''t withdraw it');
SELECT pg_temp.t602actor(10);
SELECT public.withdraw_announcement(pg_temp.t602kept('got-it'));
SELECT pg_temp.t602actor(20);
SELECT pg_temp.t602check(pg_temp.t602reads() = 'long,plain', '5 withdrawn, it is gone from Ola''s list', pg_temp.t602reads());
SELECT pg_temp.t602check((SELECT count(*) FROM public.my_tasks() t WHERE t.task_id = pg_temp.t602kept('got-it-task')) = 0
    AND pg_temp.t602refused(format('SELECT public.undo_task_response(%L)', pg_temp.t602kept('got-it-task')), '42501'),
  '5 and so is its Got it: it leaves My tasks and can''t be undone');
SELECT pg_temp.t602actor(10);
SELECT pg_temp.t602check((SELECT c.withdrawn_at IS NOT NULL FROM public.coach_announcements() c WHERE c.id = pg_temp.t602kept('got-it')),
  '5 the coach keeps it, marked withdrawn');
RESET ROLE;
UPDATE public.announcements SET withdrawn_at = now() - interval '1 hour' WHERE id = pg_temp.t602kept('got-it');
SELECT pg_temp.t602check(EXISTS (SELECT 1 FROM public.task_responses WHERE task_id = pg_temp.t602kept('got-it-task')),
  '5 Ola''s answer is kept');
SET LOCAL ROLE authenticated;
SELECT pg_temp.t602actor(10);
SELECT public.withdraw_announcement(pg_temp.t602kept('got-it'));
RESET ROLE;
SELECT pg_temp.t602check((SELECT withdrawn_at = now() - interval '1 hour' FROM public.announcements WHERE id = pg_temp.t602kept('got-it')),
  '5 withdrawing again keeps the first time');
SET LOCAL ROLE authenticated;

-- ── 6. The coach's list ────────────────────────────────────────────────────
SELECT pg_temp.t602actor(10);
SELECT pg_temp.t602check((SELECT array_agg(k.name ORDER BY c.ord)
      FROM public.coach_announcements() WITH ORDINALITY c(id, squad, body, link, got_it_by, published_at, withdrawn_at, ord)
      JOIN pg_temp.t602_kept k ON k.id = c.id) = ARRAY['long', 'u14', 'got-it', 'plain'],
  '6 the coach lists their own in every squad, newest first, withdrawn ones too');
SELECT pg_temp.t602check((SELECT c.got_it_by = current_date + 2 AND c.squad = 'U16' FROM public.coach_announcements() c WHERE c.id = pg_temp.t602kept('got-it')),
  '6 with its squad and Got it day');
SELECT pg_temp.t602actor(11);
SELECT pg_temp.t602check((SELECT count(*) FROM public.coach_announcements()) = 0, '6 another coach lists none of them');
SELECT pg_temp.t602actor(20);
SELECT pg_temp.t602check((SELECT count(*) FROM public.coach_announcements()) = 0, '6 a player lists none');

-- ── 7. Consent withdrawn, and leaving the roster ───────────────────────────
SELECT pg_temp.t602actor(30);
SELECT public.withdraw_parental_consent(pg_temp.t602id(22));
SELECT pg_temp.t602actor(22);
SELECT pg_temp.t602check(pg_temp.t602reads() = '', '7 with consent withdrawn Kai reads nothing', pg_temp.t602reads());
-- The academy's roster load does this, not a signed-in user.
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.squad_players SET status = 'released' WHERE id = pg_temp.t602id(40);
SET LOCAL ROLE authenticated;
SELECT pg_temp.t602actor(20);
SELECT pg_temp.t602check(pg_temp.t602reads() = '', '7 Ola leaves the roster and stops reading her old squad''s', pg_temp.t602reads());

-- ── 8. The switches ────────────────────────────────────────────────────────
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id = pg_temp.t602id(100) AND feature = 'tasks';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t602actor(10);
SELECT pg_temp.t602check(pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''Got it?'', NULL, current_date + 1)', '42501'),
  '8 with tasks off, Got it can''t be asked');
INSERT INTO pg_temp.t602_kept SELECT 'tasks-off', public.post_announcement('U16', 'Posted with tasks off.');
SELECT pg_temp.t602check(pg_temp.t602kept('tasks-off') IS NOT NULL, '8 without Got it it still posts');
RESET ROLE;
DELETE FROM public.academy_features WHERE organization_id = pg_temp.t602id(100) AND feature = 'announcements';
SET LOCAL ROLE authenticated;
SELECT pg_temp.t602actor(10);
SELECT pg_temp.t602check(pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''Switched off'')', '42501')
    AND pg_temp.t602refused(pg_temp.t602withdraw('plain'), '42501')
    AND (SELECT count(*) FROM public.coach_announcements()) = 0,
  '8 with announcements off the coach can''t post, withdraw or list');
SELECT pg_temp.t602actor(27);
SELECT pg_temp.t602check(pg_temp.t602reads() = '', '8 with announcements off Zoe reads nothing', pg_temp.t602reads());
SELECT pg_temp.t602actor(24);
SELECT pg_temp.t602check(pg_temp.t602reads() = 'b-u16', '8 CONTROL academy B''s switch is still on', pg_temp.t602reads());

-- ── 9. No direct access to the table ───────────────────────────────────────
SELECT pg_temp.t602check(NOT has_table_privilege('authenticated', 'public.announcements', 'SELECT, INSERT, UPDATE, DELETE')
    AND NOT has_table_privilege('anon', 'public.announcements', 'SELECT, INSERT, UPDATE, DELETE'),
  '9 neither app role has any privilege on the table');
SELECT pg_temp.t602check(pg_temp.t602refused('SELECT count(*) FROM public.announcements', '42501'),
  '9 a signed-in player can''t read the table directly');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.t602check(pg_temp.t602refused('SELECT * FROM public.my_announcements()', '42501')
    AND pg_temp.t602refused('SELECT public.post_announcement(''U16'', ''From a visitor'')', '42501'),
  '9 a visitor who isn''t signed in can''t call the functions');
RESET ROLE;

DO $$
DECLARE failed text;
BEGIN
 SELECT string_agg(label || coalesce(' [' || detail || ']', ''), '; ') INTO failed FROM pg_temp.t602_results WHERE NOT ok;
 IF failed IS NOT NULL THEN RAISE EXCEPTION 'Announcement checks failed: %', failed; END IF;
 IF (SELECT count(*) FROM pg_temp.t602_results) < 44 THEN RAISE EXCEPTION 'Announcements: only % checks ran', (SELECT count(*) FROM pg_temp.t602_results); END IF;
END $$;
ROLLBACK;
