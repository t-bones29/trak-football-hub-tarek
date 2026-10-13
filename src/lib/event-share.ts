import { displayEventTime, localTodayISO } from './event-time'
import type { EventRow } from './coach-events'

/**
 * "Share to WhatsApp" (J8.16, TRAK-139): the event's details, pre-written for
 * the coach's parents' group.
 *
 * Trak sends nothing. The link opens WhatsApp with the text filled in; the
 * coach picks the chat and taps send. There is no integration, account or
 * approval behind it.
 *
 * The message is built only from the event's own fields, never a "who can't
 * make it" list; absences stay in Trak (J8.14). Venue, kit, opponent and the
 * cancel reason are coach-typed, so they get Imad's 10 Oct rule, as in the
 * calendar feed (#258) and the change emails (#264): text naming a child on
 * the squad is left out, and so is a reason with a link, or any reason while
 * the squad's names are unknown.
 */
export interface ShareableEvent {
  kind: 'training' | 'match' | 'tournament' | 'other'
  /** The squad, e.g. "U15". */
  squadLabel: string
  /** YYYY-MM-DD, the day the coach chose (event_date). */
  date: string
  /** HH:MM wall clock, or null while the time is not known. */
  startTime: string | null
  meetTime: string | null
  opponent: string | null
  homeAway: 'home' | 'away' | null
  venue: string | null
  kit: string | null
  status: 'scheduled' | 'cancelled'
  cancelReason: string | null
}

export interface ShareOptions {
  /** Today as YYYY-MM-DD on the coach's device; defaults to localTodayISO(). */
  today?: string
  /** Every child on the coach's squad rows, departed too; null while unknown. */
  childNames: string[] | null
}

// The same two checks as supabase/functions/_shared: namePatterns
// (ical-feed.ts) and LINK (send-email.ts). Copied, not imported: those are
// Deno modules, and #264 is the one that exports them.
const NOT_A_NAME = new Set(['al', 'el', 'bin', 'bint', 'ibn', 'abu', 'van', 'von', 'de', 'da', 'di', 'del', 'la', 'le'])

function namePatterns(names: string[]): RegExp[] {
  const parts = new Set<string>()
  for (const name of names) {
    for (const part of name.toLowerCase().split(/[\s'’-]+/)) {
      if (part.length >= 3 && !NOT_A_NAME.has(part)) parts.add(part)
    }
  }
  // Whole words only, by Unicode letters rather than \b, which knows only ASCII.
  return [...parts].map(p => new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu'))
}

const BARE_TLDS = 'com|net|org|info|biz|io|co|me|ly|gl|gg|to|tv|app|link|page|site|online|ae|uk|eu'
const LINK = new RegExp([
  String.raw`\bhttps?:\/\/[^\s<>"')\]]+`,
  String.raw`\bwww\.[^\s<>"')\]]+`,
  String.raw`\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\/[^\s<>"')\]]*`,
  String.raw`\b(?:[a-z0-9-]+\.)+(?:${BARE_TLDS})(?![\w-]|\.[\w-])`,
].join('|'), 'i')

/**
 * TRAK-161 (Kostas, #293): why families won't see a family note, so the coach
 * is told as they type. The same two checks child_events() applies through
 * family_safe_reason(). With the squad's names unknown, only a link can be
 * judged here; the database still applies the name rule.
 */
export function familyNoteProblem(note: string, childNames: string[] | null): 'link' | 'name' | null {
  const value = note.trim()
  if (LINK.test(value)) return 'link'
  return namePatterns(childNames ?? []).some(p => p.test(value)) ? 'name' : null
}

const TRAK_LINE = 'Full schedule in Trak: https://trakfootball.com'
const KIND_LABEL: Record<ShareableEvent['kind'], string> = {
  training: 'Training',
  match: 'Match',
  tournament: 'Tournament',
  other: 'Event',
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Tue 13 Oct", from the calendar date itself, so no time zone can move the day. */
function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]}`
}

const text = (value: string | null) => (value ?? '').trim()

export function whatsAppShareText(event: ShareableEvent, options: ShareOptions): string {
  const today = options.today ?? localTodayISO()
  const cancelled = event.status === 'cancelled'
  const names = namePatterns(options.childNames ?? [])
  const clean = (value: string | null) => (names.some(p => p.test(text(value))) ? '' : text(value))
  const reason = options.childNames && !LINK.test(text(event.cancelReason)) ? clean(event.cancelReason) : ''
  const opponent = clean(event.opponent)

  let title = `${event.squadLabel} ${KIND_LABEL[event.kind]}`
  if (event.kind === 'match' && opponent) title += ` vs ${opponent}`
  if (cancelled) title += event.date === today ? ' cancelled today' : ' cancelled'
  else if (event.kind === 'match' && event.homeAway) title += ` (${event.homeAway})`

  const lines = [
    `*${title}*`,
    `${dayLabel(event.date)}, ${event.startTime ?? 'time to be confirmed'}`,
  ]
  if (cancelled && reason) lines.push(`Reason: ${reason}`)
  if (!cancelled) {
    if (clean(event.venue)) lines.push(`Venue: ${clean(event.venue)}`)
    if (text(event.meetTime)) lines.push(`Meet: ${text(event.meetTime)}`)
    if (clean(event.kit)) lines.push(`Kit: ${clean(event.kit)}`)
  }
  lines.push('', TRAK_LINE)
  return lines.join('\n')
}

/** WhatsApp's standard share link: no phone number, so WhatsApp asks which chat. */
export function whatsAppShareUrl(event: ShareableEvent, options: ShareOptions): string {
  return `https://wa.me/?text=${encodeURIComponent(whatsAppShareText(event, options))}`
}

/** A saved event on the coach's schedule (J8.4's row) as a shareable message. */
export function shareableFromRow(row: EventRow, squadLabel: string): ShareableEvent {
  const shown = displayEventTime(row)
  const kind = (['training', 'match', 'tournament', 'other'] as const).find(k => k === row.event_type) ?? 'other'
  return {
    kind,
    squadLabel,
    date: shown.date,
    startTime: shown.time,
    meetTime: row.meet_time ? row.meet_time.slice(0, 5) : null,
    opponent: row.opponent ?? null,
    homeAway: row.home_away === 'home' || row.home_away === 'away' ? row.home_away : null,
    venue: row.venue ?? null,
    kit: row.kit ?? null,
    status: row.status === 'cancelled' ? 'cancelled' : 'scheduled',
    cancelReason: row.cancel_reason ?? null,
  }
}

/** The coach's squad for the message title: the age group most of the current squad is in. */
export function squadLabelFrom(rows: { age_group: string | null, status?: string | null }[]): string {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.status === 'coach_departed') continue
    const label = (row.age_group ?? '').trim()
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  let best = 'Squad'
  let top = 0
  for (const [label, n] of counts) if (n > top) { best = label; top = n }
  return best
}
