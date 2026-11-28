/**
 * TRAK-346 (Imad, 3 Nov, Matches round 3): "when i click edit on something, it takes me back to that step and then i
 * have to go through the stepper all over again. Allow the option to jump forward in the stepper." The Game plan's
 * stepper opens any step, ahead as well as back, by click or keyboard, and what's typed stays. Test people are named
 * after footballers.
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
let COACH = { id: 'coach-346' }

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
  COACH = { id: `coach-346-${++n}` }
  signInAs(COACH)
  server.use(
    // TRAK-363: the plan's Instructions offer the squad's season objectives.
    table('season_plans', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Carlo Ancelotti', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('pirlo', 'Andrea Pirlo', 21), child('nesta', 'Alessandro Nesta', 13)]),
    table('event_confirmations', [{ squad_player_id: 'pirlo' }]),
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
    table('game_plan_players', []),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
    rpc('game_plan_changes', () => []),
    rpc('feature_on', () => true),
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    // TRAK-358: Can also play, for Out of position on the line-up; nobody has one.
    table('squad_player_also_plays', []),
    table('squad_player_roles', []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

const steps = () => screen.getByRole('navigation', { name: 'Game plan' })
const step = (name: RegExp) => within(steps()).getByRole('button', { name })

describe('TRAK-346: the Game plan stepper jumps ahead', { timeout: 30_000 }, () => {
  it('after an Edit on Game plan review, a click on Review & share comes straight back, with what was typed', async () => {
    const user = userEvent.setup()
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    await user.click(within(card).getByRole('button', { name: 'Edit instructions' }))
    const instruction = await screen.findByRole('textbox', { name: 'Instruction' })
    await user.type(instruction, ' Always.')

    await user.click(step(/^Review & share/))
    expect(await screen.findByRole('region', { name: 'Game plan review' })).toBeInTheDocument()
    await user.click(step(/^Tactics & analysis/))
    expect(await screen.findByRole('textbox', { name: 'Instruction' })).toHaveValue('Keep the ball Always.')
  })

  it('from the first step, Line-up and jobs opens from the stepper, by keyboard too', async () => {
    const user = userEvent.setup()
    renderApp('/coach/matches/g1?tab=plan')
    await screen.findByRole('textbox', { name: 'Instruction' })
    const lineUp = step(/^Line-up and jobs/)
    expect(lineUp).not.toHaveAttribute('aria-disabled')
    lineUp.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: '4-4-2' })).toBeInTheDocument()
  })
})
