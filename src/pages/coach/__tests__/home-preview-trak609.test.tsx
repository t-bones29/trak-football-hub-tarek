/**
 * TRAK-609 (New Home 3/8, spec TRAK-606): a to-do's Preview dropdown in place of a View button. A plan that exists, saved
 * Notes and a drafted evaluation each get one; it starts closed and reads only when opened. Test people are named after
 * footballers. The academy has no time zone set, so its days are Dubai's (UTC+4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

// Midday on a Wednesday; today's events are later in the day.
const NOW = new Date('2026-11-04T12:00:00Z')
// Times are UTC, whatever the machine's time zone.
const at = (iso: string) => new Date(`${iso}:00Z`)
let n = 0
let COACH = { id: 'coach-304' }

function event(id: string, type: 'training' | 'match', starts: string, over: Record<string, unknown> = {}) {
  const start = at(starts)
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `Training ${id}`, event_type: type, published: true, status: 'scheduled',
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 90 * 60_000).toISOString(),
    event_date: starts.slice(0, 10), start_time: `${starts.slice(11, 16)}:00`, venue: 'Pitch 2', opponent: null, home_away: null, ...over,
  }
}
const practice = (event_id: string, position: number, name: string, minutes: number, part = '') => ({
  event_id, position, name, minutes, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, part,
})

function home({ events, practices = [], gamePlans = [], features = ['events', 'training', 'games'] }: {
  events: Record<string, unknown>[]; practices?: Record<string, unknown>[]; gamePlans?: Record<string, unknown>[]; features?: string[]
}) {
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC' }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' }]),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('notification_settings', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', ({ p_feature }) => features.includes(String(p_feature))),
    table('training_notes', []),
    table('game_evaluations', []),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const type = new URL(request.url).searchParams.get('event_type')?.replace(/^eq\./, '')
      return HttpResponse.json(type ? events.filter(e => e.event_type === type) : events)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plans`, () =>
      HttpResponse.json([...new Set(practices.map(p => p.event_id))].map(event_id => ({ event_id, updated_at: '2026-11-01T10:00:00Z' })))),
    table('training_plan_practices', practices),
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('event_id')?.replace(/^eq\./, '')
      return HttpResponse.json(id ? gamePlans.filter(p => p.event_id === id) : gamePlans)
    }),
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  COACH = { id: `coach-304-${++n}` }
  signInAs(COACH)
})
afterEach(() => { vi.useRealTimers(); cleanup(); forgetScreens(); localStorage.clear() })

const todo = () => screen.findByRole('region', { name: 'To-do' }, { timeout: 5000 })
const rowOf = async (text: string | RegExp) => (await within(await todo()).findByText(text, {}, { timeout: 5000 })).closest('li')!
const open = async (row: HTMLElement, name: RegExp) => {
  const toggle = within(row).getByRole('button', { name })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await userEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

describe('TRAK-609: previews on the To-do', { timeout: 20_000 }, () => {
  it("today's training plan: each part, its drill and minutes, then the total; no View button", async () => {
    home({ events: [event('t1', 'training', '2026-11-04T16:00', { training_themes: ['attacking', 'transition'] })],
      practices: [practice('t1', 1, 'Rondos 4v1', 15, 'Warm-up'), practice('t1', 2, 'Press on the back pass', 30, 'Main part')] })
    renderApp('/coach/home')
    const row = await rowOf("Today's training plan")
    expect(within(row).queryByRole('list', { name: 'The plan' })).toBeNull()
    await open(row, /Preview plan/)
    const box = await within(row).findByLabelText('The plan', {}, { timeout: 5000 })
    expect(await within(box).findByText('Rondos 4v1')).toBeInTheDocument()
    expect(within(box).getByText('Warm-up')).toBeInTheDocument()
    expect(within(box).getByText('Main part')).toBeInTheDocument()
    expect(within(box).getByText('45 min')).toBeInTheDocument()
    expect(within(box).getByText('Attacking, Transition')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Hide plan/ })).toBeInTheDocument()
    expect(within(await todo()).queryByRole('button', { name: /^View/ })).toBeNull()
  })

  it('no plan yet, no preview', async () => {
    home({ events: [event('t1', 'training', '2026-11-04T16:00')] })
    renderApp('/coach/home')
    const row = await rowOf("No plan for today's training yet")
    expect(within(row).queryByRole('button', { name: /Preview/ })).toBeNull()
  })

  it("a match's plan: formation, line-up and goals", async () => {
    home({ events: [event('m1', 'match', '2026-11-04T15:00', { title: 'League', opponent: 'Parkview Athletic' })],
      gamePlans: [{ event_id: 'm1', formation: '4-3-3', format: 11, goals: [{ title: 'Press high' }, { title: 'Switch play fast' }], updated_at: '2026-11-03T10:00:00Z' }] })
    server.use(table('game_plan_players', [
      { squad_player_id: 'a', role: 'starter' }, { squad_player_id: 'b', role: 'starter' }, { squad_player_id: 'c', role: 'bench' },
    ]))
    renderApp('/coach/home')
    const row = await rowOf('Match plan for Parkview Athletic')
    await open(row, /Preview plan/)
    const box = await within(row).findByLabelText('The plan', {}, { timeout: 5000 })
    expect(await within(box).findByText('4-3-3')).toBeInTheDocument()
    expect(within(box).getByText('2 picked · 1 on the bench')).toBeInTheDocument()
    expect(within(box).getByText('Press high')).toBeInTheDocument()
  })

  it('saved notes: who came, the note and whether to run it again', async () => {
    home({ events: [event('t1', 'training', '2026-11-04T08:00')], practices: [practice('t1', 1, 'Rondos 4v1', 15)] })
    server.use(
      table('coach_sessions', [{ id: 's1', event_id: 't1', created_at: '2026-11-04T09:40:00Z' }]),
      table('session_attendance', [{ session_id: 's1', status: 'present' }, { session_id: 's1', status: 'present' }]),
      table('training_notes', [{ event_id: 't1', again: 'changes', note: 'Good pressing', created_at: '2026-11-04T09:45:00Z' }]),
    )
    renderApp('/coach/home')
    const row = await rowOf('Write session notes')
    await open(row, /Preview notes/)
    const box = await within(row).findByLabelText('The notes', {}, { timeout: 5000 })
    expect(await within(box).findByText('Good pressing')).toBeInTheDocument()
    expect(within(box).getByText('Yes, with changes')).toBeInTheDocument()
    expect(await within(box).findByText('2 came')).toBeInTheDocument()
  })

  it('a drafted evaluation: the score and how many played', async () => {
    home({ events: [event('m1', 'match', '2026-11-03T15:00', { title: 'League', opponent: 'Parkview Athletic' })] })
    server.use(
      table('game_evaluations', [{ event_id: 'm1', saved_at: '2026-11-03T18:00:00Z', published_at: null, remind_at: '2026-11-04T05:00:00Z',
        our_score: 2, their_score: 1, goals: [], how_they_scored: '', plan_worked: {} }]),
      table('game_evaluation_players', [{ squad_player_id: 'a', played: true }, { squad_player_id: 'b', played: true }, { squad_player_id: 'c', played: false }]),
      table('game_evaluation_notes', []),
    )
    renderApp('/coach/home')
    const row = await rowOf('Publish the evaluation')
    await open(row, /Preview evaluation/)
    const box = await within(row).findByLabelText('The evaluation', {}, { timeout: 5000 })
    expect(await within(box).findByText('2–1')).toBeInTheDocument()
    expect(within(box).getByText('2 played')).toBeInTheDocument()
  })
})
