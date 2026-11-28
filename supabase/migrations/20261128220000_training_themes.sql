-- TRAK-635 (Kostas, 28 Nov): a training can have several themes, not one at most. Tapping a picked theme on New
-- event unpicks it, so none, one or all seven can be picked.
--
-- training_theme (one key or NULL, 20261019120000) becomes training_themes, a list of the same seven keys. Each
-- training keeps the theme it had. Still coach-only: child_events() never returned it, and no function reads it.
-- The app's keys live in src/lib/training-theme.ts; change both together.

-- A CHECK can't hold a subquery, so "each key once" is a small function.
CREATE FUNCTION trak_private.no_repeats(p_values text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT cardinality(p_values) = (SELECT count(DISTINCT v) FROM unnest(p_values) AS v);
$fn$;
REVOKE ALL ON FUNCTION trak_private.no_repeats(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION trak_private.no_repeats(text[]) TO authenticated, service_role;

ALTER TABLE public.coach_calendar_events
  ADD COLUMN training_themes text[] NOT NULL DEFAULT '{}';

UPDATE public.coach_calendar_events
  SET training_themes = ARRAY[training_theme]
  WHERE training_theme IS NOT NULL;

ALTER TABLE public.coach_calendar_events
  DROP CONSTRAINT coach_calendar_events_training_theme_training_only,
  DROP CONSTRAINT coach_calendar_events_training_theme_known,
  DROP COLUMN training_theme,
  -- Only the seven keys, each once, so a misspelt key fails loudly.
  ADD CONSTRAINT coach_calendar_events_training_themes_known CHECK (
    training_themes <@ ARRAY['technical', 'attacking', 'defending', 'transition', 'goalkeeping', 'physical', 'psychological']
    AND trak_private.no_repeats(training_themes)),
  ADD CONSTRAINT coach_calendar_events_training_themes_training_only
    CHECK (cardinality(training_themes) = 0 OR event_type = 'training');

COMMENT ON COLUMN public.coach_calendar_events.training_themes IS
  'TRAK-635: the training''s themes, any of technical, attacking, defending, transition, goalkeeping, physical, psychological (each once). Empty for none. Trainings only; coach-only, not in child_events().';
