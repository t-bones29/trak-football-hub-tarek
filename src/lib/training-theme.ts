import { ALL_DRILLS_PATH, DRILLS_PATH, allDrillsPath } from '@/lib/training/library/paths'

// A training's themes: any of the Coaching Session Catalogue's seven libraries,
// picked on New event so the coach can find sessions for them in the catalogue.
// TRAK-635 (Kostas, 28 Nov): none, one or several; tapping a picked one unpicks it.
//
// coach_calendar_events.training_themes stores the keys, on trainings only. The
// database enforces the same keys (coach_calendar_events_training_themes_known);
// change both together. `library` is the catalogue's own name, which its
// ?lib= link selects; the counts are the catalogue's, and a test keeps them so.
export const TRAINING_THEMES = [
  { key: 'technical',     label: 'Technical',              library: 'Technical',                             sessions: 82, topics: 4 },
  { key: 'attacking',     label: 'Attacking',              library: 'Tactical – Attacking',                  sessions: 22, topics: 2 },
  { key: 'defending',     label: 'Defending',              library: 'Tactical – Defending',                  sessions: 53, topics: 3 },
  { key: 'transition',    label: 'Transition',             library: 'Tactical – Transition',                 sessions: 5,  topics: 1 },
  { key: 'goalkeeping',   label: 'Goalkeeping',            library: 'Goalkeeping',                           sessions: 16, topics: 1 },
  { key: 'physical',      label: 'Physical & movement',    library: 'Physical & movement (Play Phase 4–6)',  sessions: 15, topics: 1 },
  { key: 'psychological', label: 'Psychological & social', library: 'Psychological & social',                sessions: 3,  topics: 1 },
] as const

export type TrainingTheme = (typeof TRAINING_THEMES)[number]['key']

/** A stored value back as a theme key, or '' for none or anything unknown. */
export function trainingThemeFrom(value: string | null | undefined): TrainingTheme | '' {
  return TRAINING_THEMES.find(t => t.key === value)?.key ?? ''
}

/** Stored values back as theme keys: known ones only, each once, in the order the seven are listed. */
export function trainingThemesFrom(values: readonly (string | null)[] | null | undefined): TrainingTheme[] {
  const picked = new Set(values ?? [])
  return TRAINING_THEMES.filter(t => picked.has(t.key)).map(t => t.key)
}

/** The coach's Library, opened on a theme's library when there is one (TRAK-264: a theme's key is its library's address). */
export function catalogueLink(theme: TrainingTheme | '' | null | undefined): string {
  return TRAINING_THEMES.some(t => t.key === theme) ? `/coach/trainings/${theme}` : '/coach/trainings'
}

/* TRAK-419 (11 Nov review): where Training is on, Drills is the one library, so a theme's link opens Training › Drills,
   filtered as near to the theme as Drills can: Technical and Goalkeeping are filters of All drills; Attacking,
   Defending and Transition are searches (the address keeps them, so Back returns to them). Drills has no physical or
   psychological filter, so those, and no theme, open plain Drills. */
const THEME_DRILLS: Partial<Record<TrainingTheme, string>> = {
  technical: allDrillsPath('Technical'),
  goalkeeping: allDrillsPath('Goalkeeping'),
  attacking: `${ALL_DRILLS_PATH}?q=attack`,
  defending: `${ALL_DRILLS_PATH}?q=defend`,
  transition: `${ALL_DRILLS_PATH}?q=transition`,
}

/** Training › Drills, opened on a theme's drills where Drills can show them. */
export function drillsLink(theme: string | null | undefined): string {
  return THEME_DRILLS[trainingThemeFrom(theme) as TrainingTheme] ?? DRILLS_PATH
}
