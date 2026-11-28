-- =============================================================
-- TRAK-250 SQUAD VIEWS DEMO: LOCAL SUPABASE STACK ONLY
--
-- Three months (22 Jul - 21 Oct 2026) of one U10 squad, so the coach's
-- Squad tab (Snapshot, Attributes, Availability, Season) has something to
-- show. Synthetic people only: Rehearsal FC, coach "Rami A." and the 13
-- children of Squad-Management-Mockups.html, on example.com addresses.
--
-- NEVER run this against the shared Supabase project. It is for a local
-- `npx --yes supabase@latest start` stack, after
-- `npx --yes supabase@latest db reset` has replayed every migration.
--
-- It refuses to run unless the session sets BOTH:
--   trak.local_demo   = 'yes'   You are saying this database is the local
--                                stack. Nothing else in the file checks it.
--   trak.dev_password = '<a fresh local value>'
--                                The demo accounts' password. Deliberately
--                                not in this file (see dev_data.sql).
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres
--   SET trak.dev_password = '<a fresh local value, never committed>';
--   SET trak.local_demo = 'yes';
--   \i supabase/seeds/squad_views_demo.sql
--
-- The local DB URL is the one `npx --yes supabase@latest status` prints.
-- Then point `.env.local` at the local API (VITE_SUPABASE_URL and
-- VITE_SUPABASE_PUBLISHABLE_KEY from the same status output), run
-- `npm run dev`, and sign in as coach.squad-demo@example.com with that
-- password. Guardians sign in as guardian.<first name>@example.com.
--
-- Running it again is a no-op: fixed UUIDs under 5e250000-..., ON CONFLICT
-- DO NOTHING, and the RPC-written rows are skipped once they exist. The
-- whole file is one transaction, so a refusal leaves nothing behind.
--
-- Writes go the way the app makes them: consent through
-- record_parental_consent as each guardian; sessions, registers and
-- assessments as the coach under RLS; matches through log_match_for_player
-- as the coach (so logged_by is stamped as in production); confirmations
-- through confirm_event_attendance; the absence through report_cant_make_it
-- as Leo's guardian. Accounts, academy and roster rows are the operator's
-- (postgres), as in supabase/tests/roster_admission.sql.
-- =============================================================

\set ON_ERROR_STOP on
BEGIN;

DO $guard$
BEGIN
  IF COALESCE(current_setting('trak.dev_password', true), '') = ''
     OR current_setting('trak.local_demo', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Local demo seed refused. Set trak.dev_password and trak.local_demo = ''yes'', and only on a local supabase stack, never the shared project.';
  END IF;
END;
$guard$;

-- Fixed demo ids: 5e250000-0000-0000-<kind>-<n>.
CREATE OR REPLACE FUNCTION pg_temp.sv(kind integer, n integer) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT ('5e250000-0000-0000-' || lpad(kind::text, 4, '0') || '-' || lpad(n::text, 12, '0'))::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.sv(integer, integer) TO authenticated;

-- The squad. no = shirt number (and the id suffix). pct = the season-minutes
-- share to aim for; band_from/band_to = the overall score (mean of the six
-- attributes) before the latest assessment and at it; cadence = days between
-- assessments. last8 = the register at the last eight trainings, oldest
-- first. tactical_bias = the child's Tactical against the squad's. absent =
-- match numbers missed. Positions use the app's list (POSITIONS); the
-- mockup's Defence/Wide/Centre/Attack map to Defender/Midfielder/Attacker.
CREATE TEMP TABLE demo_squad (
  no integer PRIMARY KEY, name text, first text, position text, dob date,
  pct integer, band_from numeric, band_to numeric, cadence integer,
  last8 text, tactical_bias numeric, consented boolean, absent integer[]
) ON COMMIT DROP;
GRANT SELECT ON demo_squad TO authenticated;
-- Band score mid-points: exceptional 9.3, standout 8.4, good 7.4, steady 6.4,
-- mixed 5.2, developing 3.4 (scoreToBand in src/lib/rating-engine.ts).
INSERT INTO demo_squad VALUES
  ( 1, 'Zayd B.',  'zayd',  'Goalkeeper', '2017-02-11', 92, 7.4, 7.4,  7, '11111111', 0,   true,  '{}'),
  (13, 'Adam H.',  'adam',  'Goalkeeper', '2016-11-03', 71, 6.4, 6.4, 14, '11110111', 0,   true,  '{3,7}'),
  ( 2, 'Omar K.',  'omar',  'Defender',   '2017-01-20', 88, 7.4, 8.4,  7, '11111111', 0,   true,  '{}'),
  ( 3, 'Yusuf A.', 'yusuf', 'Defender',   '2016-12-05', 75, 7.4, 6.4,  7, '11011111', 0,   true,  '{6,10}'),
  ( 4, 'Noah T.',  'noah',  'Midfielder', '2017-03-14', 80, 7.4, 7.4, 21, '11111011', 0,   true,  '{}'),
  ( 5, 'Leo M.',   'leo',   'Defender',   '2016-10-28', 54, 6.4, 5.2, 14, '11010100', 0,   true,  '{6,10,11,12}'),
  ( 6, 'Sami R.',  'sami',  'Attacker',   '2016-09-30', 95, 8.4, 9.3,  7, '11111111', 2.9, true,  '{}'),
  ( 7, 'Ethan P.', 'ethan', 'Midfielder', '2017-05-02', 66, 5.2, 6.4, 21, '11111111', 0,   true,  '{}'),
  ( 8, 'Rayan S.', 'rayan', 'Midfielder', '2017-06-18', 38, 3.4, 3.4,  7, '11111111', -3.1, true, '{}'),
  ( 9, 'Karim F.', 'karim', 'Attacker',   '2017-04-09', 83, 7.4, 7.4, 21, '11101111', 0,   true,  '{6,9}'),
  (10, 'Luca D.',  'luca',  'Midfielder', '2016-12-22', 70, 6.4, 6.4, 14, '11111111', 0,   true,  '{}'),
  (12, 'Elias W.', 'elias', 'Midfielder', '2017-07-07', 62, 5.2, 5.2, 14, '11101001', 0,   true,  '{2,12}'),
  -- Hamza is admitted but his guardian hasn't consented: nothing is recorded about him.
  (11, 'Hamza Q.', 'hamza', 'Attacker',   '2017-01-30', NULL, NULL, NULL, NULL, NULL, 0, false, '{}');

-- Twelve Saturday matches, numbered in date order (15 Aug was a summer break).
-- goals/assists: shirt number => count. Match 8 was quick-logged without
-- minutes (TRAK-198) and has no session. Match 11's third scorer was never
-- entered, so its goals don't add up to the score.
CREATE TEMP TABLE demo_matches (
  n integer PRIMARY KEY, opponent text, venue text, us integer, them integer,
  goals jsonb, assists jsonb, quick_log boolean
) ON COMMIT DROP;
GRANT SELECT ON demo_matches TO authenticated;
INSERT INTO demo_matches VALUES
  ( 1, 'Harbour Lions U10',    'Home', 3, 1, '{"6":2,"9":1}',               '{"9":1,"2":1}',        false),
  ( 2, 'Northside Rovers U10', 'Away', 1, 2, '{"6":1}',                     '{"10":1}',             false),
  ( 3, 'Dune FC U10',          'Home', 4, 2, '{"6":2,"9":1,"4":1}',         '{"10":1,"4":1,"7":1}', false),
  ( 4, 'Creek Athletic U10',   'Away', 2, 2, '{"9":1,"2":1}',               '{"6":1}',              false),
  ( 5, 'Palm Stars U10',       'Home', 5, 1, '{"6":2,"9":1,"7":1,"10":1}',  '{"4":2,"6":1,"2":1}',  false),
  ( 6, 'Bay United U10',       'Away', 0, 1, '{}',                          '{}',                   false),
  ( 7, 'Oasis FC U10',         'Home', 3, 0, '{"6":1,"4":1,"3":1}',         '{"9":1,"10":1}',       false),
  ( 8, 'Falcon Academy U10',   'Away', 2, 3, '{"9":1,"12":1}',              '{"8":1}',              true),
  ( 9, 'Coral City U10',       'Home', 4, 1, '{"6":2,"2":1,"5":1}',         '{"4":1,"10":1,"7":1}', false),
  (10, 'Sandside U10',         'Away', 1, 1, '{"6":1}',                     '{"10":1}',             false),
  (11, 'Lagoon Rangers U10',   'Home', 3, 2, '{"6":1,"9":1}',               '{"2":1,"4":1}',        false),
  (12, 'Jebel Juniors U10',    'Away', 2, 0, '{"6":1,"9":1}',               '{"7":1,"6":1}',        false);

-- Each child's assessment dates and overall score, then their Tactical (section 3).
CREATE TEMP TABLE demo_assessment_plan (
  no integer, k integer, day date, target numeric, tactical integer, PRIMARY KEY (no, k)
) ON COMMIT DROP;
GRANT SELECT, INSERT, UPDATE ON demo_assessment_plan TO authenticated;

-- ── 1. The operator's rows: academy, accounts, squad, roster ──────────────
DO $operator$
DECLARE
  v_org     uuid := pg_temp.sv(1, 1);
  v_admin   uuid := pg_temp.sv(2, 1);
  v_coach   uuid := pg_temp.sv(2, 2);
  v_pw      text := current_setting('trak.dev_password');
  c         record;
  u         record;
BEGIN
  -- Auth users: pre-confirmed, the password from trak.dev_password. The
  -- token columns are '' rather than NULL, which GoTrue can't scan.
  FOR u IN
    SELECT v_admin AS id, 'admin.squad-demo@example.com' AS email, 'club' AS role, 'Rehearsal FC Admin' AS full_name
    UNION ALL SELECT v_coach, 'coach.squad-demo@example.com', 'coach', 'Rami A.'
    UNION ALL SELECT pg_temp.sv(3, s.no), 'child.' || s.first || '@example.com', 'player', s.name FROM demo_squad s
    UNION ALL SELECT pg_temp.sv(4, s.no), 'guardian.' || s.first || '@example.com', 'parent', 'Guardian of ' || s.name FROM demo_squad s
  LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u.email,
      extensions.crypt(v_pw, extensions.gen_salt('bf')), '2026-07-15 08:00+04',
      '{"provider":"email","providers":["email"]}', '{}', '2026-07-15 08:00+04', '2026-07-15 08:00+04',
      '', '', '', ''
    ) ON CONFLICT (id) DO NOTHING;
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at)
    VALUES (u.id, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
            'email', u.id::text, now(), now(), now())
    ON CONFLICT DO NOTHING;
    INSERT INTO public.profiles (user_id, role, full_name)
    VALUES (u.id, u.role::public.user_role, u.full_name)
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;

  -- Rehearsal FC, with events on (J8.1). U10 children are 9, so the academy's
  -- minimum age is lowered to 8, which only the operator can do (TRAK-165).
  INSERT INTO public.organizations (id, admin_user_id, name, join_code, min_player_age)
  VALUES (v_org, v_admin, 'Rehearsal FC', 'RFC-SQUAD-DEMO', 8)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.academy_features (organization_id, feature)
  VALUES (v_org, 'events') ON CONFLICT DO NOTHING;

  INSERT INTO public.coach_details (user_id, organization_id, current_club, team, coach_role)
  VALUES (v_coach, v_org, 'Rehearsal FC', 'U10', 'Head Coach')
  ON CONFLICT (user_id) DO NOTHING;

  FOR c IN SELECT * FROM demo_squad ORDER BY no LOOP
    INSERT INTO public.player_details (user_id, date_of_birth, position, current_club, age_group, shirt_number)
    VALUES (pg_temp.sv(3, c.no), c.dob, c.position, 'Rehearsal FC', 'U10', c.no)
    ON CONFLICT (user_id) DO NOTHING;
    -- On the roster since before the window, so every register counts for them.
    INSERT INTO public.squad_players (id, coach_user_id, player_name, position, shirt_number, age_group, linked_player_id, created_at)
    VALUES (pg_temp.sv(5, c.no), v_coach, c.name, c.position, c.no, 'U10', pg_temp.sv(3, c.no), '2026-07-15 08:00+04')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.roster_children (id, organization_id, squad_player_id, date_of_birth, child_email, player_user_id, loaded_by, source_file)
    VALUES (pg_temp.sv(6, c.no), v_org, pg_temp.sv(5, c.no), c.dob, 'child.' || c.first || '@example.com',
            pg_temp.sv(3, c.no), 'squad-views-demo', 'squad_views_demo.sql')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.roster_guardians (id, roster_child_id, email, relationship, parent_user_id, loaded_by)
    VALUES (pg_temp.sv(7, c.no), pg_temp.sv(6, c.no), 'guardian.' || c.first || '@example.com', 'parent',
            pg_temp.sv(4, c.no), 'squad-views-demo')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
    VALUES (pg_temp.sv(3, c.no), pg_temp.sv(4, c.no))
    ON CONFLICT (player_user_id, parent_user_id) DO NOTHING;
  END LOOP;
END;
$operator$;

-- ── 2. Consent: each guardian except Hamza's approves (G1) ────────────────
DO $consent$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM demo_squad
           WHERE consented AND NOT public.player_has_parental_consent(pg_temp.sv(3, no)) ORDER BY no LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.sv(4, c.no))::text, true);
    PERFORM public.record_parental_consent(pg_temp.sv(3, c.no), 'parent', '{"coaching_records":true}'::jsonb,
      'squad-views-demo', 'Synthetic local demo consent for coaching records.');
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$consent$;

-- ── 3. The coach's season, written as the coach ───────────────────────────
DO $coach$
DECLARE
  v_coach   uuid := pg_temp.sv(2, 2);
  v_matches_logged boolean := EXISTS (SELECT 1 FROM public.matches WHERE logged_by = pg_temp.sv(2, 2));
  v_from    date := '2026-07-22';
  v_to      date := '2026-10-21';
  v_types   text[] := ARRAY['Technical', 'Possession', 'Tactical', 'Physical', 'Game Based', 'Finishing'];
  t         record;
  m         record;
  c         record;
  d         record;
  v_session uuid;
  v_present boolean;
  v_minutes integer;
  v_goals   integer;
  v_assists integer;
  v_dates   date[];
  v_last    date;
  v_k       integer;
  v_tactical integer;
  v_vals    integer[];
  v_offsets numeric[] := ARRAY[0.4, 0.6, -0.1, -0.2, 0.3];  -- work rate, attitude, technical, physical, coachability
  v_left    integer;
  v_i       integer;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_coach)::text, true);

  -- Trainings, Tuesdays and Thursdays. The register stores only who was present.
  FOR t IN
    SELECT g.day::date AS day, row_number() OVER (ORDER BY g.day)::integer AS i, count(*) OVER ()::integer AS total
    FROM generate_series(v_from, v_to, interval '1 day') AS g(day)
    WHERE extract(isodow FROM g.day) IN (2, 4)
  LOOP
    v_session := pg_temp.sv(10, t.i);
    INSERT INTO public.coach_sessions (id, coach_user_id, title, session_type, training_type, session_date, squad, created_at)
    VALUES (v_session, v_coach, 'U10 training · ' || v_types[1 + (t.i % 6)], 'training', v_types[1 + (t.i % 6)],
            t.day, 'U10', (t.day + time '18:45') AT TIME ZONE 'Asia/Dubai')
    ON CONFLICT (id) DO NOTHING;
    FOR c IN SELECT * FROM demo_squad WHERE consented ORDER BY no LOOP
      -- The last eight follow the mockup; before that roughly one miss in eleven.
      v_present := CASE
        WHEN t.i > t.total - 8 THEN substr(c.last8, t.i - (t.total - 8), 1) = '1'
        ELSE (c.no * 5 + t.i * 3) % 11 <> 0
      END;
      IF v_present THEN
        INSERT INTO public.session_attendance (id, session_id, squad_player_id, status, created_at)
        VALUES (pg_temp.sv(12, t.i * 100 + c.no), v_session, pg_temp.sv(5, c.no), 'present',
                (t.day + time '18:45') AT TIME ZONE 'Asia/Dubai')
        ON CONFLICT (id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  -- Matches, Saturdays, through log_match_for_player. A logged match can't be
  -- logged twice, so they are written once, all together.
  IF NOT v_matches_logged THEN
    FOR m IN
      SELECT dm.*, s.day
      FROM (SELECT g.day::date AS day, row_number() OVER (ORDER BY g.day)::integer AS n
            FROM generate_series(date '2026-07-25', date '2026-10-17', interval '7 days') AS g(day)
            WHERE g.day::date <> date '2026-08-15') s
      JOIN demo_matches dm ON dm.n = s.n
      ORDER BY s.n
    LOOP
      v_session := NULL;
      IF NOT m.quick_log THEN
        v_session := pg_temp.sv(11, m.n);
        INSERT INTO public.coach_sessions (id, coach_user_id, title, session_type, session_date, squad, competition, venue, notes, created_at)
        VALUES (v_session, v_coach, 'vs ' || m.opponent, 'match', m.day, 'U10', 'League', m.venue,
                m.us || '-' || m.them, (m.day + time '11:30') AT TIME ZONE 'Asia/Dubai')
        ON CONFLICT (id) DO NOTHING;
        INSERT INTO public.session_attendance (id, session_id, squad_player_id, status, created_at)
        SELECT pg_temp.sv(13, m.n * 100 + s.no), v_session, pg_temp.sv(5, s.no), 'present',
               (m.day + time '11:30') AT TIME ZONE 'Asia/Dubai'
        FROM demo_squad s WHERE s.consented AND NOT (m.n = ANY (s.absent))
        ON CONFLICT (id) DO NOTHING;
      END IF;
      FOR c IN SELECT * FROM demo_squad WHERE consented AND NOT (m.n = ANY (absent)) ORDER BY no LOOP
        v_goals := COALESCE((m.goals ->> c.no::text)::integer, 0);
        v_assists := COALESCE((m.assists ->> c.no::text)::integer, 0);
        -- About pct% of a 50-minute U10 match, give or take four minutes.
        v_minutes := CASE WHEN m.quick_log THEN NULL
          ELSE least(50, greatest(5, round(50 * c.pct / 100.0 + ((c.no * 7 + m.n * 3) % 9) - 4)::integer)) END;
        PERFORM public.log_match_for_player(
          p_user_id => pg_temp.sv(3, c.no), p_opponent => m.opponent,
          p_team_score => m.us, p_opponent_score => m.them,
          p_competition => 'League', p_venue => m.venue, p_position => c.position, p_age_group => 'U10',
          p_minutes_played => v_minutes, p_goals => v_goals, p_assists => v_assists,
          p_card_received => 'None', p_body_condition => NULL, p_self_rating => NULL,
          p_computed_rating => least(10, round(6 + v_goals * 0.6 + v_assists * 0.3 + sign(m.us - m.them)::numeric * 0.5, 1)),
          p_match_date => m.day, p_session_id => v_session);
      END LOOP;
    END LOOP;
  END IF;

  -- Assessments: each child every `cadence` days, at the next training they
  -- attended (the app assesses against a session they were present at). Every
  -- one before the latest sits in band_from, the latest in band_to (a small
  -- wobble inside the band).
  FOR c IN SELECT * FROM demo_squad WHERE consented ORDER BY no LOOP
    v_dates := '{}';
    v_last := NULL;
    FOR d IN
      SELECT s.session_date AS day, s.id
      FROM public.coach_sessions s
      JOIN public.session_attendance a ON a.session_id = s.id
      WHERE s.coach_user_id = v_coach AND s.session_type = 'training'
        AND a.squad_player_id = pg_temp.sv(5, c.no) AND a.status = 'present'
      ORDER BY s.session_date
    LOOP
      IF v_last IS NULL OR d.day >= v_last + c.cadence THEN
        v_dates := v_dates || d.day;
        v_last := d.day;
      END IF;
    END LOOP;
    INSERT INTO demo_assessment_plan (no, k, day, target)
    SELECT c.no, k, v_dates[k],
           CASE WHEN k = array_length(v_dates, 1) THEN c.band_to ELSE c.band_from END + (((k * 7 + c.no) % 5) - 2) * 0.1
    FROM generate_series(1, coalesce(array_length(v_dates, 1), 0)) AS k;
  END LOOP;

  -- Tactical is the squad's weak spot: the same for everyone, dropping about
  -- 0.1 a week, so the Attributes heatmap's six weeks fall every week from
  -- about 5.6 (week of 14 Sep) to about 5.1 (this week). Sami sits well above and Rayan well below,
  -- cancelling out, so the latest values span 2 to 8. Each week's values are rounded
  -- together (running-sum rounding), so the week's mean keeps the drift
  -- instead of jumping with every whole-number rounding.
  UPDATE demo_assessment_plan p SET tactical = least(10, greatest(1, x.tactical))
  FROM (
    SELECT no, k, (round(run) - round(run - raw))::integer AS tactical
    FROM (
      SELECT p2.no, p2.k, r.raw,
             sum(r.raw) OVER (PARTITION BY date_trunc('week', p2.day)
                              ORDER BY CASE p2.no WHEN 8 THEN 0 WHEN 6 THEN 1 ELSE 2 END, p2.no) AS run
      FROM demo_assessment_plan p2
      JOIN demo_squad s ON s.no = p2.no
      CROSS JOIN LATERAL (SELECT 5.65 - 0.115 * (date_trunc('week', p2.day)::date - date '2026-09-14') / 7.0
                                 + s.tactical_bias AS raw) r
    ) w
  ) x
  WHERE p.no = x.no AND p.k = x.k;

  FOR c IN SELECT * FROM demo_squad WHERE consented ORDER BY no LOOP
    FOR d IN SELECT * FROM demo_assessment_plan WHERE no = c.no ORDER BY k LOOP
      v_k := d.k;
      v_tactical := d.tactical;
      -- The other five share what is left of the overall score, whole numbers.
      v_left := round(6 * d.target)::integer - v_tactical;
      v_vals := ARRAY(SELECT least(10, greatest(1, round(v_left / 5.0 + o.off)::integer))
                      FROM unnest(v_offsets) WITH ORDINALITY AS o(off, k) ORDER BY o.k);
      v_i := 0;
      WHILE (SELECT sum(x) FROM unnest(v_vals) x) <> v_left AND v_i < 100 LOOP
        IF (SELECT sum(x) FROM unnest(v_vals) x) < v_left AND v_vals[1 + v_i % 5] < 10 THEN
          v_vals[1 + v_i % 5] := v_vals[1 + v_i % 5] + 1;
        ELSIF (SELECT sum(x) FROM unnest(v_vals) x) > v_left AND v_vals[1 + v_i % 5] > 1 THEN
          v_vals[1 + v_i % 5] := v_vals[1 + v_i % 5] - 1;
        END IF;
        v_i := v_i + 1;
      END LOOP;

      INSERT INTO public.coach_assessments (
        id, coach_user_id, coach_name_snapshot, squad_player_id, session_id, appearance,
        work_rate, tactical, attitude, technical, physical, coachability,
        consistency, impact, workrate, technique, spirit, created_at, published_at
      )
      SELECT pg_temp.sv(20, c.no * 100 + v_k), v_coach, 'Rami A.', pg_temp.sv(5, c.no), s.id, 'training',
             v_vals[1], v_tactical, v_vals[2], v_vals[3], v_vals[4], v_vals[5],
             -- The card stats, as deriveCardStats (src/lib/cardStats.ts) makes them.
             v_vals[2], v_vals[3], v_vals[1], round((v_vals[3] + v_tactical) / 2.0), round((v_vals[2] + v_vals[5]) / 2.0),
             (d.day + time '19:00') AT TIME ZONE 'Asia/Dubai', (d.day + time '19:00') AT TIME ZONE 'Asia/Dubai'
      FROM public.coach_sessions s
      WHERE s.coach_user_id = v_coach AND s.session_type = 'training' AND s.session_date = d.day
      ON CONFLICT (id) DO NOTHING;
    END LOOP;
  END LOOP;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$coach$;

-- ── 4. What's next: two published events, the WhatsApp ticks, one absence ─
DO $upcoming$
DECLARE
  v_coach    uuid := pg_temp.sv(2, 2);
  v_training uuid := pg_temp.sv(30, 1);
  v_match    uuid := pg_temp.sv(30, 2);
  v_open     boolean;
  c          record;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_coach)::text, true);
  INSERT INTO public.coach_calendar_events (id, coach_user_id, title, event_type, starts_at, ends_at, event_date, start_time, end_time,
                                            venue, published, squad, training_themes)
  VALUES (v_training, v_coach, 'U10 training', 'training',
          '2026-10-22 17:00+04', '2026-10-22 18:30+04', '2026-10-22', '17:00', '18:30',
          'Rehearsal FC, pitch 2', true, 'U10', ARRAY['technical'])
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.coach_calendar_events (id, coach_user_id, title, event_type, starts_at, ends_at, event_date, start_time, end_time,
                                            venue, opponent, home_away, meet_time, published, squad)
  VALUES (v_match, v_coach, 'U10 vs Marina FC U10', 'match',
          '2026-10-24 09:30+04', '2026-10-24 10:30+04', '2026-10-24', '09:30', '10:30',
          'Rehearsal FC, pitch 1', 'Marina FC U10', 'home', '09:00', true, 'U10')
  ON CONFLICT (id) DO NOTHING;
  RESET ROLE;

  -- Stopping at kick-off is this seed's own choice, so a late rerun leaves
  -- these as they are: report_cant_make_it refuses from kick-off, while
  -- confirm_event_attendance allows until the end of the match's day. Once
  -- Leo's absence exists the step has run: a second report would only move
  -- its reported_at.
  SELECT now() < starts_at INTO v_open FROM public.coach_calendar_events WHERE id = v_match;
  v_open := v_open AND NOT EXISTS (SELECT 1 FROM public.event_absences
                                   WHERE event_id = v_match AND squad_player_id = pg_temp.sv(5, 5));
  IF v_open THEN
    -- The coach ticks the eight children the WhatsApp group said are coming.
    SET LOCAL ROLE authenticated;
    FOR c IN SELECT no FROM demo_squad WHERE no IN (1, 2, 4, 6, 7, 8, 9, 10) LOOP
      PERFORM public.confirm_event_attendance(v_match, pg_temp.sv(5, c.no));
    END LOOP;
    -- Leo's guardian says he can't make it, in the app.
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.sv(4, 5))::text, true);
    PERFORM public.report_cant_make_it(v_match, pg_temp.sv(3, 5), 'Away that weekend');
    RESET ROLE;
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);
END;
$upcoming$;

COMMIT;
