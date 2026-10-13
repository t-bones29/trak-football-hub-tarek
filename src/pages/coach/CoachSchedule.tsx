import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Pencil, Send, Trash2, Ban, X, FileUp, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/integrations/supabase/client'
import { displayEventTime } from '@/lib/event-time'
import { askToEmailFamilies } from '@/lib/event-emails'
import { useAuth } from '@/contexts/AuthContext'
import { MobileShell, NavBar, LoadError } from '@/components/trak'
import { useParked } from '@/components/trak/parked'
import {
  CANCELLED_COLOR, DURATIONS, EVENT_COLOR, EVENT_KINDS, FAMILY_NOTE_MAX, NO_TIME_COLOR, WEEKDAYS, blankForm, blankRepeat, canDelete, cancelPatch, formProblem, formToRow,
  isCancelled, repeatProblem, rowToForm, savedVenues, seriesDates, seriesRows, thisAndFollowing,
  type EventForm, type EventKind, type EventRow, type Repeat,
} from '@/lib/coach-events'
import { FixtureImport } from '@/components/coach/FixtureImport'
import { FIXTURE_IMPORT_ENABLED, fixtureInsertRows, scheduleFixtureKeys } from '@/lib/fixture-import'
import type { Fixture } from '@/lib/fixtures-csv'
import { familyNoteProblem, shareableFromRow, squadLabelFrom, whatsAppShareUrl } from '@/lib/event-share'

/* TRAK-127 (J8.4): the coach creates, edits and cancels events. A save is a
   draft only the coach sees; Publish sends it to families (Imad, 9 Oct). Once
   published, an edit goes live on save. A cancel keeps the event on the
   schedule as Cancelled; only a draft nobody has seen can be deleted. The AI
   "Read Schedule" import is gone (G7): fixtures come in by CSV (J8.6).
   TRAK-128 (J8.5): a training repeats weekly until an end date, one row per
   date under one series_id. Editing, cancelling, publishing or deleting a
   week of a series asks: only this week, or this and following weeks. */

// ── Types ────────────────────────────────────────────────────────────────────

type ShownType = EventKind | 'tournament'

type CalEvent = {
  id: string
  title: string
  type: ShownType
  date: string        // YYYY-MM-DD
  time?: string       // HH:MM
  source: 'calendar' | 'session'
  row?: EventRow
  opponent?: string
  venue?: string
}

// ── Colours ──────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<ShownType, string> = EVENT_COLOR

const TYPE_LABEL: Record<ShownType, string> = {
  match: 'Match', training: 'Training', tournament: 'Tournament', other: 'Other',
}

// ── Calendar helpers ─────────────────────────────────────────────────────────

const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function toDateStr(d: Date) {
  // Use LOCAL date parts — toISOString() converts to UTC, which shifts the
  // date back a day for users in timezones ahead of UTC (e.g. Europe), making
  // events land on the wrong calendar cell.
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const last  = new Date(year, month + 1, 0)
  const startDow = (first.getDay() + 6) % 7   // Mon = 0
  const cells: (Date | null)[] = Array(startDow).fill(null)
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d))
  // Pad to full row
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function formatMonthYear(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
}

function formatEventDay(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

/** A write that changed no row was refused (RLS filters, it doesn't error). */
function failed(error: unknown, data: unknown[] | null) {
  return !!error || !data?.length
}

const SAVE_FAILED = "Couldn't save the event. Check your connection and try again; your details are still here."

const inputClass = 'w-full bg-[#0A0A0B] border border-white/[0.07] rounded-[12px] px-3 py-2.5 text-[14px] text-white/88 placeholder-white/20 outline-none'
const font = { fontFamily: "'DM Sans', sans-serif" }
const mono = { fontFamily: "'DM Mono', monospace" }

function Chip({ on, color = '#C8F25A', onClick, children }: { on: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className="px-3 py-1.5 rounded-full text-xs transition-colors"
      style={{
        background: on ? `${color}22` : 'rgba(255,255,255,0.05)',
        color: on ? color : 'rgba(255,255,255,0.45)',
        border: `1px solid ${on ? color + '55' : 'rgba(255,255,255,0.07)'}`,
        ...font,
      }}>
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[9px] tracking-[0.1em] uppercase text-white/40" style={mono}>{label}</span>
      {children}
    </label>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

type Scope = 'one' | 'following'

type Sheet =
  | { kind: 'closed' }
  | { kind: 'edit'; row: EventRow | null; form: EventForm; repeat: Repeat; scope: Scope; error: string | null }
  | { kind: 'cancel'; row: EventRow; reason: string; scope: Scope; error: string | null }
  | { kind: 'series'; action: 'publish' | 'delete'; row: EventRow; error: string | null }
  | { kind: 'import' }

const inSeries = (row: EventRow | null): row is EventRow & { series_id: string; event_date: string } =>
  !!row?.series_id && !!row.event_date

function ScopeChoice({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  return (
    <div className="flex gap-2 flex-wrap" role="group" aria-label="Which weeks">
      <Chip on={scope === 'one'} onClick={() => onChange('one')}>Only this week</Chip>
      <Chip on={scope === 'following'} onClick={() => onChange('following')}>This and following weeks</Chip>
    </div>
  )
}

export default function CoachSchedule() {
  // TRAK-85: parked, so actions say "Coming soon" and send nothing.
  const { parked, comingSoon } = useParked()
  const navigate = useNavigate()
  const { user } = useAuth()

  // Calendar view state
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selected,  setSelected]  = useState<string>(toDateStr(today))

  // Data
  const [calEvents, setCalEvents] = useState<EventRow[]>([])
  const [sessions,  setSessions]  = useState<any[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const [sheet, setSheet] = useState<Sheet>({ kind: 'closed' })
  const [saving, setSaving] = useState(false)

  const loadData = async () => {
    if (!user) return
    const [ev, sess] = await Promise.all([
      supabase.from('coach_calendar_events')
        .select('*').eq('coach_user_id', user.id).order('starts_at'),
      supabase.from('coach_sessions')
        // coach_sessions has no opponent column; naming one failed the whole read.
        .select('id, title, session_type, session_date, competition, venue, notes')
        .eq('coach_user_id', user.id).order('session_date'),
    ])
    // A failed read is not an empty calendar (the J4 standard).
    setLoadFailed(!!ev.error || !!sess.error)
    if (!ev.error) setCalEvents((ev.data as EventRow[]) || [])
    if (!sess.error) setSessions(sess.data || [])
  }

  useEffect(() => { loadData() }, [user])

  // TRAK-139 (J8.16): the squad for the WhatsApp message title ("U15 Match"),
  // and its children's names, so coach-typed text naming one stays out.
  // Optional: a failed read leaves "Squad" and no reason, and never blocks
  // the calendar.
  const [squad, setSquad] = useState<{ label: string, childNames: string[] | null }>({ label: 'Squad', childNames: null })
  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase.from('squad_players').select('age_group, player_name, status').eq('coach_user_id', user.id)
      .then(({ data, error }) => {
        if (cancelled || error) return
        const rows = (data ?? []) as { age_group: string | null, player_name: string | null, status: string | null }[]
        setSquad({ label: squadLabelFrom(rows), childNames: rows.map(r => r.player_name ?? '').filter(Boolean) })
      })
    return () => { cancelled = true }
  }, [user])
  // TRAK-161: tell the coach as they type when families won't see the note.
  const noteProblem = sheet.kind === 'edit' ? familyNoteProblem(sheet.form.familyNote, squad.childNames) : null

  const retry = async () => { setRetrying(true); await loadData(); setRetrying(false) }

  // Normalise both data sources into CalEvent[]
  const allEvents = useMemo<CalEvent[]>(() => {
    const ev: CalEvent[] = []
    for (const e of calEvents) {
      const shown = displayEventTime(e)
      ev.push({
        id:       e.id,
        title:    e.title,
        type:     (e.event_type in TYPE_LABEL ? e.event_type : 'other') as ShownType,
        date:     shown.date,
        // undefined rather than null keeps the existing "no time set" rendering.
        time:     shown.time ?? undefined,
        source:   'calendar',
        row:      e,
        opponent: e.opponent ?? undefined,
        venue:    e.venue ?? undefined,
      })
    }
    for (const s of sessions) {
      ev.push({
        id:       s.id,
        title:    s.title || (s.session_type === 'match' ? 'Match' : 'Training'),
        type:     (s.session_type === 'match' ? 'match' : s.session_type === 'training' ? 'training' : 'other') as ShownType,
        date:     s.session_date ?? '',
        source:   'session',
        venue:    s.venue,
      })
    }
    return ev.filter(e => e.date)
  }, [calEvents, sessions])

  const venues = useMemo(() => savedVenues(calEvents), [calEvents])
  // TRAK-129 (J8.6): fixtures already on the schedule are skipped on import.
  const fixtureKeys = useMemo(() => scheduleFixtureKeys(calEvents), [calEvents])

  // Index events by date string for fast lookup
  const byDate = useMemo<Record<string, CalEvent[]>>(() => {
    const map: Record<string, CalEvent[]> = {}
    for (const e of allEvents) {
      if (!map[e.date]) map[e.date] = []
      map[e.date].push(e)
    }
    return map
  }, [allEvents])

  // Month navigation
  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const cells   = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])
  const todayStr = toDateStr(today)

  const selectedEvents = byDate[selected] ?? []

  const openNew = (date: string) =>
    setSheet({ kind: 'edit', row: null, form: blankForm(date), repeat: blankRepeat(date), scope: 'one', error: null })
  const openEdit = (row: EventRow) =>
    setSheet({ kind: 'edit', row, form: rowToForm(row), repeat: blankRepeat(''), scope: 'one', error: null })
  const setForm = (patch: Partial<EventForm>) =>
    setSheet(s => {
      if (s.kind !== 'edit') return s
      // Until the coach turns repeat on, its weekday follows the first date.
      // A match never repeats: picking Match switches the repeat off, so a
      // hidden repeat can't save a series of identical matches.
      const repeat = patch.kind === 'match' ? { ...s.repeat, on: false }
        : patch.date && !s.repeat.on ? blankRepeat(patch.date) : s.repeat
      return { ...s, form: { ...s.form, ...patch }, repeat, error: null }
    })
  const setRepeat = (patch: Partial<Repeat>) =>
    setSheet(s => s.kind === 'edit' ? { ...s, repeat: { ...s.repeat, ...patch }, error: null } : s)
  const toggleDay = (day: number) =>
    setSheet(s => {
      if (s.kind !== 'edit') return s
      const days = s.repeat.days.includes(day) ? s.repeat.days.filter(d => d !== day) : [...s.repeat.days, day].sort()
      return { ...s, repeat: { ...s.repeat, days }, error: null }
    })

  const saveEvent = async () => {
    if (parked) return comingSoon()
    if (!user || sheet.kind !== 'edit') return
    const { row: editing, form, repeat, scope } = sheet
    const problem = formProblem(form) ?? (editing ? null : repeatProblem(form, repeat))
    if (problem) { setSheet({ ...sheet, error: problem }); return }

    // This and following weeks: each week keeps its own date and takes the rest.
    if (editing && scope === 'following' && inSeries(editing)) {
      if (form.date !== rowToForm(editing).date) {
        setSheet({ ...sheet, error: 'To move the day, change only this week.' })
        return
      }
      const targets = thisAndFollowing(calEvents, editing)
      setSaving(true)
      const results = await Promise.all(targets.map(t =>
        supabase.from('coach_calendar_events')
          .update(formToRow({ ...form, date: displayEventTime(t).date })).eq('id', t.id).select('id')))
      setSaving(false)
      loadData()
      // Even a partial save may have changed a published week (TRAK-135).
      if (targets.some(t => t.published)) askToEmailFamilies()
      const saved = results.filter(r => !failed(r.error, r.data)).length
      if (saved < targets.length) {
        // Saving again rewrites every week the same way, so it is safe to retry.
        setSheet({ ...sheet, error: `Saved ${saved} of ${targets.length} weeks. Check your connection and save again.` })
        return
      }
      setSheet({ kind: 'closed' })
      toast.success(`Saved ${saved} weeks.${targets.some(t => t.published) ? ' Families see the change.' : ''}`)
      return
    }

    setSaving(true)
    const fresh = { coach_user_id: user.id, published: false, source: 'manual' }
    const series = !editing && repeat.on && form.kind !== 'match'
    const rows = series
      ? seriesRows(form, repeat, crypto.randomUUID()).map(r => ({ ...r, ...fresh }))
      : [{ ...formToRow(form), ...fresh }]
    // New events start as drafts; an edit leaves published alone, so a
    // published event's change goes live on save.
    const { data, error } = editing
      ? await supabase.from('coach_calendar_events').update(formToRow(form)).eq('id', editing.id).select('id')
      : await supabase.from('coach_calendar_events').insert(rows).select('id')
    setSaving(false)
    // Errors keep what was typed and say what failed (the J4 standard). A
    // series is one insert, so it saves whole or not at all.
    if (failed(error, data) || (!editing && data!.length !== rows.length)) { setSheet({ ...sheet, error: SAVE_FAILED }); return }
    setSheet({ kind: 'closed' })
    setSelected(form.date)
    loadData()
    if (editing?.published) askToEmailFamilies()
    toast.success(editing
      ? editing.published ? 'Saved. Families see the change.' : 'Draft saved'
      : series ? `Saved ${rows.length} events as drafts. Tap Publish when they’re ready.`
        : 'Saved as a draft. Tap Publish when it’s ready.')
  }

  const publish = async (row: EventRow) => {
    if (parked) return comingSoon()
    if (inSeries(row)) { setSheet({ kind: 'series', action: 'publish', row, error: null }); return }
    const { data, error } = await supabase.from('coach_calendar_events')
      .update({ published: true }).eq('id', row.id).select('id')
    if (failed(error, data)) { toast.error(`Couldn't publish "${row.title}". Try again.`); return }
    loadData()
    toast.success('Published to the squad')
  }

  const confirmCancel = async () => {
    if (parked) return comingSoon()
    if (sheet.kind !== 'cancel') return
    const { row, scope } = sheet
    setSaving(true)
    const following = scope === 'following' && inSeries(row)
    const update = supabase.from('coach_calendar_events').update(cancelPatch(sheet.reason))
    // This and following: cancel only what families have seen. A draft week
    // cancelled would be stuck on the schedule (only drafts can be deleted),
    // so the drafts in the range are deleted instead.
    const { data, error } = following
      ? await update.eq('series_id', row.series_id).gte('event_date', row.event_date)
          .eq('status', 'scheduled').eq('published', true).select('id')
      : await update.eq('id', row.id).select('id')
    if (failed(error, data)) {
      setSaving(false)
      setSheet({ ...sheet, error: "Couldn't cancel the event. Check your connection and try again." })
      return
    }
    // Zero drafts is normal here, so only an error counts as a failure.
    const { data: removedDrafts, error: draftError } = following
      ? await supabase.from('coach_calendar_events').delete().eq('series_id', row.series_id)
          .gte('event_date', row.event_date).eq('published', false).eq('status', 'scheduled').select('id')
      : { data: null, error: null }
    setSaving(false)
    loadData()
    // A cancelled published event emails its families (TRAK-135); "this and
    // following" may reach published weeks after a draft one.
    if (row.published || following) askToEmailFamilies()
    if (draftError) {
      setSheet({ ...sheet, error: `Cancelled ${data!.length} published events, but couldn't remove the unpublished drafts after them. Delete them from the schedule.` })
      return
    }
    setSheet({ kind: 'closed' })
    const removed = removedDrafts?.length ?? 0
    toast.success((data!.length > 1
      ? `${data!.length} events cancelled. They stay on the schedule as Cancelled.`
      : 'Event cancelled. It stays on the schedule as Cancelled.')
      + (removed ? ` ${removed} unpublished draft${removed > 1 ? 's' : ''} removed.` : ''))
  }

  /** Publish or delete a week of a series: only this week, or this and following. */
  const seriesAction = async (scope: Scope) => {
    if (parked) return comingSoon()
    if (sheet.kind !== 'series' || !inSeries(sheet.row)) return
    const { action, row } = sheet
    const table = supabase.from('coach_calendar_events')
    const query = action === 'publish' ? table.update({ published: true }) : table.delete()
    // Only drafts still scheduled: a published week is never deleted, and a
    // cancelled one stays as it is.
    const { data, error } = scope === 'one'
      ? await query.eq('id', row.id).select('id')
      : await query.eq('series_id', row.series_id).gte('event_date', row.event_date)
          .eq('published', false).eq('status', 'scheduled').select('id')
    if (failed(error, data)) {
      setSheet({ ...sheet, error: `Couldn't ${action} "${row.title}". Check your connection and try again.` })
      return
    }
    setSheet({ kind: 'closed' })
    loadData()
    const n = data!.length
    toast.success(action === 'publish'
      ? n > 1 ? `Published ${n} events to the squad` : 'Published to the squad'
      : n > 1 ? `Deleted ${n} drafts` : 'Draft deleted')
  }

  const deleteDraft = async (row: EventRow) => {
    if (parked) return comingSoon()
    if (!canDelete(row)) return
    if (inSeries(row)) { setSheet({ kind: 'series', action: 'delete', row, error: null }); return }
    const { data, error } = await supabase.from('coach_calendar_events').delete().eq('id', row.id).select('id')
    if (failed(error, data)) { toast.error(`Couldn't delete "${row.title}". Try again.`); return }
    if (sheet.kind === 'edit' && sheet.row?.id === row.id) setSheet({ kind: 'closed' })
    loadData()
    toast.success('Draft deleted')
  }

  // TRAK-129 (J8.6): one insert for the whole file, so it saves whole or not
  // at all. FixtureImport keeps every row and says so if this throws.
  const importFixtures = async (fixtures: Fixture[]) => {
    if (!user) throw new Error('Not signed in')
    const rows = fixtureInsertRows(fixtures, user.id)
    const { data, error } = await supabase.from('coach_calendar_events').insert(rows).select('id')
    if (error || (data?.length ?? 0) !== rows.length) throw new Error("Couldn't save the fixtures")
    toast.success(`Added ${rows.length} ${rows.length === 1 ? 'fixture' : 'fixtures'} as drafts. Publish each when it's ready.`)
    await loadData()
  }

  return (
    <MobileShell>
      <div className="pt-3 pb-28 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-[22px] font-light text-white/88 tracking-tight"
            style={{ ...font, letterSpacing: '-0.02em' }}>
            Calendar
          </h1>
          <div className="flex items-center gap-2">
            {/* TRAK-162: the CSV import is parked; no coach is offered it. */}
            {FIXTURE_IMPORT_ENABLED && <button
              onClick={() => (parked ? comingSoon() : setSheet({ kind: 'import' }))}
              className="flex items-center justify-center w-8 h-8 rounded-full"
              style={{ background: 'rgba(255,255,255,0.08)' }}
              aria-label="Import fixtures">
              <FileUp size={15} color="rgba(255,255,255,0.75)" />
            </button>}
            <button
              onClick={() => openNew(selected)}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-[#C8F25A]"
              aria-label="Add event">
              <Plus size={16} color="#000" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {loadFailed && <LoadError what="your calendar" onRetry={retry} retrying={retrying} />}

        {/* ── Month grid ───────────────────────────────────────────────────── */}
        <div className="rounded-[18px] border border-white/[0.07] overflow-hidden"
          style={{ background: '#101012' }}>

          {/* Month nav */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
            <button onClick={prevMonth} aria-label="Previous month" className="w-7 h-7 flex items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              <ChevronLeft size={14} color="rgba(255,255,255,0.6)" />
            </button>
            <span className="text-[13px] font-medium text-white/88" style={font}>
              {formatMonthYear(viewYear, viewMonth)}
            </span>
            <button onClick={nextMonth} aria-label="Next month" className="w-7 h-7 flex items-center justify-center rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              <ChevronRight size={14} color="rgba(255,255,255,0.6)" />
            </button>
          </div>

          {/* Day-of-week labels */}
          <div className="grid grid-cols-7 px-1 pt-2 pb-1">
            {DAY_LABELS.map(l => (
              <div key={l} className="text-center text-[9px] font-medium tracking-[0.08em] uppercase"
                style={{ ...mono, color: 'rgba(255,255,255,0.25)' }}>
                {l}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 px-1 pb-3 gap-y-1">
            {cells.map((date, i) => {
              if (!date) return <div key={i} />

              const dateStr  = toDateStr(date)
              const isToday  = dateStr === todayStr
              const isSel    = dateStr === selected
              const dayEvs   = byDate[dateStr] ?? []
              const isPast   = date < today && !isToday
              const dots     = dayEvs.slice(0, 3)

              return (
                <button key={i}
                  onClick={() => setSelected(dateStr)}
                  className="flex flex-col items-center py-1.5 rounded-[10px] transition-colors"
                  style={{
                    background: isSel ? 'rgba(200,242,90,0.14)' : 'transparent',
                    border: isToday ? '1px solid rgba(200,242,90,0.4)' : '1px solid transparent',
                  }}>
                  <span className="text-[12px] leading-none"
                    style={{
                      ...font,
                      color: isSel ? '#C8F25A'
                        : isToday ? '#C8F25A'
                        : isPast  ? 'rgba(255,255,255,0.3)'
                        : 'rgba(255,255,255,0.78)',
                      fontWeight: isToday || isSel ? 600 : 400,
                    }}>
                    {date.getDate()}
                  </span>
                  {/* Event dots */}
                  <div className="flex items-center gap-[3px] mt-1.5 h-[5px]">
                    {dots.map((ev, di) => (
                      <div key={di} className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                        style={{ background: ev.row && isCancelled(ev.row) ? CANCELLED_COLOR : TYPE_COLOR[ev.type] }} />
                    ))}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2.5 border-t border-white/[0.05]">
            {EVENT_KINDS.map(type => (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-[6px] h-[6px] rounded-full" style={{ background: TYPE_COLOR[type] }} />
                <span className="text-[8px] uppercase tracking-[0.08em]"
                  style={{ ...mono, color: 'rgba(255,255,255,0.3)' }}>
                  {TYPE_LABEL[type]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Selected day ─────────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-medium tracking-[0.1em] uppercase text-white/40" style={mono}>
              {formatEventDay(selected)}
            </span>
            <button
              onClick={() => openNew(selected)}
              className="text-[9px] tracking-[0.1em] uppercase text-[#C8F25A]"
              style={mono}>
              + Add
            </button>
          </div>

          {selectedEvents.length === 0 ? (
            <div className="rounded-[14px] border border-white/[0.05] px-4 py-5 text-center"
              style={{ background: '#101012' }}>
              <p className="text-[12px] text-white/30">Nothing planned. Tap + Add to schedule an event.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map(ev => {
                const row = ev.row
                const cancelled = !!row && isCancelled(row)
                return (
                  <div key={ev.id}
                    className="rounded-[14px] px-4 py-3 flex items-start gap-3"
                    style={{ background: '#101012', border: '1px solid rgba(255,255,255,0.06)', opacity: cancelled ? 0.7 : 1 }}>
                    <div className="w-1 self-stretch rounded-full flex-shrink-0"
                      style={{ background: cancelled ? CANCELLED_COLOR : TYPE_COLOR[ev.type], minHeight: 28 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate"
                        style={{ color: 'rgba(255,255,255,0.88)', ...font, textDecoration: cancelled ? 'line-through' : undefined }}>
                        {ev.title}
                      </p>
                      <p className="text-[9px] mt-0.5" style={{ ...mono, color: 'rgba(255,255,255,0.35)' }}>
                        {/* TRAK-159: a scheduled event says its time, or that it has none. */}
                        {ev.time
                          ? <><span className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>{ev.time}</span>{' · '}</>
                          : row && <><span className="text-[10px] font-medium" style={{ color: NO_TIME_COLOR }}>No time set</span>{' · '}</>}
                        {TYPE_LABEL[ev.type]}{row?.series_id ? ' · Weekly' : ''}
                        {row?.meet_time ? ` · meet ${row.meet_time.slice(0, 5)}` : ''}
                        {row?.home_away ? ` · ${row.home_away === 'home' ? 'Home' : 'Away'}` : ''}
                        {ev.venue ? ` · ${ev.venue}` : ''}
                      </p>
                      {row?.kit && (
                        <p className="text-[9px] mt-0.5" style={{ ...mono, color: 'rgba(255,255,255,0.35)' }}>Kit: {row.kit}</p>
                      )}
                      {ev.source === 'session' && (
                        <span className="text-[8px] tracking-[0.06em] uppercase mt-0.5 inline-block"
                          style={{ color: 'rgba(255,255,255,0.22)', ...mono }}>
                          Logged
                        </span>
                      )}
                      {row && (
                        <span className="text-[8px] tracking-[0.06em] uppercase mt-0.5 inline-block"
                          style={{ color: cancelled ? CANCELLED_COLOR : row.published ? '#C8F25A' : 'rgba(255,255,255,0.35)', ...mono }}>
                          {cancelled ? 'Cancelled' : row.published ? 'Published' : 'Draft · only you see this'}
                        </span>
                      )}
                      {cancelled && row?.cancel_reason && (
                        <p className="text-[11px] mt-0.5 text-white/45" style={font}>{row.cancel_reason}</p>
                      )}
                    </div>
                    {row && !cancelled && (
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <button onClick={() => openEdit(row)} aria-label={`Edit ${row.title}`}>
                          <Pencil size={14} color="rgba(255,255,255,0.5)" />
                        </button>
                        {!row.published && (
                          <button onClick={() => publish(row)} aria-label={`Publish ${row.title}`}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium"
                            style={{ background: '#C8F25A', color: '#000', ...font }}>
                            <Send size={11} color="#000" />Publish
                          </button>
                        )}
                        {canDelete(row) ? (
                          <button onClick={() => deleteDraft(row)} aria-label={`Delete ${row.title}`}>
                            <Trash2 size={14} color="rgba(255,255,255,0.3)" />
                          </button>
                        ) : (
                          <button onClick={() => setSheet({ kind: 'cancel', row, reason: '', scope: 'one', error: null })}
                            aria-label={`Cancel ${row.title}`}>
                            <Ban size={14} color="rgba(248,113,113,0.8)" />
                          </button>
                        )}
                      </div>
                    )}
                    {/* TRAK-139 (J8.16): WhatsApp's own share link. Trak sends
                        nothing; the coach picks the group. Drafts have nothing
                        to share yet. */}
                    {row?.published && (parked ? (
                      <button onClick={comingSoon} aria-label={`Share ${row.title} to WhatsApp`} className="flex-shrink-0">
                        <Share2 size={14} color="rgba(255,255,255,0.5)" />
                      </button>
                    ) : (
                      <a href={whatsAppShareUrl(shareableFromRow(row, squad.label), { childNames: squad.childNames })} target="_blank" rel="noopener noreferrer"
                        aria-label={`Share ${row.title} to WhatsApp`} className="flex-shrink-0">
                        <Share2 size={14} color="#25D366" />
                      </a>
                    ))}
                    {ev.source === 'session' && (
                      <button
                        onClick={() => navigate('/coach/sessions/list')}
                        className="text-[9px] uppercase tracking-[0.08em] flex-shrink-0"
                        style={{ color: 'rgba(255,255,255,0.3)', ...mono }}>
                        View
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Event sheet: new or edit ──────────────────────────────────────── */}
      {sheet.kind === 'edit' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label={sheet.row ? 'Edit event' : 'New event'}
            className="w-full max-w-[430px] rounded-t-[24px] p-5 space-y-3 overflow-y-auto"
            style={{ background: '#17171A', border: '1px solid rgba(255,255,255,0.10)', maxHeight: '85vh', marginBottom: 64 }}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium text-white/88" style={font}>
                {sheet.row ? 'Edit event' : 'New event'}
              </span>
              <button onClick={() => setSheet({ kind: 'closed' })} aria-label="Close">
                <X size={18} color="rgba(255,255,255,0.5)" />
              </button>
            </div>

            {inSeries(sheet.row) && (
              <ScopeChoice scope={sheet.scope}
                onChange={scope => setSheet(s => s.kind === 'edit' ? { ...s, scope, error: null } : s)} />
            )}

            <div className="flex gap-2 flex-wrap" role="group" aria-label="Event type">
              {EVENT_KINDS.map(t => (
                <Chip key={t} on={sheet.form.kind === t} color={TYPE_COLOR[t]} onClick={() => setForm({ kind: t })}>
                  {TYPE_LABEL[t]}
                </Chip>
              ))}
            </div>

            {sheet.form.kind === 'match' && (
              <>
                <Field label="Opponent">
                  <input value={sheet.form.opponent} onChange={e => setForm({ opponent: e.target.value })}
                    placeholder="e.g. Al Wasl U15" className={inputClass} style={font} />
                </Field>
                <div className="flex gap-2" role="group" aria-label="Home or away">
                  <Chip on={sheet.form.homeAway === 'home'} onClick={() => setForm({ homeAway: sheet.form.homeAway === 'home' ? '' : 'home' })}>Home</Chip>
                  <Chip on={sheet.form.homeAway === 'away'} onClick={() => setForm({ homeAway: sheet.form.homeAway === 'away' ? '' : 'away' })}>Away</Chip>
                </div>
              </>
            )}

            <Field label={sheet.form.kind === 'other' ? 'What is it' : 'Title (optional)'}>
              <input value={sheet.form.title} onChange={e => setForm({ title: e.target.value })}
                placeholder={sheet.form.kind === 'match' ? `vs ${sheet.form.opponent || 'Opponent'}` : sheet.form.kind === 'training' ? 'Training' : 'e.g. Team photo'}
                className={inputClass} style={font} />
            </Field>

            <div className="flex gap-2">
              <div className="flex-1">
                <Field label={sheet.repeat.on ? 'First date' : 'Date'}>
                  <input type="date" value={sheet.form.date} onChange={e => setForm({ date: e.target.value })}
                    disabled={sheet.scope === 'following'}
                    className={inputClass} style={{ ...font, colorScheme: 'dark', opacity: sheet.scope === 'following' ? 0.5 : 1 }} />
                </Field>
              </div>
              <div className="w-[120px]">
                <Field label={sheet.form.kind === 'match' ? 'Kickoff' : 'Start'}>
                  <input type="time" value={sheet.form.time} onChange={e => setForm({ time: e.target.value })}
                    className={inputClass} style={{ ...font, colorScheme: 'dark' }} />
                </Field>
              </div>
            </div>

            {sheet.scope === 'following' && (
              <p className="text-[11px] text-white/40" style={font}>Each week keeps its own date; everything else changes.</p>
            )}

            {!sheet.row && sheet.form.kind !== 'match' && (
              <div className="space-y-2">
                <Chip on={sheet.repeat.on} onClick={() => setRepeat({ on: !sheet.repeat.on })}>Repeats weekly</Chip>
                {sheet.repeat.on && (
                  <>
                    <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Repeat on">
                      {WEEKDAYS.map((label, day) => (
                        <Chip key={label} on={sheet.repeat.days.includes(day)} onClick={() => toggleDay(day)}>{label}</Chip>
                      ))}
                    </div>
                    <Field label="Ends on">
                      <input type="date" value={sheet.repeat.until} onChange={e => setRepeat({ until: e.target.value })}
                        className={inputClass} style={{ ...font, colorScheme: 'dark' }} />
                    </Field>
                    {!repeatProblem(sheet.form, sheet.repeat) && (
                      <p className="text-[11px] text-white/50" style={font}>
                        {seriesDates(sheet.form.date, sheet.repeat.until, sheet.repeat.days).length} events, last one {formatEventDay(sheet.repeat.until)}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="space-y-1">
              <span className="text-[9px] tracking-[0.1em] uppercase text-white/40" style={mono}>Length</span>
              <div className="flex gap-2 flex-wrap" role="group" aria-label="Length">
                {DURATIONS.map(d => (
                  <Chip key={d} on={sheet.form.duration === d} onClick={() => setForm({ duration: d })}>{d} min</Chip>
                ))}
              </div>
            </div>

            <Field label="Venue">
              <input value={sheet.form.venue} onChange={e => setForm({ venue: e.target.value })}
                list="saved-venues" placeholder="Pick a saved venue or type a new one" className={inputClass} style={font} />
              <datalist id="saved-venues">
                {venues.map(v => <option key={v} value={v} />)}
              </datalist>
            </Field>

            <Field label="Meet time (if earlier)">
              <input type="time" value={sheet.form.meetTime} onChange={e => setForm({ meetTime: e.target.value })}
                className={inputClass} style={{ ...font, colorScheme: 'dark' }} />
            </Field>

            {/* TRAK-161: kit and a family note on every kind of event. */}
            <Field label="Kit">
              <input value={sheet.form.kit} onChange={e => setForm({ kit: e.target.value })}
                placeholder={sheet.form.kind === 'match' ? 'e.g. Red shirts, black shorts' : 'e.g. Green bibs, shin guards'} className={inputClass} style={font} />
            </Field>

            <div className="space-y-1">
              <Field label="Note for families">
                <input value={sheet.form.familyNote} onChange={e => setForm({ familyNote: e.target.value })}
                  maxLength={FAMILY_NOTE_MAX} aria-describedby={noteProblem ? "family-note-hint family-note-problem" : "family-note-hint"}
                  placeholder="e.g. Bring extra water, it's a hot day" className={inputClass} style={font} />
              </Field>
              <p id="family-note-hint" className="text-[11px] text-white/40" style={font}>
                Players and parents see this. A note with a player's name or a link isn't shown to them.
              </p>
              {noteProblem && (
                <p id="family-note-problem" role="status" className="text-[11px] text-[#fbbf24]" style={font}>
                  Families won't see this note: {noteProblem === 'link' ? 'it has a link' : 'it names a player'}.
                </p>
              )}
            </div>

            {sheet.error && (
              <p role="alert" className="text-[12px] text-[#f87171]" style={font}>{sheet.error}</p>
            )}

            <button
              onClick={saveEvent}
              disabled={saving}
              className="w-full py-3.5 rounded-[12px] text-[14px] font-medium transition-opacity"
              style={{ background: '#C8F25A', color: '#000', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…'
                : sheet.row?.published ? 'Save changes'
                : !sheet.row && sheet.repeat.on && !repeatProblem(sheet.form, sheet.repeat)
                  ? `Save ${seriesDates(sheet.form.date, sheet.repeat.until, sheet.repeat.days).length} drafts`
                : 'Save draft'}
            </button>
            {sheet.row?.published && (
              <p className="text-[11px] text-white/40 text-center" style={font}>Families see the change as soon as you save.</p>
            )}
          </div>
        </div>
      )}

      {/* ── Cancel sheet ──────────────────────────────────────────────────── */}
      {sheet.kind === 'cancel' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label="Cancel event"
            className="w-full max-w-[430px] rounded-t-[24px] p-5 space-y-3"
            style={{ background: '#17171A', border: '1px solid rgba(255,255,255,0.10)', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-white/88 block" style={font}>Cancel {sheet.row.title}?</span>
            <p className="text-[12px] text-white/50" style={font}>
              It stays on everyone's schedule, marked Cancelled.
            </p>
            {inSeries(sheet.row) && (
              <ScopeChoice scope={sheet.scope}
                onChange={scope => setSheet(s => s.kind === 'cancel' ? { ...s, scope, error: null } : s)} />
            )}
            <Field label="Reason (optional)">
              <input value={sheet.reason}
                onChange={e => setSheet(s => s.kind === 'cancel' ? { ...s, reason: e.target.value, error: null } : s)}
                placeholder="e.g. Pitch waterlogged" className={inputClass} style={font} />
            </Field>
            {sheet.error && <p role="alert" className="text-[12px] text-[#f87171]" style={font}>{sheet.error}</p>}
            <button onClick={confirmCancel} disabled={saving}
              className="w-full py-3.5 rounded-[12px] text-[14px] font-medium"
              style={{ background: '#f87171', color: '#000', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Cancelling…' : 'Cancel event'}
            </button>
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-white/60" style={font}>
              Keep event
            </button>
          </div>
        </div>
      )}

      {/* ── Import sheet (TRAK-129, J8.6) ─────────────────────────────────── */}
      {sheet.kind === 'import' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label="Import fixtures"
            className="w-full max-w-[430px] max-h-[85vh] overflow-y-auto rounded-t-[24px] p-5 space-y-3"
            style={{ background: '#17171A', border: '1px solid rgba(255,255,255,0.10)', marginBottom: 64 }}>
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-medium text-white/88" style={font}>Import fixtures</span>
              <button onClick={() => setSheet({ kind: 'closed' })} aria-label="Close">
                <X size={18} className="text-white/50" />
              </button>
            </div>
            <p className="text-[12px] text-white/50" style={font}>
              Fixtures arrive as drafts. Families see each one once you publish it.
            </p>
            <FixtureImport existingKeys={fixtureKeys} onConfirm={importFixtures} />
          </div>
        </div>
      )}

      {/* ── Series sheet: publish or delete which weeks ───────────────────── */}
      {sheet.kind === 'series' && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setSheet({ kind: 'closed' }) }}>
          <div role="dialog" aria-label={sheet.action === 'publish' ? 'Publish event' : 'Delete draft'}
            className="w-full max-w-[430px] rounded-t-[24px] p-5 space-y-3"
            style={{ background: '#17171A', border: '1px solid rgba(255,255,255,0.10)', marginBottom: 64 }}>
            <span className="text-[16px] font-medium text-white/88 block" style={font}>
              {sheet.action === 'publish' ? 'Publish' : 'Delete'} {sheet.row.title}, {formatEventDay(sheet.row.event_date!)}
            </span>
            <p className="text-[12px] text-white/50" style={font}>
              {sheet.action === 'publish'
                ? 'This week is part of a weekly series. Families see what you publish.'
                : 'This week is part of a weekly series. Only drafts are deleted; published weeks stay.'}
            </p>
            {sheet.error && <p role="alert" className="text-[12px] text-[#f87171]" style={font}>{sheet.error}</p>}
            <button onClick={() => seriesAction('one')}
              className="w-full py-3 rounded-[12px] text-[14px] font-medium"
              style={{ background: sheet.action === 'publish' ? '#C8F25A' : 'rgba(255,255,255,0.08)', color: sheet.action === 'publish' ? '#000' : 'rgba(255,255,255,0.88)' }}>
              Only this week
            </button>
            <button onClick={() => seriesAction('following')}
              className="w-full py-3 rounded-[12px] text-[14px] font-medium"
              style={{ background: sheet.action === 'publish' ? '#C8F25A' : 'rgba(255,255,255,0.08)', color: sheet.action === 'publish' ? '#000' : 'rgba(255,255,255,0.88)' }}>
              This and following weeks
            </button>
            <button onClick={() => setSheet({ kind: 'closed' })}
              className="w-full py-2 text-[13px] text-white/60" style={font}>
              Not now
            </button>
          </div>
        </div>
      )}

      <NavBar role="coach" activeTab="/coach/schedule" onNavigate={p => navigate(p)} />
    </MobileShell>
  )
}
