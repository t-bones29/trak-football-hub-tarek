import type { ReactNode } from 'react'
import { LoadError } from '@/components/trak/LoadError'
import { LoadingSkeleton } from '@/components/trak/LoadingSkeleton'
import { useGameEvaluation, useGamePlan, useGamePlayers } from '@/components/coach/games/useGames'
import { useHere, useNotes, usePlan, useRegisters } from '@/components/coach/training/useTraining'
import { fromSaved, plannedMinutes, practiceLine } from '@/lib/training/plans'
import { THEME_WORD } from '@/lib/event-edit'
import { trainingThemesFrom } from '@/lib/training-theme'
import { useTranslation } from '@/lib/i18n'

/* TRAK-609 (New Home 3/8, spec TRAK-606): a to-do's Preview dropdown, in place of a View button (Kostas, 26 Nov). It
   reads only when opened, and only what the coach already sees: a training's parts and minutes, a match's formation,
   line-up and goals, a training's Notes, a match's evaluation. */

export type PreviewKind = 'training-plan' | 'match-plan' | 'notes' | 'evaluation'

export function TodoPreview({ kind, eventId, themes }: { kind: PreviewKind; eventId: string; themes?: readonly string[] }) {
  if (kind === 'training-plan') return <TrainingPlan eventId={eventId} themes={themes ?? []} />
  if (kind === 'match-plan') return <MatchPlan eventId={eventId} />
  if (kind === 'notes') return <Notes eventId={eventId} />
  return <Evaluation eventId={eventId} />
}

function Box({ label, children }: { label: string; children: ReactNode }) {
  return <dl aria-label={label} className="mt-2 grid max-w-[460px] gap-0 rounded-xl border border-line bg-raised px-3 text-[14px]">{children}</dl>
}
function Row({ name, value, end }: { name: string; value: ReactNode; end?: ReactNode }) {
  return <div className="grid grid-cols-[84px_minmax(0,1fr)_auto] items-baseline gap-3 border-t border-line py-2 first:border-t-0">
    <dt className="text-xs font-semibold text-ink-3">{name}</dt>
    <dd className="min-w-0 text-ink">{value}</dd>
    {end ? <dd className="text-[13px] tabular-nums text-ink-3">{end}</dd> : <span />}
  </div>
}
function Waiting({ query, what }: { query: { isError: boolean; refetch: () => unknown }; what: string }) {
  const { t } = useTranslation()
  return query.isError ? <div className="mt-2"><LoadError what={what} onRetry={() => void query.refetch()} /></div>
    : <LoadingSkeleton label={t('coachHome:previewLoading')} lines={2} className="mt-2 max-w-[460px] rounded-xl bg-raised p-3" />
}

function TrainingPlan({ eventId, themes }: { eventId: string; themes: readonly string[] }) {
  const { t } = useTranslation()
  // TRAK-635: the training's themes in words, not their stored keys.
  const themeWords = trainingThemesFrom(themes).map(key => t(THEME_WORD[key])).join(', ')
  const plan = usePlan(eventId)
  if (!plan.data) return <Waiting query={plan} what={t('coachHome:planWhat')} />
  const practices = fromSaved(plan.data.practices)
  return <Box label={t('coachHome:previewPlan')}>
    {practices.map((practice, i) => <Row key={i} name={practice.part || t('coachHome:previewPart', { n: i + 1 })} value={practice.part ? practice.name : practiceLine(practice)}
      end={t('coachHome:minutes', { count: practice.minutes })} />)}
    <Row name={t('coachHome:previewTotal')} value={<span className="text-ink-3">{themeWords}</span>} end={t('coachHome:minutes', { count: plannedMinutes(practices) })} />
  </Box>
}

function MatchPlan({ eventId }: { eventId: string }) {
  const { t } = useTranslation()
  const plan = useGamePlan(eventId)
  const players = useGamePlayers(eventId)
  if (plan.data === undefined || !players.data) return <Waiting query={plan.isError ? plan : players} what={t('coachHome:planWhat')} />
  const goals = Array.isArray(plan.data?.goals) ? (plan.data!.goals as { title?: string }[]).map(g => g.title?.trim()).filter(Boolean) as string[] : []
  const starters = players.data.filter(p => p.role === 'starter').length, bench = players.data.filter(p => p.role === 'bench').length
  return <Box label={t('coachHome:previewPlan')}>
    {plan.data?.formation && <Row name={t('coachHome:formation')} value={plan.data.formation} />}
    <Row name={t('coachHome:previewLineup')} value={t('coachHome:previewLineupCount', { starters, bench })} />
    {goals.length > 0 && <Row name={t('coachHome:goals')} value={<ul className="grid gap-0.5">{goals.map(goal => <li key={goal}>{goal}</li>)}</ul>} />}
  </Box>
}

function Notes({ eventId }: { eventId: string }) {
  const { t } = useTranslation()
  const notes = useNotes()
  const registers = useRegisters()
  const sessionId = registers.data?.get(eventId)
  const here = useHere(sessionId ? [sessionId] : [])
  if (!notes.data || !registers.data) return <Waiting query={notes.isError ? notes : registers} what={t('coachHome:notesWhat')} />
  const note = notes.data.get(eventId)
  const again = note?.again ? t(`coachTraining:${({ yes: 'againYes', changes: 'againChanges', no: 'againNo' } as const)[note.again]}`) : null
  const came = sessionId ? here.data?.get(sessionId) : undefined
  return <Box label={t('coachHome:previewNotes')}>
    {came !== undefined && <Row name={t('coachHome:previewCame')} value={t('coachHome:previewCameCount', { count: came })} />}
    {note?.note && <Row name={t('coachHome:previewNote')} value={note.note} />}
    <Row name={t('coachHome:previewAgain')} value={again ?? t('coachHome:previewSkipped')} />
  </Box>
}

function Evaluation({ eventId }: { eventId: string }) {
  const { t } = useTranslation()
  const evaluation = useGameEvaluation(eventId)
  if (!evaluation.data) return <Waiting query={evaluation} what={t('coachHome:evaluationWhat')} />
  const { evaluation: saved, players } = evaluation.data
  const score = saved && saved.our_score !== null && saved.their_score !== null ? `${saved.our_score}–${saved.their_score}` : '–'
  return <Box label={t('coachHome:previewEvaluation')}>
    <Row name={t('coachHome:previewScore')} value={score} />
    <Row name={t('coachHome:previewPlayed')} value={t('coachHome:previewPlayedCount', { count: players.filter(p => p.played).length })} />
  </Box>
}
