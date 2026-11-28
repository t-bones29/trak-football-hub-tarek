/*
 * TRAK-127 (J8.4): the coach's event form, and the one place that knows how it
 * maps onto coach_calendar_events. The schedule screen and its tests only go
 * through these helpers, so a column rename lands here and nowhere else.
 *
 * Columns from J8.2 (TRAK-125): meet_time, kit, home_away, status and
 * cancel_reason. The sequence number goes up in the database on every change;
 * the app never writes it.
 */
import { calendarFields, displayEventTime, toAcademyInstant, toInstant } from '@/lib/event-time'
import { describeEventKit, readKitSnapshot, type EventKitSnapshot } from '@/lib/kit-templates'
import { trainingThemesFrom, type TrainingTheme } from '@/lib/training-theme'
import { currentLanguage, i18n } from '@/lib/i18n'
import { splitVenue } from '@/lib/venue-link'

export type EventKind = 'training' | 'match' | 'other'
export const EVENT_KINDS: EventKind[] = ['training', 'match', 'other']

/* TRAK-159: one colour per type, everywhere events show (the coach calendar,
   the Home strip, the family lists). Founders, 12 Oct, replacing 11 Oct's
   match red: training blue, match green, other orange, cancelled red.
   Light theme (TRAK-189): dark enough for a white page, and match moves to
   purple (Imad, 18 Oct), since a green match read as the brand's buttons. A
   blue-leaning purple, so it stays apart from training's blue with
   deuteranopia; tournament, purple before, moves to teal.
   TRAK-231 (20 Oct live run): match magenta, training teal, other green,
   cancelled a brighter red with a hollow dot; tournament takes the blue. The
   green is the lightest that still reads as text on the light screens (4.5:1)
   and stays apart from the brand's forest green (event-colours-distinct).
   TRAK-271 (Tarek, 23 Oct): the permanent colours. Training and other were too
   alike, so training is cyan and other a bright green; match pink-magenta,
   cancelled red. They are bright (training, other about 1.5:1 on white), so
   they are marks only (dots, bars, rings, a chip's edge), never text: a type
   word stays dark beside its dot, "Cancelled" uses the danger token
   (event-colours-distinct checks it).
   TRAK-275 (Tarek, 23 Oct, later): replaced by one family of the same strength
   (15 and C2): training green, match purple, other teal, cancelled red. Still
   marks only. Tournament keeps its blue. */
export const EVENT_COLOR: Record<EventKind | 'tournament', string> = {
  training:   '#6EC215',
  match:      '#6915C2',
  other:      '#15C2BF',
  tournament: '#3B5BBD',
}
export const CANCELLED_COLOR = '#C21517'
/** "No time set" on a card: a warning, unlike every type colour. */
export const NO_TIME_COLOR = '#875100'
export const DURATIONS = [60, 75, 90, 120] as const
/** The family note fits one line on a phone; the database holds the same limit. */
export const FAMILY_NOTE_MAX = 200

export type EventForm = {
  kind: EventKind
  title: string
  date: string       // YYYY-MM-DD
  time: string       // HH:MM kickoff or start, '' while unknown
  duration: number   // minutes
  venue: string
  meetTime: string   // HH:MM, '' when it's the same as the start
  opponent: string
  homeAway: '' | 'home' | 'away'
  kit: string
  kitSnapshot?: EventKitSnapshot | null
  /** TRAK-161: what families read under Kit; '' for none. Not the coach-only notes. */
  familyNote: string
  /** TRAK-635: a training's catalogue themes, none, one or several. Coach-only. */
  themes: TrainingTheme[]
  /** Imad, 24 Oct: a new event's squad, chosen in the form; null is the whole roster, undefined the squad last picked. */
  squad?: string | null
  /** TRAK-288: a match's competition, asked in New event where Games is on (Imad, 28 Oct); '' when not asked. */
  competition: Competition | ''
}

export type Competition = 'league' | 'tournament' | 'friendly'
export const COMPETITIONS: { value: Competition; label: string }[] = [
  { value: 'league', label: 'League' }, { value: 'tournament', label: 'Tournament' }, { value: 'friendly', label: 'Friendly' },
]
/** TRAK-438: the one list of competition words, as a match's row stores them (publish saves initcap: "Tournament").
 *  The player's chips and the old match log use it too, so no screen says "Cup" any more. */
export const COMPETITION_LABELS = COMPETITIONS.map(c => c.label) as readonly string[]
/** A match logged before TRAK-438 could say "Cup" (none live on 13 Nov); it counts as a tournament. */
export const competitionLabel = (stored: string | null | undefined) => stored === 'Cup' ? 'Tournament' : stored ?? ''

export type EventRow = {
  id: string
  /** TRAK-176: the squad it's for; null is the coach's whole roster. */
  squad?: string | null
  title: string
  event_type: string
  starts_at: string
  ends_at?: string | null
  event_date?: string | null
  start_time?: string | null
  end_time?: string | null
  venue?: string | null
  opponent?: string | null
  notes?: string | null
  published: boolean
  meet_time?: string | null
  kit?: string | null
  kit_snapshot?: unknown
  family_note?: string | null
  home_away?: string | null
  status?: string | null
  cancel_reason?: string | null
  series_id?: string | null
  training_themes?: string[] | null
  competition?: string | null
}

export function blankForm(date: string): EventForm {
  return { kind: 'training', title: '', date, time: '', duration: 90, venue: '', meetTime: '', opponent: '', homeAway: '', kit: '', kitSnapshot: null, familyNote: '', themes: [], competition: '' }
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** The club's name as typed, without a leading "vs", "vs." or "v": coaches type
 *  "vs Marbella FC", and the title adds its own "vs" (TRAK-299). */
export function opponentName(typed: string): string {
  return typed.trim().replace(/^vs?(?:\.|\s+|$)\s*/i, '')
}

/** What the event is: a match's opponent, an "other" event's name. The Schedule
 *  form's first step checks only this (TRAK-182); formProblem() checks it too. */
export function whatProblem(form: EventForm): string | null {
  if (form.kind === 'match' && !opponentName(form.opponent)) return i18n.t('coachSchedule:problemOpponent')
  if (form.kind === 'other' && !form.title.trim()) return i18n.t('coachSchedule:problemWhat')
  // TRAK-635 (Kostas, 28 Nov): a training is named by the coach; a match still has its "vs Opponent".
  if (form.kind === 'training' && !form.title.trim()) return i18n.t('coachSchedule:problemTrainingTitle')
  return null
}

/** What's wrong with the form in words the coach can act on, or null. */
export function formProblem(form: EventForm): string | null {
  if (!form.date || !toInstant(form.date, form.time || null)) return i18n.t('coachSchedule:problemRealDate')
  // TRAK-157: every event has a start time (Imad, 12 Oct). The 11 Oct live run
  // saved 8 published trainings with none; the database refuses it too.
  if (!form.time) return i18n.t('coachSchedule:pickStartTime')
  const what = whatProblem(form)
  if (what) return what
  if (form.meetTime && minutes(form.meetTime) > minutes(form.time)) return i18n.t('coachSchedule:problemMeetBefore')
  if (form.familyNote.trim().length > FAMILY_NOTE_MAX) return i18n.t('coachSchedule:problemNoteLength', { max: FAMILY_NOTE_MAX })
  return null
}

/** TRAK-127: New event is for what's coming (Imad, 16 Oct); what already
 *  happened is logged, with its score or register (TRAK-138). */
export const PAST_DATE_PROBLEM = 'This date has passed'

/** `2026-10-31` -> `Saturday 31 October`, as Schedule's Review and sheets write a day. */
export function formatEventDay(date: string) {
  // TRAK-407: the day and month names in the language showing (English as before).
  return new Date(date + 'T12:00:00').toLocaleDateString(currentLanguage() === 'en' ? 'en-GB' : currentLanguage(), {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

/** A date before `today` on a new event, or moved to on an edit. An edit that
 *  keeps a past event's own date still saves (a venue fix, a note). */
export function pastDateProblem(date: string, today: string, originalDate?: string | null): string | null {
  if (!date || date >= today) return null
  if (originalDate && originalDate === date) return null
  // TRAK-407: in the language showing; PAST_DATE_PROBLEM is its English.
  return i18n.t('coachSchedule:problemPastDate')
}

export function eventTitle(form: EventForm): string {
  const typed = form.title.trim()
  if (typed) return typed
  if (form.kind === 'match') return `vs ${opponentName(form.opponent)}`
  return 'Training'
}

/** The columns a save writes. Call only when formProblem() is null. */
export function formToRow(form: EventForm) {
  // Dubai, whatever the device says (Imad, 10 Oct). The database then resets it
  // to the academy's own clock (TRAK-175), so an Athens academy's 17:00 is Athens.
  const starts_at = toAcademyInstant(form.date, form.time || null)!
  const cal = calendarFields(form.date, form.time || null)!
  const isMatch = form.kind === 'match'
  // A length only means something from a known start. An end past midnight
  // keeps its instant; the wall-clock end is left blank, as the table only
  // accepts an end_time on the same day.
  let ends_at: string | null = null
  let end_time: string | null = null
  if (form.time) {
    ends_at = new Date(new Date(starts_at).getTime() + form.duration * 60_000).toISOString()
    const end = minutes(form.time) + form.duration
    if (end < 24 * 60) end_time = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}:00`
  }
  return {
    title: eventTitle(form),
    event_type: form.kind,
    starts_at,
    ends_at,
    ...cal,
    end_time,
    venue: form.venue.trim() || null,
    meet_time: form.meetTime ? `${form.meetTime}:00` : null,
    opponent: isMatch ? opponentName(form.opponent) : null,
    home_away: isMatch && form.homeAway ? form.homeAway : null,
    // TRAK-161: kit and the family note on every kind of event.
    kit: form.kitSnapshot ? describeEventKit(form.kitSnapshot) : form.kit.trim() || null,
    kit_snapshot: form.kitSnapshot ? readKitSnapshot(form.kitSnapshot) : null,
    family_note: form.familyNote.trim() || null,
    training_themes: form.kind === 'training' ? form.themes : [],
    // TRAK-288: only when picked, so an academy without Games sends what it always has.
    ...(isMatch && form.competition && { competition: form.competition }),
  }
}

/** A saved event back into the form, for editing. */
export function rowToForm(row: EventRow): EventForm {
  const { date, time } = displayEventTime(row)
  const kind: EventKind = row.event_type === 'match' || row.event_type === 'training' ? row.event_type : 'other'
  const duration = row.ends_at && time
    ? Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60_000)
    : 90
  // TRAK-635: a training's title is the coach's own, so it comes back as saved (an old one says "Training").
  const autoTitle = kind === 'match' ? `vs ${row.opponent ?? ''}` : ''
  return {
    kind,
    title: row.title === autoTitle ? '' : row.title,
    date,
    time: time ?? '',
    duration: duration > 0 ? duration : 90,
    venue: row.venue ?? '',
    meetTime: row.meet_time ? row.meet_time.slice(0, 5) : '',
    opponent: row.opponent ?? '',
    homeAway: row.home_away === 'home' || row.home_away === 'away' ? row.home_away : '',
    kit: row.kit ?? '',
    kitSnapshot: readKitSnapshot(row.kit_snapshot),
    familyNote: row.family_note ?? '',
    themes: trainingThemesFrom(row.training_themes),
    competition: COMPETITIONS.find(c => c.value === row.competition)?.value ?? '',
  }
}

export function cancelPatch(reason: string) {
  return { status: 'cancelled', cancel_reason: reason.trim() || null }
}

export const isCancelled = (row: Pick<EventRow, 'status'>) => row.status === 'cancelled'

/** Delete is only for a mistake nobody has seen: a draft never published. */
export const canDelete = (row: Pick<EventRow, 'published' | 'status'>) => !row.published && !isCancelled(row)

/** TRAK-230 (Kostas, 21 Oct, option A): once an event has started, what families were told is
    fixed: no edit and no cancel, only its register or match log (refuse_started_event_change).
    An old event with no start time locks when its day is over. */
export function startedLocked(row: Pick<EventRow, 'starts_at' | 'start_time'>, now = Date.now()): boolean {
  return Date.parse(row.starts_at) + (row.start_time ? 0 : 86_400_000) <= now
}
export const STARTED_LOCKED = "This event has started, so it can't be changed. Use its register or match log instead."
/** The database's refusal of a change to a started event, said as it is. */
export function lockedMessage(error: unknown): string | null {
  const e = error as { code?: string, message?: string } | null
  return e?.code === 'P0001' && e.message === STARTED_LOCKED ? e.message : null
}

/* TRAK-128 (J8.5): weekly repeat. A series is stored as one row per date, all
   sharing a series_id; no repeat rule is stored, so attendance, "can't make
   it" and cancelling stay per week. Dates are calendar dates (Dubai wall
   clock), so the arithmetic below never touches a time zone. */

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
/** A slip of the end date (a year instead of a term) shouldn't make 300 events. */
export const MAX_SERIES_EVENTS = 60

export type Repeat = { on: boolean; days: number[]; until: string }   // days: 0 = Monday

const DAY_MS = 86_400_000
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS
const realDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date

/** Monday = 0 … Sunday = 6. */
export function weekdayOf(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

export function blankRepeat(date: string): Repeat {
  return { on: false, days: realDate(date) ? [weekdayOf(date)] : [], until: '' }
}

/** Every date from `start` to `until`, both included, on the chosen weekdays. */
export function seriesDates(start: string, until: string, days: number[]): string[] {
  if (!realDate(start) || !realDate(until)) return []
  const out: string[] = []
  for (let n = dayNumber(start); n <= dayNumber(until); n++) {
    const date = new Date(n * DAY_MS).toISOString().slice(0, 10)
    if (days.includes(weekdayOf(date))) out.push(date)
  }
  return out
}

/** What's wrong with the repeat in words the coach can act on, or null. */
export function repeatProblem(form: EventForm, repeat: Repeat): string | null {
  if (!repeat.on) return null
  if (!repeat.days.length) return i18n.t('coachSchedule:problemPickDay')
  if (!repeat.until || !realDate(repeat.until)) return i18n.t('coachSchedule:problemSeriesEnd')
  if (repeat.until < form.date) return i18n.t('coachSchedule:problemSeriesOrder')
  const count = seriesDates(form.date, repeat.until, repeat.days).length
  if (!count) return i18n.t('coachSchedule:problemNoDays')
  if (count > MAX_SERIES_EVENTS) return i18n.t('coachSchedule:problemTooMany', { count, max: MAX_SERIES_EVENTS })
  return null
}

/** The rows a new series inserts: the form's details on each of its dates. */
export function seriesRows(form: EventForm, repeat: Repeat, seriesId: string) {
  return seriesDates(form.date, repeat.until, repeat.days)
    .map(date => ({ ...formToRow({ ...form, date }), series_id: seriesId }))
}

/** This week and the rest of its series that can still change (not cancelled). */
export function thisAndFollowing<R extends Pick<EventRow, 'series_id' | 'status'> & { event_date?: string | null }>(
  rows: R[], row: R,
): R[] {
  if (!row.series_id || !row.event_date) return [row]
  return rows.filter(r => r.series_id === row.series_id && !isCancelled(r)
    && !!r.event_date && r.event_date >= row.event_date!)
}

/** The coach's venues, most recently used first, for "pick or add". */
/** TRAK-255: saved venues by name, most recent first, each with the map link it was last used with.
 *  A venue saved as a bare link has no name to offer, so it isn't offered. */
export function savedVenues(rows: Pick<EventRow, 'venue' | 'starts_at'>[]): { name: string; link: string }[] {
  const seen = new Map<string, { name: string; link: string; at: string }>()
  for (const row of rows) {
    const { name: typed, link } = splitVenue(row.venue ?? '')
    const name = typed.trim()
    if (!name) continue
    const key = name.toLowerCase()
    const prior = seen.get(key)
    if (!prior || row.starts_at > prior.at) seen.set(key, { name, link, at: row.starts_at })
  }
  return [...seen.values()].sort((a, b) => b.at.localeCompare(a.at)).map(({ name, link }) => ({ name, link }))
}

/** TRAK-158: the database refuses an overlapping live event with a sentence
    for the coach, naming the clash; saving again won't help, so show it. */
export function clashMessage(error: unknown): string | null {
  const e = error as { code?: string, message?: string } | null
  return e?.code === 'P0001' && e.message?.startsWith('This overlaps ') ? e.message : null
}

export type Clash = { title: string; start: string; end: string }

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** TRAK-218: the live event each draft would clash with if published, by the
    database's rule (TRAK-158, refuse_event_overlap): the same coach's
    published, not cancelled events on the same day whose times overlap.
    Back-to-back is fine, no end counts as 90 minutes, and no start isn't
    checked. Pass every one of the coach's events (all squads, as the rule is). */
export function draftClashes(rows: EventRow[]): Map<string, Clash> {
  const span = (r: EventRow) => {
    const start = minutes(r.start_time!.slice(0, 5))
    const end = r.end_time && r.end_time > r.start_time! ? minutes(r.end_time.slice(0, 5))
      : r.ends_at ? start + Math.round((Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 60_000)
      : start + 90
    return { start, end }
  }
  const timed = rows.filter(r => r.event_date && r.start_time && !isCancelled(r))
  const live = timed.filter(r => r.published)
    .sort((a, b) => a.start_time!.localeCompare(b.start_time!) || a.title.localeCompare(b.title))
  const clashes = new Map<string, Clash>()
  for (const draft of timed.filter(r => !r.published)) {
    const d = span(draft)
    const hit = live.find(e => e.event_date === draft.event_date && span(e).start < d.end && span(e).end > d.start)
    if (hit) clashes.set(draft.id, { title: hit.title, start: hhmm(span(hit).start), end: hhmm(span(hit).end) })
  }
  return clashes
}

// TRAK-157: Arc's date picker speaks Date; forms keep YYYY-MM-DD (the
// academy's calendar day), so convert at local midnight both ways.
export const dayAsDate = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return day ? new Date(y, m - 1, d) : undefined
}
export const dateAsDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** What a new event's insert adds to formToRow(): a draft only its coach sees,
 *  until Publish (Imad, 9 Oct). Schedule's form and the quick-add share it. */
// TRAK-176: a new event belongs to the squad the coach has picked (null: the whole roster).
export const newDraftFields = (coachId: string, squad: string | null = null) => ({ coach_user_id: coachId, published: false, source: 'manual', squad })
