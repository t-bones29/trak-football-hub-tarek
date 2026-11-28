import { useState, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { Button } from '@/components/arc/button/button'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { MatchAction } from '@/components/coach/games/MatchAction'
import { gameTitle } from '@/components/coach/games/useGames'
import { NextStep } from '@/components/coach/CoachWeekStrip'
import { EventSheetCoach } from '@/components/coach/EventSheetCoach'
import { EventSheet } from '@/components/trak/EventSheet'
import { toPlayerEvent } from '@/lib/player-events'
import { venueParts } from '@/lib/venue-link'
import { NEXT_STEP_SIZE, NEXT_STEP_WIDTH } from '@/components/coach/next-step'
import { phoneEventTime } from '@/lib/event-time'
import { evalDay } from '@/lib/evaluation'
import { planPath, herePath } from '@/lib/training/plans'
import { squadName, type WeekItem } from '@/lib/coach-week'
import { dateLocale, useTranslation } from '@/lib/i18n'
import { isCancelled, type EventRow } from '@/lib/coach-events'
import type { HomeTodoEvent } from './useHomeTodos'
import { TodoPreview, type PreviewKind } from './TodoPreview'
import { useAddTodo, useTickTodo } from './useOwnTodos'

/* TRAK-608 (New Home 2/8, spec TRAK-606): Home's To-do. One numbered list in homeTodos()'s order (TRAK-607): an urgent
   to-do has a yellow number, a done one a green tick, and a button that can't be used yet is greyed and says when it
   opens. Each keeps the app's own next step: the week's (Take register, Share), the match's split button (TRAK-333),
   or the training's planner. */

const hhmm = (ms: number) => format(new Date(ms), 'HH:mm')

/** TRAK-610: a suggestion that isn't an event's step: the top Players job (drafts, assess, positions, watched, stuck). */
export type Suggestion = { key: string; title: string; line: string; action: ReactNode }

export function TodoList({ items, failed, onRetry, coachId, showSquad, onChanged, onOpenReports, nextStep = null, playerJob = null, today = null, onMove, onSetUrgent, onRemove }: {
  /** null while loading. */
  items: HomeTodoEvent[] | null
  failed: boolean
  onRetry: () => void
  coachId: string
  /** Under All, for a coach of two squads or more: each to-do names its squad. */
  showSquad: boolean
  onChanged: () => void
  /** Reports ready opens the squad's reports, picking that squad under All. */
  onOpenReports: (squad: string | null) => void
  /** TRAK-610: the next missing step this week that isn't already a to-do, the first suggestion. */
  nextStep?: HomeTodoEvent | null
  /** TRAK-610: the top Players job, the second suggestion. */
  playerJob?: Suggestion | null
  /** TRAK-612: the academy's day (YYYY-MM-DD), for adding a to-do; null until known. */
  today?: string | null
  /** TRAK-613: Change order moves a to-do up (-1) or down (1). Without it there's no Change order. */
  onMove?: (key: string, by: -1 | 1) => void
  /** TRAK-613: the coach's own to-do marked urgent, or not; and removed. */
  onSetUrgent?: (id: string, urgent: boolean) => void
  onRemove?: (id: string) => void
}) {
  const { t } = useTranslation()
  const urgent = !!items?.some(({ todo }) => todo.urgent && !todo.done)
  // TRAK-609: which previews are open; each starts closed.
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) => setOpen(now => { const next = new Set(now); if (!next.delete(key)) next.add(key); return next })
  // TRAK-613: Change order puts ↑ and ↓ on every to-do (and Urgent and ✕ on the coach's own) in place of their buttons.
  const [ordering, setOrdering] = useState(false)
  const canOrder = !!onMove && !!items && items.length > 1
  return <section aria-labelledby="todo-title" className="grid gap-3">
    <div className="flex items-center justify-between gap-3">
      <h2 id="todo-title" className="text-lg font-medium text-ink">{t('coachHome:todoTitle')}</h2>
      {(canOrder || ordering) && (ordering
        ? <Button size="sm" onClick={() => setOrdering(false)}>{t('coachHome:orderDone')}</Button>
        : <Button size="sm" variant="ghost" onClick={() => setOrdering(true)}>{t('coachHome:orderChange')}</Button>)}
    </div>
    {failed ? <LoadError what={t('coachHome:todoWhat')} onRetry={onRetry} />
      : !items ? <LoadingSkeleton label={t('coachHome:todoLoading')} lines={3} className="rounded-2xl border border-line bg-surface p-5" />
      : <ol className="arc overflow-hidden rounded-2xl border border-line bg-surface">
        {!items.length && <li className="p-5 text-sm text-ink-2">{t('coachHome:todoNone')}</li>}
        {items.map(({ todo, row }, index) => <li key={todo.key} className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-line/60 p-4 first:border-t-0 laptop:grid-cols-[28px_minmax(0,1fr)_auto] laptop:px-5">
          <span aria-hidden className={`grid size-7 place-items-center rounded-full border-[1.5px] text-[13px] font-semibold tabular-nums ${
            todo.done ? 'border-success bg-success text-on-brand' : todo.urgent ? 'border-attention bg-attention text-ink' : 'border-line-strong text-ink-2'}`}>
            {todo.done ? '✓' : index + 1}
          </span>
          <span className="grid min-w-0">
            <span className={`text-base font-medium ${todo.done ? 'text-ink-2' : 'text-ink'}`}>
              {todo.urgent && !todo.done && <span className="sr-only">{t('coachHome:urgent')}</span>}{title(todo, row, t)}
            </span>
            {todo.kind === 'own' && row
              ? <OwnEventLine row={row} coachId={coachId} onChanged={onChanged} />
              : <span className="text-sm text-ink-2">{[showSquad && todo.kind !== 'own' ? squadName(todo.squad) : null, line(todo, row, t)].filter(Boolean).join(' · ')}</span>}
            {row && previewOf(todo) && <PreviewToggle kind={previewOf(todo)!} open={open.has(todo.key)} onToggle={() => toggle(todo.key)} />}
            {row && previewOf(todo) && open.has(todo.key) && <TodoPreview kind={previewOf(todo)!} eventId={row.id} themes={row.training_themes ?? []} />}
          </span>
          <span className="col-start-2 laptop:col-start-auto">{ordering && onMove
            ? <OrderButtons name={title(todo, row, t)} first={index === 0} last={index === items.length - 1} onMove={by => onMove(todo.key, by)}
              own={todo.kind === 'own' ? { urgent: todo.urgent, onUrgent: () => onSetUrgent?.(todo.key.slice('own:'.length), !todo.urgent),
                onRemove: () => onRemove?.(todo.key.slice('own:'.length)) } : null} />
            : action(todo, row, { t, coachId, onChanged, onOpenReports })}</span>
        </li>)}
        {/* TRAK-612: the last step, in dotted lines: the coach adds their own. */}
        {today && !ordering && <AddTodo today={today} />}
      </ol>}
    {/* TRAK-610: once every to-do is done (a greyed one isn't), 2 suggestions at most. */}
    {items && items.every(({ todo }) => todo.done) && (nextStep || playerJob) && <div className="arc grid gap-1 rounded-2xl border border-line bg-surface px-4 py-3 laptop:px-5">
      {items.length > 0 && <p className="flex items-center gap-3 py-1 font-medium text-ink">
        <span aria-hidden className="grid size-7 place-items-center rounded-full bg-success text-[13px] font-semibold text-on-brand">✓</span>{t('coachHome:todoAllDone')}
      </p>}
      <h3 className="pt-1 text-[11px] font-semibold uppercase tracking-[.12em] text-ink-3">{t('coachHome:todoIfTime')}</h3>
      <ul aria-label={t('coachHome:todoIfTime')} className="grid">
        {nextStep && <SuggestionRow title={title(nextStep.todo, nextStep.row, t)} line={line(nextStep.todo, nextStep.row, t)}
          action={action(nextStep.todo, nextStep.row, { t, coachId, onChanged, onOpenReports })} />}
        {playerJob && <SuggestionRow title={playerJob.title} line={playerJob.line} action={playerJob.action} />}
      </ul>
    </div>}
    {urgent && <p className="flex items-center gap-2 text-sm text-ink-3"><span aria-hidden className="size-3 rounded-full bg-attention" />{t('coachHome:todoUrgentKey')}</p>}
  </section>
}

/** TRAK-611: a to-do's own next step, for Upcoming's rows. */
export function TodoAction({ item, coachId, onChanged }: { item: HomeTodoEvent; coachId: string; onChanged: () => void }) {
  const { t } = useTranslation()
  return <>{action(item.todo, item.row, { t, coachId, onChanged, onOpenReports: () => {} })}</>
}

/** TRAK-613: a to-do's ↑ and ↓ while the coach changes the order; the coach's own also get Urgent and ✕. */
function OrderButtons({ name, first, last, onMove, own }: {
  name: string; first: boolean; last: boolean; onMove: (by: -1 | 1) => void
  own: { urgent: boolean; onUrgent: () => void; onRemove: () => void } | null
}) {
  const { t } = useTranslation()
  const square = 'grid size-9 place-items-center rounded-lg border border-line bg-surface text-ink disabled:text-line-strong disabled:opacity-50'
  return <span className="flex flex-wrap gap-1.5">
    <button type="button" className={square} disabled={first} aria-label={t('coachHome:orderUp', { name })} onClick={() => onMove(-1)}>↑</button>
    <button type="button" className={square} disabled={last} aria-label={t('coachHome:orderDown', { name })} onClick={() => onMove(1)}>↓</button>
    {own && <button type="button" aria-pressed={own.urgent} onClick={own.onUrgent}
      className={`rounded-lg border px-3 text-[13px] font-medium ${own.urgent ? 'border-attention bg-attention text-ink' : 'border-line bg-surface text-ink-2'}`}>
      {t('coachHome:todoAddUrgent')}</button>}
    {own && <button type="button" className={square} aria-label={t('coachHome:orderRemove', { name })} onClick={own.onRemove}>✕</button>}
  </span>
}

/** TRAK-612: ticks one of the coach's own to-dos. */
function TickButton({ id }: { id: string }) {
  const { t } = useTranslation()
  const tick = useTickTodo()
  return <Button size={NEXT_STEP_SIZE} variant="secondary" className={NEXT_STEP_WIDTH} loading={tick.isPending}
    onClick={() => tick.mutate(id, { onError: () => toast.error(t('coachHome:todoTickFailed')) })}>{t('coachHome:todoDone')}</Button>
}

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** TRAK-612 (Kostas, 26 Nov): the dotted "Add a to-do" step. It opens in place: the words, Today / Tomorrow / Pick a date,
 *  and Urgent. Not linked to an event and not in + Create; only the coach sees it. */
function AddTodo({ today }: { today: string }) {
  const { t } = useTranslation()
  const add = useAddTodo()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [when, setWhen] = useState<'today' | 'tomorrow' | 'date'>('today')
  const [date, setDate] = useState(() => addDays(today, 2))
  const [urgent, setUrgent] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const dueOn = when === 'today' ? today : when === 'tomorrow' ? addDays(today, 1) : date
  const close = () => { setOpen(false); setText(''); setWhen('today'); setUrgent(false) }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim() || !dueOn || dueOn < today) return
    add.mutate({ title: text, dueOn, urgent }, {
      onSuccess: () => { setNote(dueOn === today ? null : t('coachHome:todoAddedFor', { day: evalDay(dueOn) })); close() },
      onError: () => toast.error(t('coachHome:todoAddFailed')),
    })
  }
  const chip = (pressed: boolean) => `rounded-full border px-3 py-1 text-[13px] font-medium ${pressed ? 'border-brand bg-brand text-on-brand' : 'border-line bg-surface text-ink-2'}`
  if (!open) return <li className="p-3 laptop:px-4">
    <button type="button" onClick={() => { setOpen(true); setNote(null) }}
      className="grid w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-3 rounded-xl border-[1.5px] border-dashed border-line-strong px-3 py-3 text-left text-[15px] font-medium text-ink-3 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span aria-hidden className="grid size-7 place-items-center rounded-full border-[1.5px] border-dashed border-line-strong text-base">+</span>{t('coachHome:todoAdd')}
    </button>
    {note && <p role="status" className="mt-2 px-1 text-sm font-medium text-success">{note}</p>}
  </li>
  return <li className="p-3 laptop:px-4">
    <form onSubmit={submit} aria-label={t('coachHome:todoAdd')} className="grid gap-3 rounded-xl border-[1.5px] border-dashed border-line-strong p-3">
      <input autoFocus value={text} maxLength={120} onChange={event => setText(event.target.value)} aria-label={t('coachHome:todoAddWhat')}
        placeholder={t('coachHome:todoAddWhat')} className="w-full rounded-xl border border-line bg-ground px-3 py-2.5 text-[16px] text-ink placeholder-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-primary" />
      <div role="group" aria-label={t('coachHome:todoAddWhen')} className="flex flex-wrap gap-2">
        {(['today', 'tomorrow', 'date'] as const).map(option => <button key={option} type="button" aria-pressed={when === option} className={chip(when === option)}
          onClick={() => setWhen(option)}>{t(option === 'today' ? 'coachHome:todoAddToday' : option === 'tomorrow' ? 'coachHome:todoAddTomorrow' : 'coachHome:todoAddPick')}</button>)}
      </div>
      {when === 'date' && <input type="date" value={date} min={today} onChange={event => setDate(event.target.value)} aria-label={t('coachHome:todoAddDate')}
        className="w-full rounded-xl border border-line bg-ground px-3 py-2 text-[16px] text-ink" />}
      <button type="button" aria-pressed={urgent} onClick={() => setUrgent(value => !value)}
        className={`flex items-center gap-2 justify-self-start rounded-full border px-3 py-1 text-[13px] font-medium ${urgent ? 'border-attention bg-attention/20 text-ink' : 'border-line bg-surface text-ink-2'}`}>
        <span aria-hidden className={`size-2.5 rounded-full border-[1.5px] border-attention ${urgent ? 'bg-attention' : ''}`} />{t('coachHome:todoAddUrgent')}
      </button>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={close}>{t('coachHome:todoAddCancel')}</Button>
        <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()}>{t('coachHome:todoAddSave')}</Button>
      </div>
    </form>
  </li>
}

/** TRAK-624 (Other events → To-do 4/6): a to-do added from an event says which event, as TRAK-615 does for trainings and
 *  matches: "Drinks · Sat 28 Nov · 19:00 · Café Nikos". A tap opens the event's sheet. A cancelled event says so first. */
function OwnEventLine({ row, coachId, onChanged }: { row: EventRow; coachId: string; onChanged: () => void }) {
  const { t } = useTranslation()
  const event = toPlayerEvent(row as unknown as Record<string, unknown>)
  const time = when(row)
  const cancelled = isCancelled(row)
  const text = [row.title, time?.date ? evalDay(time.date) : null, time?.time, row.venue ? venueParts(row.venue).text || null : null].filter(Boolean).join(' · ')
  const label = <>{cancelled && <span className="font-medium text-danger">{t('coachHome:noteCancelled')} · </span>}{text}</>
  if (!event) return <span className="text-sm text-ink-2">{label}</span>
  return <EventSheet event={event} role="coach" trigger={
    <button type="button" className="justify-self-start rounded text-left text-sm text-ink-2 underline decoration-line underline-offset-[3px] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      {label}
    </button>}>
    <EventSheetCoach event={event} coachId={coachId} onChanged={onChanged} />
  </EventSheet>
}

function SuggestionRow({ title, line, action }: { title: string; line: string; action: ReactNode }) {
  return <li className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 py-3 first:border-t-0">
    <span className="grid min-w-0"><span className="text-[15px] font-medium text-ink">{title}</span>{line && <span className="text-sm text-ink-3">{line}</span>}</span>
    <span>{action}</span>
  </li>
}

type T = ReturnType<typeof useTranslation>['t']

/** TRAK-609: what a to-do can preview, once there's something written: a plan, saved Notes, a drafted evaluation. */
function previewOf(todo: HomeTodoEvent['todo']): PreviewKind | null {
  if (todo.kind === 'training-plan') return todo.step === 'plan' ? null : 'training-plan'
  if (todo.kind === 'match-plan') return todo.step === 'plan' || todo.step === 'logistics' ? null : 'match-plan'
  if (todo.kind === 'notes') return todo.done ? 'notes' : null
  if (todo.kind === 'publish') return 'evaluation'
  return null
}

const TOGGLE: Record<PreviewKind, ['coachHome:previewPlanShow' | 'coachHome:previewNotesShow' | 'coachHome:previewEvaluationShow',
  'coachHome:previewPlanHide' | 'coachHome:previewNotesHide' | 'coachHome:previewEvaluationHide']> = {
  'training-plan': ['coachHome:previewPlanShow', 'coachHome:previewPlanHide'],
  'match-plan': ['coachHome:previewPlanShow', 'coachHome:previewPlanHide'],
  notes: ['coachHome:previewNotesShow', 'coachHome:previewNotesHide'],
  evaluation: ['coachHome:previewEvaluationShow', 'coachHome:previewEvaluationHide'],
}

function PreviewToggle({ kind, open, onToggle }: { kind: PreviewKind; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  return <button type="button" aria-expanded={open} onClick={onToggle}
    className="mt-1 justify-self-start rounded text-sm font-medium text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
    {t(TOGGLE[kind][open ? 1 : 0])} <span aria-hidden>{open ? '▴' : '▾'}</span>
  </button>
}
type Todo = HomeTodoEvent['todo']

const opponent = (row: EventRow | null) => row?.opponent || row?.title || ''
const when = (row: EventRow | null) => row ? phoneEventTime(row) : null

function title(todo: Todo, row: EventRow | null, t: T): string {
  switch (todo.kind) {
    case 'training-plan': return todo.step === 'plan' ? t('coachHome:todoNoTrainingPlan') : t('coachHome:todoTrainingPlan')
    case 'register': return t('coachHome:todoRegister')
    case 'notes': return t('coachHome:todoNotes')
    case 'match-plan': return todo.step === 'plan' || todo.step === 'logistics'
      ? t('coachHome:todoNoMatchPlan', { opponent: opponent(row) }) : t('coachHome:todoMatchPlan', { opponent: opponent(row) })
    case 'evaluate': return t('coachHome:todoEvaluate')
    case 'publish': return t('coachHome:todoPublish')
    case 'reports': return t('coachHome:reportsReady')
    case 'own': return todo.title ?? ''
    case 'next-training': {
      const day = row?.starts_at ? format(new Date(row.starts_at), 'EEEE', { locale: dateLocale() }) : ''
      return todo.step === 'share' ? t('coachHome:todoShareTraining', { day }) : t('coachHome:todoNextTraining', { day })
    }
    case 'next-match': return todo.step === 'logistics' ? t('coachHome:todoShareLogistics', { opponent: opponent(row) })
      : todo.step === 'plan' ? t('coachHome:todoWritePlan', { opponent: opponent(row) }) : t('coachHome:todoSharePlan', { opponent: opponent(row) })
  }
}

function line(todo: Todo, row: EventRow | null, t: T): string {
  const time = when(row)
  const event = [row?.event_type === 'match' ? null : row?.title, time?.time, row?.venue].filter(Boolean).join(' · ')
  switch (todo.kind) {
    case 'training-plan': return todo.step === 'plan' && time?.time ? t('coachHome:todoPlanBefore', { time: time.time }) : event
    case 'match-plan': return todo.step === 'plan' || todo.step === 'logistics'
      ? t('coachHome:todoWriteBefore', { time: time?.time ?? '' }) : event
    // TRAK-615 (Kostas, live check of 27 Nov): which match or training it's for, with its day, so two to-dos with the
    // same title (two matches to evaluate, two trainings' notes) are always told apart.
    case 'evaluate': case 'publish': return [row ? gameTitle(row) : null, time?.date ? evalDay(time.date) : null].filter(Boolean).join(' · ')
    case 'register': case 'notes': return [row?.title, time?.date ? evalDay(time.date) : null, time?.time].filter(Boolean).join(' · ')
    case 'reports': return t('coachHome:evaluationDueSince', { day: evalDay(new Date(todo.at).toISOString().slice(0, 10)) })
    case 'next-training': case 'next-match': return [time?.date ? evalDay(time.date) : null, time?.time].filter(Boolean).join(' · ')
    case 'own': return t('coachHome:todoAddedByYou')
    default: return event
  }
}

function action(todo: Todo, row: EventRow | null, { t, coachId, onChanged, onOpenReports }: { t: T; coachId: string; onChanged: () => void; onOpenReports: (squad: string | null) => void }) {
  const button = (label: string, onClick?: () => void, disabled = false) =>
    <Button size={NEXT_STEP_SIZE} className={NEXT_STEP_WIDTH} disabled={disabled} onClick={onClick}>{label}</Button>
  const pill = (label: string) => <span className="inline-flex rounded-full bg-success/10 px-2.5 py-1 text-sm font-medium text-success">{label}</span>
  if (todo.kind === 'own') return todo.done ? pill(t('coachHome:todoDoneShort')) : <TickButton id={todo.key.slice('own:'.length)} />
  if (!row && todo.kind !== 'reports') return null
  // Not yet: greyed, saying when it opens.
  if (!todo.done && todo.opensAt) {
    const label = todo.kind === 'register' ? t('coachHome:todoFrom', { time: hhmm(todo.opensAt) })
      : todo.kind === 'evaluate' ? t('coachHome:todoAfterFullTime') : t('coachHome:todoAfter', { time: hhmm(todo.opensAt) })
    return button(label, undefined, true)
  }
  switch (todo.kind) {
    case 'training-plan':
      if (todo.step === 'shared') return pill(t('coachHome:todoShared'))
      return <Go to={planPath(row!.id)} label={todo.step === 'plan' ? t('coachHome:todoPlanTraining') : t('coachHome:share')} />
    // TRAK-611: a planned training still a draft is shared from its plan's Review & share, which publishes it first.
    case 'next-training': return <Go to={planPath(row!.id)} label={todo.step === 'share' ? t('coachHome:share') : t('coachHome:todoPlanTraining')} />
    case 'register':
      if (todo.done) return pill(t('coachHome:todoSaved'))
      return <NextStep item={weekItem(row!, 'register')} coachId={coachId} roster={undefined} onChanged={onChanged} />
    case 'notes':
      if (todo.done) return pill(t('coachHome:todoSaved'))
      return <Go to={herePath(row!.id)} label={t('coachHome:todoWriteNotes')} />
    case 'match-plan':
      if (todo.done) return pill(t('coachHome:todoShared'))
      return <MatchAction state={todo.step as never} eventId={row!.id} />
    case 'next-match': return <MatchAction state={todo.step as never} eventId={row!.id} />
    case 'evaluate':
      if (todo.done) return pill(t('coachHome:todoSaved'))
      return <MatchAction state="fullTime" eventId={row!.id} />
    case 'publish':
      if (todo.done) return pill(t('coachHome:todoPublished'))
      return <MatchAction state="evaluationDraft" eventId={row!.id} />
    case 'reports': return button(t('coachHome:open'), () => onOpenReports(todo.squad))
  }
}

function Go({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate()
  return <Button size={NEXT_STEP_SIZE} className={NEXT_STEP_WIDTH} onClick={() => navigate(to)}>{label}</Button>
}

/** The week's next step reads a week item; the register needs only its event's row. */
const weekItem = (row: EventRow, step: 'register'): WeekItem => ({
  id: row.id, date: row.event_date ?? '', kind: 'training', title: row.title, time: phoneEventTime(row).time,
  state: 'needs-you', note: '', step, source: row as unknown as Record<string, unknown>, row,
})
