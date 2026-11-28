/**
 * TRAK-373 (Imad, 5 Nov, Matches round 5): Game plan review's top right after kick-off. While the match is on, a green
 * bar with the minute over it, counted as on TV ("15'" 14 minutes in), "HT" for the 15 minutes of half-time; once it's
 * over, "Locked" with the lock.
 * It moves on its own, with no reload. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, within } from '@testing-library/react'
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
let COACH = { id: 'coach-373' }

/** A 105-minute match (two halves of 45 and 15 of half-time) that kicked off `ago` ms ago. */
function game(ago: number) {
  const kickOff = Date.now() - ago
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 105 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 19)}`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null,
  }
}
const setup = (ago: number) => server.use(table('coach_calendar_events', [game(ago)]))

beforeEach(() => {
  COACH = { id: `coach-373-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'zagorakis', coach_user_id: COACH.id, player_name: 'Theodoros Zagorakis', age_group: 'U16', status: 'active',
      shirt_number: 7, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' }]),
    table('game_plans', [{ event_id: 'g1', strength: 'similar', their_formation: null, key_players: [], scouting: '', format: 11, formation: '4-4-2',
      goals: [], created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z' }]),
    table('game_plan_players', []),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
    rpc('game_plan_changes', () => []),
    table('event_confirmations', []),
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
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers() })

const card = () => screen.findByRole('region', { name: 'Game plan review' })

describe('TRAK-373: the match clock', { timeout: 30_000 }, () => {
  it('14 minutes in: 15\' over a green bar, as on TV, and no countdown', async () => {
    setup(14 * MINUTE + 10_000)
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const review = await card()
    const clock = await within(review).findByRole('progressbar', { name: 'Match clock' })
    expect(clock).toHaveAttribute('aria-valuetext', 'Minute 15')
    expect(within(review).getByText('15\'')).toBeInTheDocument()
    expect(within(review).queryByRole('timer')).toBeNull()
    expect(within(review).queryByText('Locked')).toBeNull()
  })

  it('half-time reads HT, and the second half picks up at 46\', with no reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup(59 * MINUTE + 50_000)
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const review = await card()
    expect(await within(review).findByText('HT')).toBeInTheDocument()
    expect(within(review).getByRole('progressbar', { name: 'Match clock' })).toHaveAttribute('aria-valuetext', 'Half-time')

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(await within(review).findByText('46\'')).toBeInTheDocument()
    expect(within(review).queryByText('HT')).toBeNull()
  })

  it('after full time: "Locked" with the lock, and no bar', async () => {
    setup(2 * 60 * MINUTE)
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const review = await card()
    expect(await within(review).findByText('Locked')).toBeInTheDocument()
    expect(within(review).queryByRole('progressbar', { name: 'Match clock' })).toBeNull()
    expect(within(review).queryByRole('timer')).toBeNull()
  })
})
