-- TRAK-634. Imad, 28 Nov: announcements is part of Trak for every academy, after a coach → player live check on Trak
-- Test Academy (passed 28 Nov). Until now 'announcements' was one academy_features row an operator added by hand (on
-- 28 Nov: Trak Test Academy only), so coaches of every other academy had no Post announcement.
--
-- The trigger that gives a new academy its switches (20261128200000) now gives it announcements too, and every existing
-- academy is switched on once here. Deleting the row still turns announcements off for that academy with no deploy.

CREATE OR REPLACE FUNCTION public.new_academy_starts_with_events_on()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.academy_features(organization_id, feature)
  SELECT NEW.id, f FROM unnest(ARRAY['events', 'games', 'training', 'family_look', 'season_plan', 'tasks', 'announcements']) f
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

INSERT INTO public.academy_features(organization_id, feature)
SELECT o.id, 'announcements' FROM public.organizations o
ON CONFLICT DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations o
    WHERE NOT EXISTS (SELECT 1 FROM public.academy_features a WHERE a.organization_id = o.id AND a.feature = 'announcements')) THEN
    RAISE EXCEPTION 'An academy is still without announcements after the switch-on';
  END IF;
END $$;
