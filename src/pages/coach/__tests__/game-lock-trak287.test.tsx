/**
 * TRAK-287 (Games 5/8): locked at kick-off. With the page open, the plan turns read-only at kick-off, with no reload:
 * Save and Share go, and the pickers show their choice in words. Home's plan card closes at kick-off too. TRAK-372
 * (Imad, 5 Nov): no alert; what was written reads as written, with no text boxes, and nothing written says so. Test
 * people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
let n = 0
let COACH = { id: 'coach-287' }

/** A match kicking off `ms` from now (negative: it has), on the academy's clock (Dubai, UTC+4). */
function game(ms: number) {
  const kickOff = Date.now() + ms
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 19)}`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })
const PLAN = {
  event_id: 'g1', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: 'Their 9 is quick.', format: 11, formation: '4-4-2',
  goals: [{ title: 'Win the second ball', looks_like: 'First to every loose ball in midfield.' }],
  created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z',
}
const LINE_UP = [{ event_id: 'g1', squad_player_id: 'zagorakis', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
  note: 'Second game at right-back. Proud of you.', context: ['out_of_position'], expectation: 'stretch' }]

function setup({ kickOffIn, shared = false, changes = [] as string[] }: { kickOffIn: number; shared?: boolean; changes?: string[] }) {
  server.use(
    table('coach_calendar_events', [game(kickOffIn)]),
    table('game_plans', [PLAN]),
    table('game_plan_players', LINE_UP),
    table('game_shares', shared ? [{ event_id: 'g1', shared_at: '2026-10-27T15:30:00Z' }] : []),
    rpc('game_plan_changes', () => changes.map(squad_player_id => ({ event_id: 'g1', squad_player_id }))),
    // A write here would mean the page still lets the coach change a locked plan.
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, () => { throw new Error('a locked plan was written') }),
  )
}

beforeEach(() => {
  COACH = { id: `coach-287-${++n}` }
  signInAs(COACH)
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('zagorakis', 'Theodoros Zagorakis', 7), child('charisteas', 'Angelos Charisteas', 9)]),
    table('event_confirmations', []),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    table('training_plans', []),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    // TRAK-358: Can also play, for Out of position on the line-up; nobody has one.
    table('squad_player_also_plays', []),
    table('squad_player_roles', []),
  )
})
afterEach(() => { vi.useRealTimers(); cleanup(); localStorage.clear() })

describe('TRAK-287: locked at kick-off', { timeout: 30_000 }, () => {
  it('with the page open, kick-off turns the plan read-only, with no reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({ kickOffIn: 30_000 })
    renderApp('/coach/matches/g1?tab=plan')
    const goal = await screen.findByRole('textbox', { name: 'Instruction' })
    expect(goal).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /^How strong are/ })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull())
    expect(screen.queryByText(/^Locked at kick-off, \d\d:\d\d$/)).toBeNull()
    expect(screen.queryByText(/Jobs and expectations are fixed/)).toBeNull()
    // TRAK-372: written, not boxes.
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).queryAllByRole('textbox')).toEqual([])
    expect(within(panel).getByText('Win the second ball')).toBeInTheDocument()
    expect(within(panel).getByText('First to every loose ball in midfield.')).toBeInTheDocument()
    expect(within(panel).getByText('Their 9 is quick.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add instruction|Remove instruction/ })).toBeNull()
    // The pickers show their choice in words.
    expect(screen.queryByRole('group', { name: /^How strong are/ })).toBeNull()
    expect(screen.getByText('Similar')).toBeInTheDocument()
  })

  it('locked as a draft, the review says it was never shared, and Share is gone', async () => {
    const user = userEvent.setup()
    setup({ kickOffIn: -MINUTE })
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const notShared = await screen.findByRole('region', { name: 'Not shared' })
    // Imad, 6 Nov: the heading says it; no line under it.
    expect(notShared).toHaveTextContent(/^Not shared$/)
    expect(screen.queryByText(/^Locked at kick-off, \d\d:\d\d$/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share plan' })).toBeNull()
    // TRAK-332: the review still reads every part, with nothing to edit.
    const review = screen.getByRole('region', { name: 'Game plan review' })
    expect(within(review).getByText('1 of 1 starters have one')).toBeInTheDocument()
    expect(within(review).queryByRole('button', { name: /^Edit/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: '4-4-2' })).toBeInTheDocument()
  })

  it('shared with changes still unshared: no alert, and there is no Share changes', async () => {
    setup({ kickOffIn: -MINUTE, shared: true, changes: ['zagorakis', 'charisteas'] })
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const shared = await screen.findByRole('region', { name: /^Shared at / })
    expect(screen.queryByText(/didn’t get your last changes|^Locked at kick-off, /)).toBeNull()
    expect(within(shared).queryByRole('button', { name: /Share changes/ })).toBeNull()
    expect(shared).not.toHaveTextContent(/Edits stay with you|read it in the app/)
  })

  it('the player\'s sheet only shows: the job is written, context and expectation are words, nothing moves', async () => {
    const user = userEvent.setup()
    setup({ kickOffIn: -MINUTE })
    renderApp('/coach/matches/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
    await user.click(await screen.findByRole('button', { name: /^Theodoros Zagorakis, slot 4/ }))
    const sheet = await screen.findByRole('complementary', { name: 'Theodoros Zagorakis' })
    expect(within(sheet).queryAllByRole('textbox')).toEqual([])
    expect(within(sheet).getByText('Stay tight to their winger.')).toBeInTheDocument()
    expect(within(sheet).getByText('Out of position')).toBeInTheDocument()
    expect(within(sheet).getByText('Stretch')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Move to bench' })).toBeNull()
    expect(within(sheet).queryByRole('group', { name: /Expectation/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Slot 1, empty' }))
    expect(await screen.findByText('Nobody was placed here before kick-off.')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Who plays here?' })).toBeNull()
  })

  it('TRAK-372: nothing written reads "No instructions.", "No scouting." and "No job.", with no boxes', async () => {
    const user = userEvent.setup()
    setup({ kickOffIn: -MINUTE })
    server.use(
      table('game_plans', [{ ...PLAN, scouting: '', goals: [] }]),
      table('game_plan_players', [{ ...LINE_UP[0], job: '' }]),
    )
    renderApp('/coach/matches/g1?tab=plan')
    expect(await screen.findByText('No instructions.')).toBeInTheDocument()
    expect(screen.getByText('No scouting.')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).queryAllByRole('textbox')).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Next: Line-up and jobs' }))
    await user.click(await screen.findByRole('button', { name: /^Theodoros Zagorakis, slot 4/ }))
    const sheet = await screen.findByRole('complementary', { name: 'Theodoros Zagorakis' })
    expect(within(sheet).getByText('No job.')).toBeInTheDocument()
    expect(within(sheet).queryAllByRole('textbox')).toEqual([])
  })

  it('Home\'s plan card closes at kick-off, with Home open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({ kickOffIn: 30_000 })
    server.use(table('game_plans', []), table('game_plan_players', []))
    renderApp('/coach/home')
    // TRAK-608: the match plan is a to-do on match day; not shared, it leaves at kick-off.
    const todo = await screen.findByRole('region', { name: 'To-do' }, { timeout: 5000 })
    // TRAK-615: the match's Evaluate the game names it too, so watch the plan's own to-do.
    expect(await within(todo).findByText('No plan for Parkview Athletic yet', {}, { timeout: 5000 })).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    await waitFor(() => expect(within(todo).queryByText('No plan for Parkview Athletic yet')).toBeNull())
  })
})
