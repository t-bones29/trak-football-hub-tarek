/**
 * Match header (Imad, 6 Nov, Concept A): Arc's Page header over Logistics, Game plan and Evaluation, with each match's
 * own details. Before kick-off it offers Review game plan (Review & share on the Game plan tab), Save draft where the
 * plan is on screen, and Schedule share in its "…" menu; Evaluation waits until after the match. After full time it
 * offers Review evaluation (Review & publish on its tab) and Save draft on the Evaluation tab. Test people are named
 * after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { rpc, table, SUPABASE_URL } from '../../../../tests/msw/supabase'

// The phone sits in the academy's zone (Dubai), so the header shows no second clock.
const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-header' }

/** A Dubai academy's 90-minute match (UTC+4 all year). */
function game(id: string, kickOff: number, over: Record<string, unknown>) {
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id, coach_user_id: COACH.id, title: 'Match', event_type: 'match', published: true, status: 'scheduled', competition: 'league',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    kit: null, kit_snapshot: null, family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null, ...over,
  }
}
const child = (id: string, name: string, squad: string) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: squad, status: 'active', shirt_number: 4, position: 'Defender', created_at: '2026-10-01T08:00:00Z' })

/** Rows filtered by the `eq.` filters the app sends, so each match reads its own. */
function rows(name: string, all: () => Record<string, unknown>[]) {
  return http.get(`${SUPABASE_URL}/rest/v1/${name}`, ({ request }) => {
    const filters = [...new URL(request.url).searchParams].filter(([, value]) => value.startsWith('eq.'))
    return HttpResponse.json(all().filter(row => filters.every(([key, value]) => !(key in row) || String(row[key]) === value.slice(3))))
  })
}

let matches: Record<string, unknown>[]
let planSaves: unknown[]
let evaluationSaves: Record<string, unknown>[]

beforeEach(() => {
  COACH = { id: `coach-header-${++n}` }
  signInAs(COACH)
  planSaves = []
  evaluationSaves = []
  const soon = Math.ceil((Date.now() + 3 * DAY) / MINUTE) * MINUTE
  matches = [
    // Before kick-off: Evaluation waits.
    game('g1', soon, { squad: 'U16', opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park' }),
    // Three hours after kick-off: full time, the evaluation is open.
    game('g2', Date.now() - 3 * 60 * MINUTE, { squad: 'U17', opponent: 'Mirdif Rangers', home_away: 'away', venue: 'Mirdif Stadium' }),
  ]
  server.use(
    // TRAK-363: the plan's Instructions offer the squad's season objectives.
    table('season_plans', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('zagorakis', 'Theodoros Zagorakis', 'U16'), child('dellas', 'Traianos Dellas', 'U16'), child('karagounis', 'Giorgos Karagounis', 'U17')]),
    rows('coach_calendar_events', () => matches),
    rows('game_plans', () => [{ event_id: 'g2', strength: 'similar', their_formation: null, key_players: [], scouting: '', format: 11, formation: '4-4-2',
      goals: [], created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z' }]),
    rows('game_plan_players', () => [{ event_id: 'g2', squad_player_id: 'karagounis', role: 'starter', slot: 4, job: 'Hold the middle.', note: '', context: [], expectation: 'usual' }]),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => { planSaves.push(await request.json()); return new HttpResponse(null, { status: 201 }) }),
    http.post(`${SUPABASE_URL}/rest/v1/game_plan_players`, () => new HttpResponse(null, { status: 201 })),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
    rpc('game_plan_changes', () => []),
    table('event_confirmations', []),
    table('event_absences', []),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    rpc('save_game_evaluation', args => { evaluationSaves.push(args); return '2026-11-06T12:00:00Z' }),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

const header = (title: string) => screen.findByRole('region', { name: title })
/** The header's own buttons: the region also holds the tab's panel, whose steps can share a name ("Review & share"). */
const inHeader = (buttons: HTMLElement[]) => buttons.filter(button => !button.closest('[role="tabpanel"]'))
const headerButton = (name: string) => {
  const found = inHeader(screen.getAllByRole('button', { name }))
  expect(found).toHaveLength(1)
  return found[0]
}
const noHeaderButton = (name: string | RegExp) => expect(inHeader(screen.queryAllByRole('button', { name }))).toHaveLength(0)
/** The header's details row, under the title and its status. */
const details = () => screen.getByRole('heading', { level: 1 }).parentElement!.nextElementSibling as HTMLElement
const tab = (name: RegExp) => within(screen.getByRole('tablist', { name: 'This match' })).getByRole('tab', { name })

describe('Match header', { timeout: 30_000 }, () => {
  it("before kick-off: the match's own details, Evaluation after the match, and the plan's actions", async () => {
    const user = userEvent.setup()
    renderApp('/coach/matches/g1')
    const top = await header('vs Parkview Athletic')
    expect(within(top).getByRole('heading', { level: 1, name: 'vs Parkview Athletic' })).toBeInTheDocument()
    expect(within(top).getByText('Plan not written')).toBeInTheDocument()
    // Imad, 6 Nov: the kick-off is its own item (a clock), apart from the day; the squad is its age group alone.
    expect(Array.from(details().children, item => item.textContent)).toEqual([expect.stringMatching(/^\w{3} \d{1,2} \w{3}$/),
      expect.stringMatching(/^Kick-off \d\d:\d\d$/), 'Rehearsal Park · Home', 'U16'])
    expect(tab(/^Logistics/)).toHaveAccessibleName('Logistics shared')
    // TRAK-516 (Imad, 20 Nov): no "After the match" beside Evaluation.
    expect(tab(/^Evaluation/)).toHaveAccessibleName('Evaluation')
    expect(await within(top).findByRole('tab', { name: 'Game plan 4 to do' }, { timeout: 5000 })).toBeInTheDocument()
    expect(details()).toHaveTextContent(/U16$/)

    // Logistics has no draft of its own: no Save draft. Review game plan opens Review & share.
    noHeaderButton('Save draft')
    await user.click(headerButton('Review game plan'))
    expect(await screen.findByRole('region', { name: 'Game plan review' })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=plan')
    expect(tab(/^Game plan/)).toHaveAttribute('aria-selected', 'true')
    headerButton('Review & share')

    // Save draft, in the header, saves the plan on screen.
    await user.click(headerButton('Save draft'))
    await waitFor(() => headerButton('Saved'))
    expect(planSaves).toHaveLength(1)
    expect(planSaves[0]).toMatchObject({ event_id: 'g1' })
  })

  it("the menu's Schedule share opens Review & share with its day and time", async () => {
    const user = userEvent.setup()
    renderApp('/coach/matches/g1')
    const top = await header('vs Parkview Athletic')
    await user.click(headerButton('More actions'))
    await user.click(await screen.findByRole('menuitem', { name: 'Schedule share' }))
    const review = await screen.findByRole('region', { name: 'Game plan review' })
    expect(await within(review).findByText('Any time before kick-off. Until then, only you see it.')).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=plan')
  })

  it('after full time: another match, its own details, and the evaluation open with its actions', async () => {
    const user = userEvent.setup()
    renderApp('/coach/matches/g1')
    expect(await header('vs Parkview Athletic')).toBeInTheDocument()
    cleanup()

    renderApp('/coach/matches/g2')
    const top = await header('vs Mirdif Rangers')
    expect(within(top).getByText('Full time')).toBeInTheDocument()
    expect(top).toHaveTextContent('Mirdif Stadium · Away')
    expect(details().lastElementChild).toHaveTextContent(/^U17$/)
    expect(tab(/^Evaluation/)).toHaveAccessibleName('Evaluation')
    // Locked at kick-off: nothing left to do on the plan, and no menu.
    expect(tab(/^Game plan/)).toHaveAccessibleName('Game plan')
    noHeaderButton('More actions')

    await user.click(headerButton('Review evaluation'))
    expect(await screen.findByRole('region', { name: 'Evaluation review' })).toBeInTheDocument()
    expect(window.location.search).toBe('?tab=evaluation')
    headerButton('Review & publish')

    await waitFor(() => headerButton('Save draft'))
    await user.click(headerButton('Save draft'))
    await waitFor(() => headerButton('Saved'))
    expect(evaluationSaves).toHaveLength(1)
    expect(evaluationSaves[0]).toMatchObject({ p_event_id: 'g2' })
  })

  it('a cancelled match: its header with Cancelled, and no tabs or actions', async () => {
    matches[0] = { ...matches[0], status: 'cancelled' }
    renderApp('/coach/matches/g1')
    const top = await header('vs Parkview Athletic')
    expect(within(top).getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getByText('This match was cancelled.')).toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'This match' })).toBeNull()
    noHeaderButton(/Review|Save draft|More actions/)
  })

  it("a failed save says so under the tabs and keeps what's typed", async () => {
    const user = userEvent.setup()
    server.use(http.post(`${SUPABASE_URL}/rest/v1/game_plans`, () => HttpResponse.json({ message: 'down' }, { status: 500 })))
    renderApp('/coach/matches/g1?tab=plan')
    const top = await header('vs Parkview Athletic')
    await user.click(await screen.findByRole('button', { name: 'Add instruction' }))
    await user.type(screen.getByLabelText('Instruction', { exact: true }), 'Press their 6')
    await user.click(headerButton('Save draft'))
    expect(await within(top).findByRole('alert')).toHaveTextContent("Couldn't save the plan.")
    expect(screen.getByLabelText('Instruction', { exact: true })).toHaveValue('Press their 6')
    await waitFor(() => expect(headerButton('Save draft')).toBeEnabled())
  })
})
