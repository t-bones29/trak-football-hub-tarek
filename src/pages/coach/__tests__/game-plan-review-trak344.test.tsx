/**
 * TRAK-344 (Imad, 3 Nov, Matches round 3): the match page says each thing once. The header keeps the match and when,
 * says "Draft" for a plan not shared and has no countdown; Game plan review (TRAK-332's card) is titled so, puts the
 * gauge, "N incomplete" and "Kick-off in" with its countdown on one row, and its rows show an icon, not a word.
 * Logistics and Tactics & analysis have no detail line; the Logistics tab says "Shared". Test people are named after
 * footballers.
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
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-344' }

function game(kickOffIn: number, published = true) {
  const kickOff = Math.ceil((Date.now() + kickOffIn) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })

/** A drafted plan: strength and scouting set, one instruction, Theodoros Zagorakis the one starter, with a job. */
function setup({ kickOffIn = 5 * DAY, published = true } = {}) {
  server.use(
    table('coach_calendar_events', [game(kickOffIn, published)]),
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
}

beforeEach(() => {
  COACH = { id: `coach-344-${++n}` }
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
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers() })

const review = () => renderApp('/coach/matches/g1?tab=plan&step=share')
const rows = (card: HTMLElement) => within(within(card).getByRole('list', { name: 'The plan' })).getAllByRole('listitem')

describe('TRAK-344: the match page says each thing once', { timeout: 30_000 }, () => {
  it('the header keeps the match and when, says Draft, and has no countdown: the one countdown is in the card', async () => {
    setup()
    review()
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    expect(screen.getByRole('heading', { level: 1, name: 'vs Parkview Athletic' })).toBeInTheDocument()
    // Match header (Imad, 6 Nov): the day, the kick-off, then where, each with its icon.
    const header = screen.getByRole('region', { name: 'vs Parkview Athletic' })
    expect(header).toHaveTextContent(/\w{3} \d{1,2} \w{3}Kick-off \d\d:\d\dRehearsal Park · Home/)
    expect(within(screen.getByRole('heading', { level: 1 }).parentElement!).getByText('Draft')).toBeInTheDocument()
    expect(screen.queryByText('Plan not shared')).toBeNull()
    const timers = screen.getAllByRole('timer')
    expect(timers).toHaveLength(1)
    expect(card).toContainElement(timers[0])
    expect(timers[0]).toHaveAccessibleName('Kick-off in')
  })

  it('the card: its title, "N incomplete" by the gauge, "Kick-off in", and no match, time or "of 5 ready" again', async () => {
    setup()
    review()
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    expect(within(card).getByRole('heading', { name: 'Game plan review' })).toBeInTheDocument()
    expect(within(card).queryByText(/Parkview Athletic/)).toBeNull()
    expect(within(card).queryByText(/· Kick-off/)).toBeNull()
    // One starter of 11 is placed, so the line-up is the one part left.
    expect(within(card).getByRole('img', { name: '4 of 5 parts ready, 1 incomplete' })).toBeInTheDocument()
    expect(within(card).getByText('1 incomplete')).toBeInTheDocument()
    expect(within(card).queryByText(/of 5 ready|to check|left$/)).toBeNull()
    expect(within(card).getByText('Kick-off in')).toBeInTheDocument()
  })

  it('the rows show an icon, not "Ready" or "Check"; Logistics and Tactics & analysis have no detail line', async () => {
    setup()
    review()
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    const parts = rows(card)
    expect(parts.map(part => part.textContent)).toEqual([
      'Logistics',
      'Tactics & analysis',
      'Instructions1 instruction',
      'Line-up1 of 11 placed · 1 on the bench',
      'Jobs1 of 1 starters have one',
    ])
    // Screen readers still hear each part's status, from its icon.
    expect(parts.map(part => within(part).getByRole('img').getAttribute('aria-label'))).toEqual(['Ready', 'Ready', 'Ready', 'Incomplete', 'Ready'])
  })

  it('logistics not published: they count as incomplete, and the line by Share plan says what to do', async () => {
    setup({ published: false })
    review()
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    expect(within(card).getByText('2 incomplete')).toBeInTheDocument()
    expect(within(card).queryByText('Logistics first')).toBeNull()
    expect(within(rows(card)[0]).getByRole('img', { name: 'Needed' })).toBeInTheDocument()
    expect(rows(card)[0]).toHaveTextContent(/^Logistics$/)
    expect(within(card).getByText('Publish the match in Logistics first')).toBeInTheDocument()
  })

  it('the Logistics tab says Shared, and no countdown shows', async () => {
    setup()
    renderApp('/coach/matches/g1')
    expect(await screen.findByText('Shared')).toBeInTheDocument()
    expect(screen.queryByText('Shared with families')).toBeNull()
    expect(screen.queryByRole('timer')).toBeNull()
  })

  it('at kick-off, with the card open, the countdown gives way to the match clock (TRAK-373)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({ kickOffIn: 30_000 })
    review()
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    expect(within(card).getByRole('timer', { name: 'Kick-off in' })).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(2 * MINUTE) })

    const locked = screen.getByRole('region', { name: 'Game plan review' })
    // Kick-off is the next whole minute, 30 to 90 s away, so two minutes on the clock reads Minute 1 or Minute 2.
    expect(await within(locked).findByRole('progressbar', { name: 'Match clock' })).toHaveAttribute('aria-valuetext', expect.stringMatching(/^Minute [12]$/))
    expect(within(locked).queryByRole('timer')).toBeNull()
  })
})
