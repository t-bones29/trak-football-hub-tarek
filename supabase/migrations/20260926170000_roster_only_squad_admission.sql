-- TRAK-48 slice 4 (J1, spec approved by Imad 26 Sep): the roster is the only
-- way into a squad. MVP Requirements J1: "No joining by name or coach code";
-- UC-C02 v2: coaches do not add players, the academy roster decides the squad.
--
-- Two doors were still open after slice 3 (#144), reproduced in
-- roster_signup_admission.sql section 7 (5 checks red on main):
--   1. link_player_to_coach(p_code) let any signed-in player (an existing
--      account, or a rostered child) attach themselves to a coach's squad with
--      the coach's personal code; get_coach_id_by_invite_code looked codes up.
--      Code linking is parked (TRAK-19; UC-A08, UC-C07 are parked).
--   2. "Coaches can insert squad players" let a coach create squad rows
--      directly, the backend half of UC-C02 (#134 removed the screen).
--
-- After this, admit_roster_child (SECURITY DEFINER, service_role only) is the
-- only way a squad row is created. Existing rows and links are untouched, and
-- coaches keep editing their own rows (UPDATE is unchanged).

REVOKE ALL ON FUNCTION public.link_player_to_coach(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_coach_id_by_invite_code(text) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Coaches can insert squad players" ON public.squad_players;
REVOKE INSERT ON TABLE public.squad_players FROM PUBLIC, anon, authenticated;

-- 3. The side door (reproduced: section 7's payload check). provision_my_profile
-- called link_player_to_coach itself, as its owner, when a player's payload
-- carried coach_invite_code, so an existing player account could re-run signup
-- and join any coach's squad by code. This is 20260926080000's body (#150)
-- with that block removed; nothing else changes.
CREATE OR REPLACE FUNCTION public.provision_my_profile(p jsonb)
RETURNS jsonb  -- { "warnings": ["..."] }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid           uuid := auth.uid();
  v_email         text;
  v_role          text := p->>'role';
  v_existing_role text;
  v_org           uuid;
  v_academy_code  text;
  v_warnings      jsonb := '[]'::jsonb;
  v_confirmed     boolean;
  v_roster        public.roster_children%ROWTYPE;
  v_academy_name  text;
  v_age_group     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('player', 'coach', 'parent', 'club') THEN
    RAISE EXCEPTION 'Invalid role';
  END IF;
  IF COALESCE(trim(p->>'full_name'), '') = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  -- Roster emails are stored lower(btrim()); compare the same way.
  SELECT lower(btrim(email)), email_confirmed_at IS NOT NULL INTO v_email, v_confirmed
  FROM auth.users WHERE id = v_uid;

  -- Never allow switching an existing profile to a different role
  SELECT role::text INTO v_existing_role FROM public.profiles WHERE user_id = v_uid;
  IF v_existing_role IS NOT NULL AND v_existing_role <> v_role THEN
    RAISE EXCEPTION 'Profile already exists with a different role';
  END IF;

  -- ── Admission (TRAK-48 slice 3, J1) ───────────────────────
  -- Only a NEW player or parent profile is checked; accounts that already
  -- exist keep working. Staff (coach, club) are out of scope (#74).
  IF v_existing_role IS NULL AND v_role = 'player' THEN
    SELECT rc.* INTO v_roster
    FROM public.roster_children rc
    WHERE v_confirmed AND rc.child_email = v_email
      AND (rc.player_user_id IS NULL OR rc.player_user_id = v_uid)
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Your academy hasn''t added this email yet' USING ERRCODE = '42501';
    END IF;
    SELECT o.name INTO v_academy_name FROM public.organizations o WHERE o.id = v_roster.organization_id;
    SELECT sp.age_group INTO v_age_group FROM public.squad_players sp WHERE sp.id = v_roster.squad_player_id;
  ELSIF v_existing_role IS NULL AND v_role = 'parent' THEN
    IF NOT (v_confirmed AND EXISTS (SELECT 1 FROM public.roster_guardians rg WHERE rg.email = v_email)) THEN
      RAISE EXCEPTION 'Your academy hasn''t added this email yet' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ── Profile ────────────────────────────────────────────────
  INSERT INTO public.profiles (user_id, role, full_name, nationality)
  VALUES (v_uid, v_role::public.user_role, trim(p->>'full_name'), NULLIF(trim(COALESCE(p->>'nationality', '')), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET full_name   = EXCLUDED.full_name,
        nationality = COALESCE(EXCLUDED.nationality, profiles.nationality);

  -- ── Player ─────────────────────────────────────────────────
  IF v_role = 'player' AND (p ? 'player_details' OR v_roster.id IS NOT NULL) THEN
    -- A rostered child: the roster's date of birth, academy and age group win
    -- over anything typed (J1, TRAK-54).
    INSERT INTO public.player_details
      (user_id, date_of_birth, position, current_club, age_group, shirt_number)
    VALUES (
      v_uid,
      COALESCE(v_roster.date_of_birth, NULLIF(p#>>'{player_details,date_of_birth}', '')::date),
      NULLIF(p#>>'{player_details,position}', ''),
      COALESCE(v_academy_name, NULLIF(p#>>'{player_details,current_club}', '')),
      COALESCE(v_age_group, NULLIF(p#>>'{player_details,age_group}', '')),
      NULLIF(p#>>'{player_details,shirt_number}', '')::int
    )
    ON CONFLICT (user_id) DO UPDATE
      SET date_of_birth = COALESCE(EXCLUDED.date_of_birth, player_details.date_of_birth),
          position      = COALESCE(EXCLUDED.position, player_details.position),
          current_club  = COALESCE(EXCLUDED.current_club, player_details.current_club),
          age_group     = COALESCE(EXCLUDED.age_group, player_details.age_group),
          shirt_number  = COALESCE(EXCLUDED.shirt_number, player_details.shirt_number);

    -- Parent invite. A rostered child's guardians are the academy's (G2,
    -- TRAK-18): an address the roster doesn't name for them is ignored, so it
    -- neither becomes an invitation nor fails their signup. A pre-roster
    -- account keeps today's path.
    IF COALESCE(trim(p->>'parent_email'), '') <> '' AND (v_roster.id IS NULL OR EXISTS (
      SELECT 1 FROM public.roster_guardians rg
      WHERE rg.roster_child_id = v_roster.id AND rg.email = lower(btrim(p->>'parent_email'))
    )) THEN
      PERFORM public.create_parent_invite(p->>'parent_email');
    END IF;

    -- A rostered child claims their roster place and squad row, and is linked
    -- to any guardian who signed up first.
    IF v_roster.id IS NOT NULL THEN
      UPDATE public.roster_children SET player_user_id = v_uid WHERE id = v_roster.id;
      UPDATE public.squad_players SET linked_player_id = v_uid
      WHERE id = v_roster.squad_player_id AND (linked_player_id IS NULL OR linked_player_id = v_uid);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'This roster place is linked to another account. Ask your academy.' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
      SELECT v_uid, rg.parent_user_id FROM public.roster_guardians rg
      WHERE rg.roster_child_id = v_roster.id AND rg.parent_user_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    END IF;

    -- A player joins a squad only through the roster (TRAK-48 slice 4). A
    -- coach_invite_code in the payload is ignored: no linking by code.
  END IF;

  -- ── Coach ──────────────────────────────────────────────────
  IF v_role = 'coach' THEN
    -- Academy code lookup (non-fatal)
    v_org := NULL;
    v_academy_code := COALESCE(trim(p#>>'{coach_details,academy_code}'), '');
    IF v_academy_code <> '' THEN
      SELECT id INTO v_org
      FROM public.organizations
      WHERE upper(join_code) = upper(regexp_replace(v_academy_code, '^TRK-', '', 'i'));
      IF v_org IS NULL THEN
        v_warnings := v_warnings || to_jsonb(
          'Academy code "' || v_academy_code || '" was not recognised — you can join your academy later from your profile.'
        );
      END IF;
    END IF;

    INSERT INTO public.coach_details (user_id, current_club, team, coach_role, organization_id)
    VALUES (
      v_uid,
      NULLIF(p#>>'{coach_details,current_club}', ''),
      NULLIF(p#>>'{coach_details,team}', ''),
      NULLIF(p#>>'{coach_details,coach_role}', ''),
      v_org
    )
    ON CONFLICT (user_id) DO UPDATE
      SET current_club    = COALESCE(EXCLUDED.current_club, coach_details.current_club),
          team            = COALESCE(EXCLUDED.team, coach_details.team),
          coach_role      = COALESCE(EXCLUDED.coach_role, coach_details.coach_role),
          organization_id = COALESCE(EXCLUDED.organization_id, coach_details.organization_id);

    -- Invite code for players to link with
    UPDATE public.profiles
    SET invite_code = public.generate_unique_code('profile')
    WHERE user_id = v_uid AND invite_code IS NULL;
  END IF;

  -- ── Club admin ─────────────────────────────────────────────
  IF v_role = 'club' THEN
    IF COALESCE(trim(p#>>'{club_details,academy_name}'), '') = '' THEN
      RAISE EXCEPTION 'Academy name is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE admin_user_id = v_uid) THEN
      INSERT INTO public.organizations (admin_user_id, name, join_code)
      VALUES (v_uid, trim(p#>>'{club_details,academy_name}'), public.generate_unique_code('org'));
    END IF;
  END IF;

  -- ── Parent ─────────────────────────────────────────────────
  IF v_role = 'parent' AND v_email IS NOT NULL THEN
    -- Claim every guardian row with this email, and link the children who
    -- have already signed up (siblings included). Children who sign up later
    -- are linked from their side.
    UPDATE public.roster_guardians SET parent_user_id = v_uid
    WHERE email = v_email AND v_confirmed AND (parent_user_id IS NULL OR parent_user_id = v_uid);
    INSERT INTO public.player_parent_links (player_user_id, parent_user_id)
    SELECT rc.player_user_id, v_uid
    FROM public.roster_guardians rg JOIN public.roster_children rc ON rc.id = rg.roster_child_id
    WHERE rg.email = v_email AND rg.parent_user_id = v_uid AND rc.player_user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
    PERFORM public.link_parent_to_players_by_email(v_email);
  END IF;

  RETURN jsonb_build_object('warnings', v_warnings);
END;
$fn$;

REVOKE ALL ON FUNCTION public.provision_my_profile(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_my_profile(jsonb) TO authenticated;

-- Post-condition: no app role can create a squad row by any route this
-- migration knows of, and the operator's route is still there.
DO $migration$
BEGIN
  IF has_table_privilege('authenticated', 'public.squad_players', 'INSERT')
     OR has_function_privilege('authenticated', 'public.link_player_to_coach(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_coach_id_by_invite_code(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TRAK-48 slice 4: an app role can still create or join a squad row outside the roster';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'squad_players' AND cmd IN ('INSERT', 'ALL')) THEN
    RAISE EXCEPTION 'TRAK-48 slice 4: squad_players still has an INSERT policy';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.admit_roster_child(uuid, uuid, text, text, date, text, text[], text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TRAK-48 slice 4: the operator can no longer admit roster children';
  END IF;
END;
$migration$;
