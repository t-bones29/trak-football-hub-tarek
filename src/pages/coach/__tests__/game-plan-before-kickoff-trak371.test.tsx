/**
 * TRAK-371 (Imad, 5 Nov, Matches round 5): the Game plan before kick-off. Jobs counts as ready once the coach has given
 * any starter a job (1 of 10 counts); "Take off the pitch" is a "Move to bench" button; the boxes show example text
 * starting "e.g." in place of the "Up to three…" line. Test people are named after footballers.
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
let COACH = { id: 'coach-371' }

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
const starter = (id: string, slot: number, job: string) =>
  ({ event_id: 'g1', squad_player_id: id, role: 'starter', slot, job, note: '', context: [], expectation: 'usual' })

function setup(lineUp: ReturnType<typeof starter>[], goals: { title: string; looks_like: string }[] = []) {
  server.use(
    // TRAK-363: the plan's Instructions offer the squad's season objectives.
    table('season_plans', []),
    table('coach_calendar_events', [game()]),
    table('game_plans', [{
      event_id: 'g1', strength: 'stronger', their_formation: null, key_players: [], scouting: '', format: 11, formation: '4-4-2',
      goals, created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z',
    }]),
    table('game_plan_players', lineUp),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
    rpc('game_plan_changes', () => []),
  )
}

beforeEach(() => {
  COACH = { id: `coach-371-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('zagorakis', 'Theodoros Zagorakis', 7), child('basinas', 'Angelos Basinas', 6)]),
    table('event_confirmations', [{ squad_player_id: 'zagorakis' }, { squad_player_id: 'basinas' }]),
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
    // TRAK-358: Can also play, for Out of position on the line-up; nobody has one.
    table('squad_player_also_plays', []),
    table('squad_player_roles', []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

const jobsRow = async () => {
  const card = await screen.findByRole('region', { name: 'Game plan review' })
  return within(within(card).getByRole('list', { name: 'The plan' })).getAllByRole('listitem')[4]
}

describe('TRAK-371: the Game plan before kick-off', { timeout: 30_000 }, () => {
  it('Jobs is ready once one starter of two has a job', async () => {
    setup([starter('zagorakis', 4, 'Stay tight to their winger.'), starter('basinas', 5, '')])
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const jobs = await jobsRow()
    expect(jobs).toHaveTextContent(/^Jobs1 of 2 starters have one$/)
    expect(within(jobs).getByRole('img')).toHaveAccessibleName('Ready')
  })

  it('Jobs stays incomplete while no starter has a job', async () => {
    setup([starter('zagorakis', 4, ''), starter('basinas', 5, '')])
    renderApp('/coach/matches/g1?tab=plan&step=share')
    const jobs = await jobsRow()
    expect(jobs).toHaveTextContent(/^Jobs0 of 2 starters have one$/)
    expect(within(jobs).getByRole('img')).toHaveAccessibleName('Incomplete')
  })

  it('Instructions and Scouting show example text, and the "Up to three" line is gone', async () => {
    const user = userEvent.setup()
    setup([])
    renderApp('/coach/matches/g1?tab=plan')
    const scouting = await screen.findByLabelText('What you know about them')
    expect(scouting.getAttribute('placeholder')).toMatch(/^e\.g\. /)
    expect(screen.queryByText(/Up to three/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add instruction' }))
    expect(screen.getByLabelText('Instruction').getAttribute('placeholder')).toMatch(/^e\.g\. /)
    expect(screen.getByLabelText('What it looks like').getAttribute('placeholder')).toMatch(/^e\.g\. /)
  })

  it('a starter\'s sheet: the Job shows example text, and "Move to bench" benches them', async () => {
    const user = userEvent.setup()
    setup([starter('zagorakis', 4, '')])
    renderApp('/coach/matches/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
    await user.click(await screen.findByRole('button', { name: 'Theodoros Zagorakis, slot 4' }))
    expect(screen.getByLabelText('Job · only Theodoros sees it').getAttribute('placeholder')).toMatch(/^e\.g\. /)
    expect(screen.queryByRole('button', { name: 'Take off the pitch' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Move to bench' }))
    expect(screen.getByRole('button', { name: 'Slot 4, empty' })).toBeInTheDocument()
    // TRAK-358: on the Bench tab now, as Everyone's job went.
    expect(within(screen.getByRole('tabpanel', { name: /^Bench/ })).getByRole('button', { name: 'Theodoros Zagorakis, bench' })).toBeInTheDocument()
  })
})
