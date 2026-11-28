/**
 * TRAK-345 (Imad, 3 Nov, Matches round 3): the share footer of Game plan review. The tick says "I’ve talked selection
 * through with the players" and nothing else; Share plan's chevron offers "Schedule", not "Share at…", and Schedule
 * opens the day and the time under the button. (Its green and the one line are the browser test's: games.spec.) Test
 * people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
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
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-345' }

function game() {
  const kickOff = Math.ceil((Date.now() + 5 * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })

beforeEach(() => {
  COACH = { id: `coach-345-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Vicente del Bosque', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('xavi', 'Xavi Hernández', 8), child('iniesta', 'Andrés Iniesta', 6)]),
    table('event_confirmations', [{ squad_player_id: 'xavi' }]),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    table('coach_calendar_events', [game()]),
    table('game_plans', [{
      event_id: 'g1', strength: 'similar', their_formation: null, key_players: [], scouting: '', format: 11, formation: '4-4-2',
      goals: [{ title: 'Keep the ball', looks_like: 'Ten passes before we go forward.' }],
      created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-01T09:00:00Z',
    }]),
    table('game_plan_players', [{ event_id: 'g1', squad_player_id: 'xavi', role: 'starter', slot: 7, job: 'Find the pass between the lines.',
      note: '', context: [], expectation: 'usual' }]),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
    rpc('game_plan_changes', () => []),
    rpc('feature_on', () => true),
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

describe('TRAK-345: Share plan', { timeout: 30_000 }, () => {
  it('the tick says "I’ve talked selection through with the players", and nothing else', async () => {
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    const tick = within(card).getByRole('checkbox', { name: 'I’ve talked selection through with the players' })
    expect(tick).not.toHaveAccessibleDescription()
    expect(within(card).queryByText(/face to face|Before this goes out|hear it from you first/)).toBeNull()
  })

  it('the chevron offers Schedule, and Schedule opens the day and the time under the button', async () => {
    const user = userEvent.setup()
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    await user.click(within(card).getByRole('checkbox', { name: 'I’ve talked selection through with the players' }))
    await user.click(within(card).getByRole('button', { name: 'Share plan more actions' }))
    expect((await screen.findAllByRole('menuitem')).map(item => item.textContent)).toEqual(['Schedule'])
    await user.click(screen.getByRole('menuitem', { name: 'Schedule' }))

    const share = within(card).getByRole('button', { name: 'Share plan' })
    const day = within(card).getByRole('button', { name: /^Day\b/ })
    const time = within(card).getByRole('button', { name: /^Time\b/ })
    for (const picker of [day, time]) expect(share.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Schedule' })).toBeDisabled()
  })
})
