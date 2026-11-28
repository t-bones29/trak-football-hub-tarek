/**
 * TRAK-290 (Games 8/8): Share at… The Share step's split button offers a time behind Share now's chevron; scheduling
 * waits for the same face-to-face tick, saves what's typed, then sends the academy's day and time. A scheduled plan
 * waits with "Shares Mon 12:00": saving rewrites what waits (Imad, 29 Oct: it goes out as saved), Change time moves
 * it, Share now sends it, and at its time it is shared with no reload. The clock is faked: Mon 2 Nov 2026, 10:00 in
 * Dubai. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { pickDate, pickTime } from '../../../../tests/support/arc-pickers'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
// Mon 2 Nov 2026, 10:00 in Dubai.
const NOW = new Date('2026-11-02T06:00:00Z')
let n = 0
let COACH = { id: 'coach-290' }

// Sat 7 Nov, 10:00 in Dubai: the academy's wall clock and its instant, as the database stamps them.
const match = () => ({
  id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
  starts_at: '2026-11-07T06:00:00Z', ends_at: '2026-11-07T07:30:00Z', event_date: '2026-11-07', start_time: '10:00:00', end_time: null,
  meet_time: null, opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
  family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null, competition: 'league',
})
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })
const plan = {
  event_id: 'g1', strength: 'similar', their_formation: null, key_players: [], scouting: '', format: 11, formation: '4-4-2',
  goals: [{ title: 'Keep the ball', looks_like: 'Ten passes before we go forward.' }],
  created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-01T09:00:00Z',
}
// Zinedine Zidane starts with a job and a note; Thierry Henry is on the bench.
const LINE_UP = [
  { event_id: 'g1', squad_player_id: 'zidane', role: 'starter', slot: 7, job: 'Find the pass between the lines.', note: 'Your game today.', context: [], expectation: 'usual' },
]
// The academy's day and time as the moment it names: Dubai is UTC+4 all year.
const dubai = (wall: string) => new Date(`${wall}:00+04:00`).toISOString()

/** The plan, its line-up and the share log, as the database answers: Share sends now, Share at sets a time (or, with
 *  none, keeps the one waiting). */
function store({ sharedAt = null as string | null } = {}) {
  const shares = sharedAt ? [{ event_id: 'g1', shared_at: sharedAt }] : []
  const calls: { fn: string; body: unknown }[] = []
  server.use(
    table('game_plans', [plan]),
    table('game_plan_players', LINE_UP),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => {
      calls.push({ fn: 'save plan', body: await request.json() })
      return new HttpResponse(null, { status: 201 })
    }),
    http.post(`${SUPABASE_URL}/rest/v1/game_plan_players`, async ({ request }) => {
      calls.push({ fn: 'save line-up', body: await request.json() })
      return new HttpResponse(null, { status: 201 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json(shares)),
    rpc('game_plan_changes', () => []),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/share_game_plan`, async ({ request }) => {
      calls.push({ fn: 'share', body: await request.json() })
      if (shares.length) shares[0].shared_at = new Date().toISOString()
      else shares.push({ event_id: 'g1', shared_at: new Date().toISOString() })
      return HttpResponse.json(0)
    }),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/schedule_game_plan`, async ({ request }) => {
      const body = await request.json() as { p_at?: string }
      calls.push({ fn: 'schedule', body })
      if (body.p_at) {
        if (shares.length) shares[0].shared_at = dubai(body.p_at)
        else shares.push({ event_id: 'g1', shared_at: dubai(body.p_at) })
      }
      return HttpResponse.json(2)
    }),
  )
  return calls
}

// Only the date is faked: the date picker closes on a timer of its own. The test that waits for a share's time fakes
// the timers too.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  COACH = { id: `coach-290-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Didier Deschamps', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('zidane', 'Zinedine Zidane', 10), child('henry', 'Thierry Henry', 12)]),
    table('event_confirmations', []),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    table('coach_calendar_events', [match()]),
    rpc('feature_on', () => true),
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
  )
})
afterEach(() => { vi.useRealTimers(); cleanup(); localStorage.clear() })

const shareStep = () => renderApp('/coach/matches/g1?tab=plan&step=share')

describe('TRAK-290: Share at…', { timeout: 30_000 }, () => {
  it('sits behind Share plan\'s chevron: it waits for the tick, saves what is typed, then schedules on the academy\'s clock', async () => {
    const user = userEvent.setup()
    const calls = store()
    shareStep()
    await screen.findByRole('region', { name: 'Game plan review' })
    expect(screen.getByRole('button', { name: 'Share plan more actions' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /talked selection through/ }))
    await user.click(screen.getByRole('button', { name: 'Share plan more actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Schedule' }))
    expect(screen.getByText('Any time before kick-off. Until then, only you see it.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schedule' })).toBeDisabled()

    await pickDate(user, 'Day', '2026-11-05')
    await pickTime(user, 'Time', '19:30')
    await user.click(screen.getByRole('button', { name: 'Schedule for Thu 19:30' }))

    await waitFor(() => expect(calls.map(call => call.fn)).toEqual(['save plan', 'save line-up', 'schedule']))
    expect(calls[2].body).toEqual({ p_event_id: 'g1', p_talked: true, p_at: '2026-11-05T19:30' })
    const scheduled = await screen.findByRole('region', { name: 'Scheduled' })
    expect(within(scheduled).getByText('Shares Thu 19:30')).toBeInTheDocument()
    // TRAK-448: beside the title it reads "Plan scheduled"; the time is in this card only.
    expect(screen.getAllByText('Shares Thu 19:30')).toHaveLength(1)
    expect(within(screen.getByRole('heading', { level: 1 }).parentElement!).getByText('Plan scheduled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Share plan' })).toBeNull()
  })

  it('a scheduled plan waits: Save draft rewrites what waits, Change time moves it, and at its time it is shared, no reload', async () => {
    // The page's own timer, not the animation clock: a jump there would stall later tests' pickers.
    vi.useRealTimers()
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const calls = store({ sharedAt: dubai('2026-11-02T12:00') })
    shareStep()
    const scheduled = await screen.findByRole('region', { name: 'Scheduled' })
    expect(within(scheduled).getByText('Shares Mon 12:00')).toBeInTheDocument()
    expect(within(scheduled).getByText('2 players and their families read it from Mon 2 Nov, 12:00, in the app only. What you save before then goes out with it.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(calls.map(call => call.fn)).toEqual(['save plan', 'save line-up', 'schedule']))
    expect(calls[2].body).toEqual({ p_event_id: 'g1' })

    // The pickers open on the time it has, on the academy's clock.
    await user.click(within(scheduled).getByRole('button', { name: 'Change time' }))
    expect(within(scheduled).getByRole('button', { name: 'Move to Mon 12:00' })).toBeEnabled()
    await pickTime(user, 'Time', '13:00')
    await user.click(within(scheduled).getByRole('button', { name: 'Move to Mon 13:00' }))
    await waitFor(() => expect(calls.at(-1)).toEqual({ fn: 'schedule', body: { p_event_id: 'g1', p_talked: false, p_at: '2026-11-02T13:00' } }))
    expect(await within(scheduled).findByText('Shares Mon 13:00')).toBeInTheDocument()
    expect(within(scheduled).queryByRole('button', { name: /^Move to/ })).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60 * MINUTE + MINUTE) })
    expect(await screen.findByRole('region', { name: 'Shared at Mon 13:00' })).toBeInTheDocument()
    expect(screen.getByText('Plan shared')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Scheduled' })).toBeNull()
  })

  it('Share now sends a waiting plan at once, with no new tick', async () => {
    const user = userEvent.setup()
    const calls = store({ sharedAt: dubai('2026-11-05T19:30') })
    shareStep()
    const scheduled = await screen.findByRole('region', { name: 'Scheduled' })
    await user.click(within(scheduled).getByRole('button', { name: 'Share now' }))
    await waitFor(() => expect(calls.map(call => call.fn)).toEqual(['save plan', 'save line-up', 'share']))
    expect(calls[2].body).toEqual({ p_event_id: 'g1', p_talked: false })
    expect(await screen.findByRole('region', { name: /^Shared at / })).toBeInTheDocument()
  })

  it('a refused time says why and keeps what was picked', async () => {
    const user = userEvent.setup()
    store()
    server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/schedule_game_plan`, () =>
      HttpResponse.json({ code: 'P0001', message: 'Select a time before kick-off' }, { status: 400 })))
    shareStep()
    await screen.findByRole('region', { name: 'Game plan review' })
    await user.click(screen.getByRole('checkbox', { name: /talked selection through/ }))
    await user.click(screen.getByRole('button', { name: 'Share plan more actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Schedule' }))
    await pickDate(user, 'Day', '2026-11-07')
    await pickTime(user, 'Time', '11:00')
    await user.click(screen.getByRole('button', { name: 'Schedule for Sat 11:00' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Select a time before kick-off')
    expect(screen.getByRole('button', { name: 'Schedule for Sat 11:00' })).toBeEnabled()
  })
})
