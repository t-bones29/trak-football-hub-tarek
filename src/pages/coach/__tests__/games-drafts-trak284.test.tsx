/**
 * TRAK-284 (Games 2/8): a plan draft shows on Games home as "Draft" (TRAK-588: no Open drafts box; TRAK-590: no month) and as "Plan not shared". Home's Needs you
 * lists a match whose logistics are shared, kicking off within 7 days, with no plan shared: "Plan not shared · Write
 * the plan". Neither shows with the games switch off. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-284-drafts' }

/** A Dubai academy's match `days` from now (UTC+4 all year). */
function game(id: string, opponent: string, days: number, over: Record<string, unknown> = {}) {
  const kickOff = Math.ceil((Date.now() + days * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `vs ${opponent}`, event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent, home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null, family_note: null, notes: null,
    series_id: null, training_themes: [], cancel_reason: null, ...over,
  }
}
const plan = (event_id: string) => ({
  event_id, strength: null, their_formation: null, key_players: [], scouting: '', goals: [],
  created_at: '2026-10-27T17:00:00Z', updated_at: '2026-10-27T17:40:00Z',
})

beforeEach(() => {
  COACH = { id: `coach-284-drafts-${++n}` }
  signInAs(COACH)
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' }]),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('notification_settings', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_plans', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

describe('TRAK-284: plan drafts on Games home and in Needs you', { timeout: 30_000 }, () => {
  it('Games home marks an open plan draft on its badge; a kicked-off match\'s draft is closed', async () => {
    const user = userEvent.setup()
    server.use(
      table('coach_calendar_events', [game('g1', 'Parkview Athletic', 5), game('g2', 'Riverside Rovers', 8), game('g0', 'Harbour Town', -1)]),
      table('game_plans', [plan('g1'), plan('g0')]),
    )
    renderApp('/coach/matches')
    const next = await screen.findByRole('region', { name: 'Next match' })
    // TRAK-588: no Open drafts box.
    expect(screen.queryByRole('heading', { name: 'Open drafts' })).toBeNull()
    expect(screen.queryByText('No drafts open.')).toBeNull()
    expect(within(next).getByText('Draft')).toBeInTheDocument()
    const strip = screen.getByRole('region', { name: 'Upcoming matches' })
    expect(within(within(strip).getByRole('link', { name: /Parkview Athletic/ })).getByText('Draft')).toBeInTheDocument()
    expect(within(within(strip).getByRole('link', { name: /Riverside Rovers/ })).getByText('Plan not written')).toBeInTheDocument()
    // TRAK-592: a match that has kicked off is in Past matches, not Upcoming.
    expect(within(strip).queryByRole('link', { name: /Harbour Town/ })).toBeNull()

    await user.click(within(strip).getByRole('link', { name: /Parkview Athletic/ }))
    expect(window.location.pathname).toBe('/coach/matches/g1')
  })

  // TRAK-608: on a day with no events, the To-do takes the next match's next step; the rest wait in Upcoming (TRAK-611).
  it('the To-do takes the next match within 7 days: "Write the plan for Parkview Athletic · Write plan"', async () => {
    server.use(table('coach_calendar_events', [game('g1', 'Parkview Athletic', 3), game('g2', 'Riverside Rovers', 8)]))
    renderApp('/coach/home')
    const todo = await screen.findByRole('region', { name: 'To-do' }, { timeout: 5000 })
    const card = (await within(todo).findByText('Write the plan for Parkview Athletic', {}, { timeout: 5000 })).closest('li')!
    // TRAK-333: a split button, as every match action.
    await userEvent.click(within(card).getByRole('button', { name: 'Write plan' }))
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/coach/matches/g1?tab=plan'))
    expect(within(todo).queryByText(/Riverside Rovers/)).toBeNull()
  })

  it("a draft match coming first asks for its logistics to be shared", async () => {
    server.use(table('coach_calendar_events', [game('g1', 'Parkview Athletic', 3), game('g3', 'Harbour Town', 2, { published: false })]))
    renderApp('/coach/home')
    const todo = await screen.findByRole('region', { name: 'To-do' }, { timeout: 5000 })
    expect(await within(todo).findByText('Share logistics for Harbour Town', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(within(todo).queryByText(/Parkview Athletic/)).toBeNull()
  })

  it('with the games switch off, the To-do has no match', async () => {
    server.use(
      rpc('feature_on', ({ p_feature }) => p_feature === 'events'),
      table('coach_calendar_events', [game('g1', 'Parkview Athletic', 3)]),
    )
    renderApp('/coach/home')
    const todo = await screen.findByRole('region', { name: 'To-do' }, { timeout: 5000 })
    await within(todo).findByText('Nothing to do today.', {}, { timeout: 5000 })
    expect(within(todo).queryByText(/Parkview Athletic/)).toBeNull()
  })
})
