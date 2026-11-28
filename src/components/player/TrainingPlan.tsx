import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/arc/badge/badge'
import { Button } from '@/components/arc/button/button'
import { LoadError } from '@/components/trak/LoadError'
import { DrillPitch } from '@/components/coach/training/library/DrillPitch'
import { useTranslation } from '@/lib/i18n'
import { FALLBACK_PLAYERS, START_LEVEL, libraryDrill } from '@/lib/training/library'
import { ANSWER, useAnswerTask, useMyTasks } from '@/lib/tasks'
import { planTask, usePlayerPlan, workingOn, type PlanPractice } from '@/lib/player-plans'
import type { PlayerEvent } from '@/lib/player-events'

/* TRAK-601 (coach–player P13, Makis's list of 23 Nov; Imad, 27 Nov: drills and set-up): a training's plan as its squad's
   players read it. One Got it for the whole plan, at the top: Updated and asked again after the coach saves a change,
   Undo until the training starts. "What we're working on" is the plan's parts. Each practice: its part and minutes, the
   drill, its picture when it's one of Trak's, the set-up and its details. Nothing for a training without a plan, or
   where the academy has tasks off. */

export function TrainingPlan({ event }: { event: PlayerEvent }) {
  const { t } = useTranslation()
  const plan = usePlayerPlan(event.kind === 'training' ? event.id : null)
  if (event.kind !== 'training') return null
  if (plan.isError) return <LoadError what="the training plan" onRetry={() => plan.refetch()} retrying={plan.isFetching} />
  if (!plan.data?.length) return null
  return <section aria-labelledby="training-plan" className="arc grid gap-4 rounded-2xl border border-line bg-surface p-5 laptop:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="training-plan" className="text-lg font-medium text-ink">{t('common:trainingPlan')}</h2>
      <GotIt eventId={event.id} />
    </div>
    <div className="grid gap-1">
      <h3 className="text-sm text-ink-3">{t('common:workingOn')}</h3>
      <p className="text-[15px] font-medium text-ink">{workingOn(plan.data)}</p>
    </div>
    <ol className="grid gap-4">{plan.data.map(practice => <Practice key={practice.position} practice={practice} />)}</ol>
  </section>
}

/** The event sheet's line: what the training works on, when it has a plan. */
export function PlanInSheet({ event }: { event: PlayerEvent }) {
  const { t } = useTranslation()
  const plan = usePlayerPlan(event.kind === 'training' ? event.id : null)
  if (event.kind !== 'training' || !plan.data?.length) return null
  return <div className="grid gap-1 text-[14px]">
    <p className="text-ink-3">{t('common:workingOn')}</p>
    <p className="font-medium text-ink">{workingOn(plan.data)}</p>
  </div>
}

function GotIt({ eventId }: { eventId: string }) {
  const { t } = useTranslation()
  const task = planTask(useMyTasks().data, eventId)
  const answer = useAnswerTask()
  if (!task) return null
  const send = (undo: boolean) => answer.mutate({ taskId: task.task_id, undo }, { onError: () => toast("That didn't save. Try again.") })
  return <span className="flex items-center gap-3">
    {task.outdated && <Badge tone="info" size="sm">{t('common:updated')}</Badge>}
    {!task.answered || task.outdated
      ? <Button size="sm" onClick={() => send(false)}>{ANSWER.got_it}</Button>
      : <>
        <span className="flex items-center gap-1.5 text-sm font-medium text-ink"><Check size={16} aria-hidden="true" />{ANSWER.got_it}</span>
        <Button size="sm" variant="ghost" aria-label={`Undo ${ANSWER.got_it}`} onClick={() => send(true)}>Undo</Button>
      </>}
  </span>
}

function Practice({ practice: p }: { practice: PlanPractice }) {
  const { t } = useTranslation()
  const drill = libraryDrill(p.trak_drill)
  const details = [p.area, p.numbers, p.direction, p.targets, p.conditions].filter(Boolean).join(' · ')
  return <li className="grid gap-2 border-t border-line pt-4">
    <p className="text-sm text-ink-3">{[p.part, t('coachHome:minutes', { count: p.minutes })].filter(Boolean).join(' · ')}</p>
    <h3 className="text-base font-medium text-ink">{p.name}</h3>
    {/* ponytail: drawn for a squad of 15, as a drill whose squad size isn't known; the coach's own squad size if it differs much. */}
    {drill && <div className="max-w-sm overflow-hidden rounded-xl"><DrillPitch drill={drill} players={FALLBACK_PLAYERS} level={p.trak_level ?? START_LEVEL} variant="card" /></div>}
    {p.how && <ul className="grid list-disc gap-1 pl-5 text-[15px] text-ink-2">{p.how.split('\n').filter(line => line.trim()).map((line, i) => <li key={i}>{line}</li>)}</ul>}
    {details && <p className="text-sm text-ink-3">{details}</p>}
  </li>
}
