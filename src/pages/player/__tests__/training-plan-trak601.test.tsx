/**
 * TRAK-601 (coach–player P13): a squad's players read their training's plan (Imad, 27 Nov: drills and set-up). The event
 * page shows what the training works on, each drill with its set-up and, for Trak's drills, its picture, and one Got it
 * for the whole plan, asked again (Updated) after the coach changes it. Home's week says "Plan ready" and the sheet says
 * what the training works on; a past training links to its plan; My tasks' Got it opens the plan. Coaching points never
 * show, even if the database sent them. Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL, rpc, rpcRows, table } from '../../../../tests/msw/supabase'
import type { MyTask } from '@/lib/tasks'

let n = 0
let PLAYER = { id: 'plan-player' }
let task: MyTask | null
let calls: string[]
let planReads: string[]
const today = new Date().toLocaleDateString('en-CA')
const TRAINING = { id: 'tuesday', event_type: 'training', title: 'Finishing', event_date: today, start_time: '23:30:00', status: 'scheduled' }
const MATCH = { id: 'saturday', event_type: 'match', title: 'vs Parkview', opponent: 'Parkview', event_date: today, start_time: '23:45:00', status: 'scheduled' }
// As my_training_plans sends them, plus a coaching point and a note the database never sends: they must never show.
const PLAN = [
  { event_id: 'tuesday', event_date: today, session_id: 's1', position: 1, part: 'Warm-up', name: 'Tag games', minutes: 10, how: 'Two taggers.\nSwap every minute.',
    area: '', numbers: '', direction: '', targets: '', conditions: '', trak_drill: 'lib-tag-games', trak_level: 4, tell: 'SECRET coaching point' },
  { event_id: 'tuesday', event_date: today, session_id: 's1', position: 2, part: 'Passing', name: 'Triangle passing', minutes: 15, how: 'Groups of three, 10 m apart.',
    area: '20 x 20 m', numbers: '3 per group', direction: '', targets: '', conditions: '', trak_drill: null, trak_level: null, note: 'SECRET note' },
]
const planTask = (over: Partial<MyTask> = {}): MyTask => ({ task_id: 'plan-task', title: 'Training plan: Finishing', source_type: 'training_plan',
  source_id: 'tuesday', answer_kind: 'got_it', due_at: null, time_zone: 'Asia/Dubai', answered: false, outdated: false, ...over })

/** my_training_plans with PostgREST's filters applied (event_id, position), as the database would. */
const plans = (rows: Record<string, unknown>[]) => http.post(`${SUPABASE_URL}/rest/v1/rpc/my_training_plans`, ({ request }) => {
  const query = new URL(request.url).searchParams
  const eq = (key: string) => query.get(key)?.replace(/^eq\./, '')
  planReads.push(eq('event_id') ?? 'all')
  return HttpResponse.json(rows.filter(row => [['event_id', eq('event_id')], ['position', eq('position')]]
    .every(([key, value]) => value === undefined || String(row[key!]) === value)))
})

beforeEach(() => {
  localStorage.clear()
  PLAYER = { id: `plan-player-${++n}` }
  task = planTask()
  calls = []
  planReads = []
  signInAs(PLAYER)
  server.use(
    table('profiles', [{ user_id: PLAYER.id, role: 'player', full_name: 'Angelos Charisteas' }]),
    table('player_details', [{ position: 'Forward', current_club: 'Rehearsal FC', age_group: 'U16' }]),
    table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1' }]), table('coach_assessments', []),
    table('coach_shared_feedback', []), table('game_for_family', []), table('game_for_player', []),
    table('game_review_for_family', []), table('matches', []), table('event_absences', []),
    rpcRows('child_events', [TRAINING]), rpcRows('season_plan_for_player', []),
    rpcRows('family_academy', [{ name: 'Rehearsal FC', logo_url: null }]), rpcRows('child_training_attendance', []),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('my_session_is_live', () => true),
    rpc('family_feature_on', ({ p_feature }) => p_feature === 'family_look'),
    rpc('my_tasks', () => (task ? [task] : [])),
    rpc('respond_to_task', ({ p_task_id }) => { calls.push(`got_it:${p_task_id}`); task = { ...task!, answered: true, outdated: false }; return null }),
    rpc('undo_task_response', ({ p_task_id }) => { calls.push(`undo:${p_task_id}`); task = { ...task!, answered: false }; return null }),
    plans(PLAN),
  )
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const planCard = () => screen.findByRole('region', { name: 'Training plan' }, { timeout: 5000 })

describe('TRAK-601: the squad reads its training plan', { timeout: 20_000 }, () => {
  it('the training\'s page shows what it works on, each drill\'s set-up and details, and a Trak drill\'s picture', async () => {
    renderApp('/player/event/tuesday')
    const card = await planCard()
    expect(within(card).getByText('What we’re working on').nextElementSibling).toHaveTextContent('Warm-up · Passing')
    const [tag, triangle] = within(card).getAllByRole('listitem').filter(li => li.parentElement?.tagName === 'OL')
    expect(within(tag).getByRole('heading', { name: 'Tag games' })).toBeInTheDocument()
    expect(within(tag).getByText('Warm-up · 10 min')).toBeInTheDocument()
    expect(within(tag).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Two taggers.', 'Swap every minute.'])
    expect(tag.querySelector('svg')).not.toBeNull()
    expect(within(triangle).getByText('20 x 20 m · 3 per group')).toBeInTheDocument()
    expect(triangle.querySelector('svg')).toBeNull()
    expect(screen.queryByText(/SECRET/)).toBeNull()
  })

  it('a training without a plan shows no plan, and a match never asks for one', async () => {
    server.use(plans([]))
    renderApp('/player/event/tuesday')
    await screen.findAllByText('Finishing', {}, { timeout: 5000 })
    await waitFor(() => expect(planReads).toContain('tuesday'))
    expect(screen.queryByRole('region', { name: 'Training plan' })).toBeNull()
    cleanup()
    planReads = []
    server.use(rpcRows('child_events', [MATCH]))
    renderApp('/player/event/saturday')
    await screen.findAllByText('vs Parkview', {}, { timeout: 5000 })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(planReads).not.toContain('saturday')
  })

  it('one Got it for the whole plan, then Undo', async () => {
    renderApp('/player/event/tuesday')
    const card = await planCard()
    await userEvent.click(await within(card).findByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(calls).toEqual(['got_it:plan-task']))
    await userEvent.click(await within(card).findByRole('button', { name: 'Undo Got it' }))
    await waitFor(() => expect(calls).toEqual(['got_it:plan-task', 'undo:plan-task']))
    expect(await within(card).findByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('a plan the coach changed after the Got it says Updated and asks again', async () => {
    task = planTask({ answered: true, outdated: true })
    renderApp('/player/event/tuesday')
    const card = await planCard()
    expect(await within(card).findByText('Updated')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('Home\'s week says Plan ready, and the sheet says what the training works on', async () => {
    renderApp('/player/home')
    expect(await screen.findByRole('button', { name: /^Finishing, / }, { timeout: 5000 })).toHaveAccessibleName(/, Plan ready$/)
    await userEvent.click(screen.getByRole('button', { name: 'Details' }))
    const sheet = await screen.findByRole('dialog')
    expect(await within(sheet).findByText('Warm-up · Passing')).toBeInTheDocument()
  })

  it('My tasks\' Got it for a plan opens the plan', async () => {
    renderApp('/player/home')
    const link = await screen.findByRole('link', { name: 'Training plan: Finishing' }, { timeout: 5000 })
    expect(link).toHaveAttribute('href', '/player/event/tuesday')
  })

  it('a past training links to its plan from Trainings', async () => {
    server.use(rpcRows('family_training_history', [
      { session_id: 's1', session_date: '2026-11-24', focus: null, attendance: 'present' },
      { session_id: 's2', session_date: '2026-11-20', focus: null, attendance: 'present' },
      { session_id: 's3', session_date: '2026-11-17', focus: null, attendance: 'present' },
    ]))
    renderApp('/player/trainings')
    const link = await screen.findByRole('link', { name: 'Plan' }, { timeout: 5000 })
    expect(link).toHaveAttribute('href', '/player/event/tuesday')
    expect(screen.getAllByRole('link', { name: 'Plan' })).toHaveLength(1)
  })
})
