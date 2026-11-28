/**
 * TRAK-369 (Imad, 4 Nov, Matches round 4): Game plan review's top row is two halves, the gauge with "N incomplete"
 * under it and "Kick-off in" with its countdown, with nothing between them. Before sharing, the card no longer says who
 * gets the plan or "Tick … to share"; Share plan still waits for the tick. Test people are named after footballers.
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
let COACH = { id: 'coach-369' }

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
  COACH = { id: `coach-369-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('zagorakis', 'Theodoros Zagorakis', 7), child('basinas', 'Angelos Basinas', 6)]),
    table('event_confirmations', [{ squad_player_id: 'zagorakis' }]),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    rpc('feature_on', () => true),
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    // A drafted plan: strength and scouting set, one instruction, Theodoros Zagorakis the one starter, with a job.
    table('coach_calendar_events', [game()]),
    table('game_plans', [{
      event_id: 'g1', strength: 'stronger', their_formation: null, key_players: [], scouting: 'Their 9 is quick.', format: 11, formation: '4-4-2',
      goals: [{ title: 'Win the second ball', looks_like: 'First to every loose ball in midfield.' }],
      created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z',
    }]),
    table('game_plan_players', [{ event_id: 'g1', squad_player_id: 'zagorakis', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
      note: '', context: [], expectation: 'usual' }]),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

const review = async () => {
  renderApp('/coach/matches/g1?tab=plan&step=share')
  return screen.findByRole('region', { name: 'Game plan review' })
}

describe('TRAK-369: Game plan review, round 4', { timeout: 30_000 }, () => {
  it('two halves: the gauge with "1 incomplete" under it, and "Kick-off in" with its countdown; nothing between them', async () => {
    const card = await review()
    const gauge = within(card).getByRole('img', { name: '4 of 5 parts ready, 1 incomplete' })
    const half = gauge.parentElement!
    expect(within(half).getByText('1 incomplete')).toBeInTheDocument()
    // The words come after the gauge, so they read under it.
    expect(gauge.compareDocumentPosition(within(half).getByText('1 incomplete')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const row = half.parentElement!
    expect(row.children).toHaveLength(2)
    expect(row.children[1]).toContainElement(screen.getByRole('timer', { name: 'Kick-off in' }))
    expect(row.children[1]).toHaveTextContent(/^Kick-off in/)
  })

  it('before sharing: no line for who gets it and none for the tick; Share plan still waits for the tick', async () => {
    const user = userEvent.setup()
    const card = await review()
    expect(within(card).queryByText(/and their families/)).toBeNull()
    expect(within(card).queryByText(/^Tick /)).toBeNull()
    const share = within(card).getByRole('button', { name: 'Share plan' })
    expect(share).toBeDisabled()
    await user.click(within(card).getByRole('checkbox', { name: 'I’ve talked selection through with the players' }))
    expect(share).toBeEnabled()
  })
})
