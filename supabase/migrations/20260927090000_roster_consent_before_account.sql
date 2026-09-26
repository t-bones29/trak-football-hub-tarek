-- ============================================================
-- TRAK-11 phase 1 (J2/J3): a guardian consents for a rostered child before
-- the child has an account. Spec:
-- docs/superpowers/specs/2026-09-25-consent-first-admission-design.md.
--
-- Consent belonged to the child's account (player_user_id NOT NULL), so a
-- guardian could not consent for a child the academy rostered but who had not
-- signed up. A consent may now name the roster place instead, and it becomes
-- the account's consent the moment the child claims that place at signup.
--
-- Two choices differ from the spec's wording, not its intent:
-- - Account-less children are listed by a new get_roster_children_awaiting_consent(),
--   not added to get_children_awaiting_consent(). The parent screen's parser
--   (src/lib/parent-consent.ts) rejects the whole response if any row lacks a
--   player_user_id, so extending that function would break the screen for
--   every guardian with a rostered child until phase 4 ships.
-- - The carry-over is a trigger on the roster claim, not an edit to
--   provision_my_profile(). Signup claims the roster place in one UPDATE, the
--   trigger runs in that same transaction, and any other path that claims a
--   place carries consent too.
--
-- Existing accounts and their consent rows are untouched.
-- ============================================================

-- ── 1. A consent may name a roster place ─────────────────────
-- A plain uuid, like player_user_id and parent_user_id: consent is evidence
-- and outlives the rows it names. roster_children cascades from squad_players
-- and organizations, so a foreign key would silently delete consent records.
-- What happens to consent evidence on erasure is for counsel (TRAK-22).
ALTER TABLE public.parental_consents
  ADD COLUMN roster_child_id uuid,
  ALTER COLUMN player_user_id DROP NOT NULL,
  ADD CONSTRAINT parental_consents_names_a_child
    CHECK (player_user_id IS NOT NULL OR roster_child_id IS NOT NULL);

-- Mirrors parental_consents_player_idx (there is no uniqueness rule to mirror:
-- record_parental_consent closes standing consents instead).
CREATE INDEX parental_consents_roster_child_idx
  ON public.parental_consents (roster_child_id) WHERE withdrawn_at IS NULL;

COMMENT ON COLUMN public.parental_consents.roster_child_id IS
  'TRAK-11: the roster place a guardian consented for before the child had an account. No foreign key: consent outlives the roster row.';


-- ── 2. Which account-less children are waiting for me ────────
-- First name and age only: a guardian is matched by the address the academy
-- supplied, so show no more than the approval needs.
CREATE OR REPLACE FUNCTION public.get_roster_children_awaiting_consent()
RETURNS TABLE (roster_child_id uuid, first_name text, age_years int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' SET TimeZone = 'UTC'
AS $fn$
  SELECT rc.id,
         split_part(btrim(sp.player_name), ' ', 1),
         date_part('year', age(current_date, rc.date_of_birth))::int
  FROM public.roster_guardians rg
  JOIN public.roster_children rc ON rc.id = rg.roster_child_id
  JOIN public.squad_players sp   ON sp.id = rc.squad_player_id
  WHERE rg.parent_user_id = auth.uid()
    AND rc.player_user_id IS NULL
    AND date_part('year', age(current_date, rc.date_of_birth)) < public.consent_threshold_age()
    AND NOT EXISTS (
      SELECT 1 FROM public.parental_consents c
      WHERE c.roster_child_id = rc.id
        AND c.withdrawn_at IS NULL
        AND c.superseded_by IS NULL
        AND c.purposes->'coaching_records' = 'true'::jsonb
    )
  ORDER BY 2, 1;
$fn$;


-- ── 3. Granting ──────────────────────────────────────────────
-- record_parental_consent's rules, keyed on the roster place. The caller must
-- be a guardian who claimed this child's roster row with a confirmed email
-- (provision_my_profile), which is what 'email_confirmed' records.
CREATE OR REPLACE FUNCTION public.record_roster_consent(
  p_roster_child_id uuid,
  p_relationship    text,
  p_purposes        jsonb,
  p_notice_version  text,
  p_consent_text    text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '' SET TimeZone = 'UTC'
AS $fn$
DECLARE
  v_parent uuid := auth.uid();
  v_child  public.roster_children%ROWTYPE;
  v_age    int;
  v_new    uuid;
BEGIN
  -- FOR UPDATE waits for a signup claiming this place, so a consent can't be
  -- written after the carry-over already ran and be left behind.
  SELECT rc.* INTO v_child
  FROM public.roster_children rc
  WHERE rc.id = p_roster_child_id
    AND EXISTS (SELECT 1 FROM public.roster_guardians rg
                WHERE rg.roster_child_id = rc.id AND rg.parent_user_id = v_parent)
  FOR UPDATE;
  IF v_parent IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'You are not this child''s guardian on the academy roster' USING ERRCODE = '42501';
  END IF;

  IF v_child.player_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This child already has an account; approve them from your family list' USING ERRCODE = '42501';
  END IF;

  v_age := date_part('year', age(current_date, v_child.date_of_birth))::int;
  IF v_age >= public.consent_threshold_age() THEN
    RAISE EXCEPTION 'No guardian consent is needed at this age' USING ERRCODE = '22023';
  END IF;

  IF p_relationship IS NULL OR p_relationship NOT IN ('parent', 'legal_guardian') THEN
    RAISE EXCEPTION 'Relationship must be parent or legal_guardian';
  END IF;

  IF p_purposes IS NULL OR jsonb_typeof(p_purposes) <> 'object' THEN
    RAISE EXCEPTION 'Purposes must be an object of individual choices';
  END IF;

  IF p_purposes->'coaching_records' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Consent must grant coaching_records; to decline, do not record a consent';
  END IF;

  IF COALESCE(btrim(p_notice_version), '') = '' OR COALESCE(btrim(p_consent_text), '') = '' THEN
    RAISE EXCEPTION 'Notice version and consent wording must both be recorded';
  END IF;

  -- The roster names the guardian; the guardian confirms how they are related.
  UPDATE public.roster_guardians SET relationship = p_relationship
  WHERE roster_child_id = v_child.id AND parent_user_id = v_parent;

  -- Close any standing consent rather than editing it (record_parental_consent's rule).
  UPDATE public.parental_consents SET withdrawn_at = now()
  WHERE roster_child_id = v_child.id AND withdrawn_at IS NULL AND superseded_by IS NULL;

  INSERT INTO public.parental_consents (
    roster_child_id, parent_user_id, relationship_declared, verification_method,
    purposes, notice_version, consent_text, threshold_age, player_age_at_consent
  ) VALUES (
    v_child.id, v_parent, p_relationship, 'email_confirmed',
    p_purposes, btrim(p_notice_version), btrim(p_consent_text),
    public.consent_threshold_age(), v_age
  )
  RETURNING id INTO v_new;

  UPDATE public.parental_consents SET superseded_by = v_new
  WHERE roster_child_id = v_child.id AND id <> v_new
    AND superseded_by IS NULL AND withdrawn_at IS NOT NULL;

  RETURN v_new;
END;
$fn$;


-- ── 4. Withdrawal before the child has an account ────────────
-- Closes the caller's consent; deletes nothing. After carry-over,
-- withdraw_parental_consent(player_user_id) applies as before.
CREATE OR REPLACE FUNCTION public.withdraw_roster_consent(p_roster_child_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_parent uuid := auth.uid();
  v_count  int;
BEGIN
  IF v_parent IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.roster_guardians rg
    WHERE rg.roster_child_id = p_roster_child_id AND rg.parent_user_id = v_parent
  ) THEN
    RAISE EXCEPTION 'You are not this child''s guardian on the academy roster' USING ERRCODE = '42501';
  END IF;

  UPDATE public.parental_consents SET withdrawn_at = now()
  WHERE roster_child_id = p_roster_child_id AND parent_user_id = v_parent AND withdrawn_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;


-- ── 5. The consent follows the child to their account ────────
-- Withdrawn or superseded rows move too, so the account's history is whole
-- and a withdrawal made before signup still counts after it.
CREATE OR REPLACE FUNCTION public.roster_consent_follows_claim()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  UPDATE public.parental_consents SET player_user_id = NEW.player_user_id
  WHERE roster_child_id = NEW.id AND player_user_id IS NULL;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER roster_children_consent_follows_claim
  AFTER UPDATE OF player_user_id ON public.roster_children
  FOR EACH ROW WHEN (OLD.player_user_id IS NULL AND NEW.player_user_id IS NOT NULL)
  EXECUTE FUNCTION public.roster_consent_follows_claim();


-- ── 6. Grants ────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_roster_children_awaiting_consent() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_roster_consent(uuid, text, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.withdraw_roster_consent(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.roster_consent_follows_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_roster_children_awaiting_consent() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_roster_consent(uuid, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_roster_consent(uuid) TO authenticated;
