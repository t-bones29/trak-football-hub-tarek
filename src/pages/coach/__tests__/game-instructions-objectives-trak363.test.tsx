/**
 * TRAK-363 (Season plan 15/18, spec TRAK-348): a match plan's Instructions offer the squad's season objectives as
 * one-tap picks. A pick fills in the title and what it looks like and carries the objective's id, which stays when the
 * coach edits the words; it wears a tag. A typed instruction carries none. A removed objective isn't offered, and one
 * already picked isn't offered twice. Synthetic people.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-363' }
let saves: Record<string, unknown>[] = []

function game() {
  const kickOff = Math.ceil((Date.now() + 5 * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Synthetic United', event_type: 'match', published: true, status: 'scheduled',
    starts_at: at, ends_at: new Date(kickOff + 90 * MINUTE).toISOString(), event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`,
    end_time: null, meet_time: null, opponent: 'Synthetic United', home_away: 'home', venue: 'Synthetic Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null,
  }
}

beforeEach(() => {
  COACH = { id: `coach-363-${++n}` }
  saves = []
  signInAs(COACH)
  const store = new Map<string, Record<string, unknown>>()
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Synthetic Player Pat', age_group: 'U16', status: 'active' }]),
    table('coach_sessions', []), table('session_attendance', []), table('event_absences', []),
    table('coach_calendar_events', [game()]), table('game_plan_players', []), table('event_confirmations', []), table('coach_assessments', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    table('game_evaluations', []), table('game_evaluation_players', []), table('game_evaluation_notes', []), table('game_shares', []),
    rpc('game_plan_changes', () => []),
    table('season_plans', [{ id: 'plan-16', squad: 'U16', starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: '2026-11-01T10:00:00Z',
      positions_known: 'yes', watch_rule: 't2', last_shared_at: '2026-11-01T10:00:00Z', unshared_parts: [], unshared_players: [] }]),
    table('season_objectives', [
      { id: '11111111-1111-4111-8111-111111111111', place: 1, title: 'Win it back within 5 seconds', looks_like: 'The nearest three press.', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null },
      { id: '22222222-2222-4222-8222-222222222222', place: 2, title: 'Stay compact', looks_like: 'No more than 35 m.', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null },
      { id: '33333333-3333-4333-8333-333333333333', place: 3, title: 'Removed one', looks_like: '', status: 'retired', created_at: '2026-09-01T08:00:00Z', retired_at: '2026-10-01T08:00:00Z' },
    ]),
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, () => HttpResponse.json([...store.values()])),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      saves.push(body)
      store.set(body.event_id as string, { ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return new HttpResponse(null, { status: 201 })
    }),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

const PRESS = '11111111-1111-4111-8111-111111111111'

describe('TRAK-363 season objectives in Instructions', { timeout: 30_000 }, () => {
  it('a pick fills the words and carries the objective, which stays when the words change; typed ones carry none', async () => {
    const user = userEvent.setup()
    renderApp('/coach/matches/g1?tab=plan')
    const picks = await screen.findByRole('heading', { name: 'From your season plan' })
    const offered = within(picks.parentElement!).getAllByRole('button').map(b => b.textContent)
    expect(offered).toEqual(['Win it back within 5 seconds', 'Stay compact'])

    await user.click(screen.getByRole('button', { name: 'Win it back within 5 seconds' }))
    const first = screen.getByRole('group', { name: 'Instruction 1' })
    expect(within(first).getByLabelText('Instruction')).toHaveValue('Win it back within 5 seconds')
    expect(within(first).getByLabelText('What it looks like')).toHaveValue('The nearest three press.')
    expect(within(first).getByText('Season objective: Win it back within 5 seconds')).toBeInTheDocument()
    expect(within(picks.parentElement!).queryByRole('button', { name: 'Win it back within 5 seconds' })).toBeNull()

    await user.type(within(first).getByLabelText('Instruction'), ', all of us')
    await user.click(screen.getByRole('button', { name: 'Add instruction' }))
    await user.type(within(screen.getByRole('group', { name: 'Instruction 2' })).getByLabelText('Instruction'), 'Typed by the coach')
    await user.click(screen.getByRole('button', { name: /^Save draft/ }))
    await waitFor(() => expect(saves.length).toBeGreaterThan(0))
    expect(saves.at(-1)!.goals).toEqual([
      { title: 'Win it back within 5 seconds, all of us', looks_like: 'The nearest three press.', season_objective_id: PRESS },
      { title: 'Typed by the coach', looks_like: '' },
    ])
  })

  it('a removed objective is never offered', async () => {
    renderApp('/coach/matches/g1?tab=plan')
    expect(await screen.findByRole('heading', { name: 'From your season plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Removed one' })).toBeNull()
  })

  it('a squad without a season plan offers none', async () => {
    server.use(table('season_plans', []))
    renderApp('/coach/matches/g1?tab=plan')
    expect(await screen.findByRole('button', { name: 'Add instruction' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'From your season plan' })).toBeNull()
  })
})
