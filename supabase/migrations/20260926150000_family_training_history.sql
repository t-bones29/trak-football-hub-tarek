-- ============================================================
-- TRAK-76 (J6): the child and that child's linked parent see the training the
-- coach logged. J6: "Player and parent see the match and training history the
-- coach logged."
--
-- What a family may see (Kostas, TRAK-6, 25 Sep): the date, that it was
-- training, the focus labels (coach_sessions.training_type, a fixed
-- vocabulary since 20260925160000), and attendance for their own child. Not
-- the coach's title or notes, nor anything derived from them: those are the
-- coach's diary (20260917000002). So this is one narrow function, and
-- coach_sessions itself gets no family read policy.
--
-- Who may call it for a child: the child, or a parent linked to them
-- (player_parent_links, the same link squad_player_is_my_child() uses).
-- Anyone else is refused 'not_family'. An under-18 without active parental
-- consent is refused 'consent_required' (player_consent_required(), the same
-- rule that gates the child's published messages), so a read after a
-- withdrawal is refused too. The two messages differ so a screen can tell
-- "waiting for approval" from a failure.
-- ============================================================

CREATE OR REPLACE FUNCTION public.family_training_history(p_player_user_id uuid)
RETURNS TABLE (
  session_id   uuid,
  session_date date,
  focus        text[],
  attendance   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR p_player_user_id IS NULL OR NOT (
       p_player_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.player_parent_links l
               WHERE l.player_user_id = p_player_user_id
                 AND l.parent_user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not_family' USING ERRCODE = '42501';
  END IF;

  IF public.player_consent_required(p_player_user_id) THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '42501';
  END IF;

  -- A training this child was recorded at, by the coach whose squad row it is.
  RETURN QUERY
  SELECT s.id,
         s.session_date,
         CASE WHEN s.training_type IS NULL THEN NULL
              ELSE string_to_array(s.training_type, ',') END,
         a.status::text
  FROM public.squad_players sp
  JOIN public.session_attendance a ON a.squad_player_id = sp.id
  JOIN public.coach_sessions s     ON s.id = a.session_id
                                  AND s.coach_user_id = sp.coach_user_id
  WHERE sp.linked_player_id = p_player_user_id
    AND s.session_type = 'training'
  ORDER BY s.session_date DESC, s.id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.family_training_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.family_training_history(uuid) TO authenticated;

COMMENT ON FUNCTION public.family_training_history(uuid) IS
  'TRAK-76 (J6). The trainings a child was recorded at: date, focus labels (training_type) and that child''s attendance. For the child or a linked parent; consent-gated under 18. Never title or notes.';
