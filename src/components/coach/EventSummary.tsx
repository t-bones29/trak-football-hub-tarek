import { KitAnnouncement } from '@/components/trak/kits/KitAnnouncement'
import { describeEventKit } from '@/lib/kit-templates'
import { splitVenue } from '@/lib/venue-link'
import { eventTitle, formatEventDay, repeatProblem, type EventForm, type Repeat } from '@/lib/coach-events'
import { KIND_WORD, THEME_WORD, WEEKDAY_WORD } from '@/lib/event-edit'
import { useTranslation } from '@/lib/i18n'

/* TRAK-283: Schedule's Review rows, in their own file so a game's Logistics (Games) shows the same rows without
   loading the Schedule page. */

const font = { fontFamily: 'var(--t-font)' }

/** Review: everything the save writes, in the order the steps asked for it. */
export function EventSummary({ form, repeat, noteProblem, squad }: {
  form: EventForm; repeat: Repeat | null; noteProblem: 'link' | 'name' | null
  /** Imad, 24 Oct: for a coach with two squads or more, which squad it's for. */
  squad?: string
}) {
  const { t } = useTranslation()
  const notSet = t('coachSchedule:notSet')
  // TRAK-635: every picked theme, in the order the seven are listed.
  const themeWords = form.themes.map(key => t(THEME_WORD[key])).join(', ')
  const rows: [string, string][] = [
    ...(squad ? [[t('nav:squad'), squad] as [string, string]] : []),
    [t('coachSchedule:summaryType'), t(KIND_WORD[form.kind])],
    ...(form.kind === 'training' ? [[t(form.themes.length > 1 ? 'coachSchedule:themes' : 'coachSchedule:theme'), themeWords || notSet] as [string, string]] : []),
    ...(form.kind === 'match' ? [[t('coachSchedule:opponent'), form.opponent.trim() + (form.homeAway ? ` (${form.homeAway === 'home' ? t('coachSchedule:home') : t('coachSchedule:away')})` : '')] as [string, string]] : []),
    [t('coachSchedule:summaryTitle'), eventTitle(form)],
    // TRAK-255: the name, and whether it has a map link; never the link itself.
    [t('coachSchedule:venue'), (() => { const v = splitVenue(form.venue); return (v.name.trim() || (v.link ? t('coachSchedule:unnamedPlace') : notSet)) + (v.link ? t('coachSchedule:onTheMap') : '') })()],
    [repeat?.on ? t('coachSchedule:firstDate') : t('coachSchedule:date'), form.date ? formatEventDay(form.date) : notSet],
    [form.kind === 'match' ? t('coachSchedule:kickoff') : t('coachSchedule:start'), form.time || notSet],
    [t('coachSchedule:meet'), form.meetTime || t('coachSchedule:atTheStart')],
    [t('coachSchedule:length'), t('coachSchedule:lengthMinutes', { count: form.duration })],
    ...(repeat?.on && form.kind !== 'match' && !repeatProblem(form, repeat)
      ? [[t('coachSchedule:repeats'), t('coachSchedule:repeatsUntil', { days: repeat.days.map(d => t(WEEKDAY_WORD[d])).join(', '), day: formatEventDay(repeat.until) })] as [string, string]] : []),
    [t('coachSchedule:kit'), form.kitSnapshot ? describeEventKit(form.kitSnapshot) : form.kit.trim() || t('coachSchedule:none')],
    [t('coachSchedule:messageToPlayers'), form.familyNote.trim() || t('coachSchedule:none')],
  ]
  return <>
    <dl className="rounded-2xl border border-line divide-y divide-line" style={font}>
      {rows.map(([term, value]) => (
        <div key={term} className="flex gap-3 px-3 py-2.5 text-[13px]">
          <dt className="w-[38%] shrink-0 text-ink-3">{term}</dt>
          <dd className="flex-1 min-w-0 text-ink break-words">{value}</dd>
        </div>
      ))}
    </dl>
    {form.kitSnapshot && <KitAnnouncement kit={form.kitSnapshot.design} slot={form.kitSnapshot.slot} animated={false} />}
    {noteProblem && (
      <p role="status" className="text-[11px] text-warning" style={font}>
        {noteProblem === 'link' ? t('coachSchedule:messageHiddenLink') : t('coachSchedule:messageHiddenName')}
      </p>
    )}
  </>
}
