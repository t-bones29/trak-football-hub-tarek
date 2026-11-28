/**
 * TRAK-356 (Season plan 8/18, spec TRAK-348): Share, View plan and edits after sharing. Share works with zero
 * objectives; the face-to-face tick shows only when there's something to tell, and Share waits for it; Share needs the
 * season's dates. Once shared, Home's Continue is View plan, the set-up steps never come back, every Edit is one screen
 * whose Cancel changes nothing, a removed objective shows in its history, and Share the changes clears the banner.
 * Synthetic people; the stand-in backend keeps the plan's list of changes as the database does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'

type Plan = {
  id: string; squad: string; starts_on: string | null; ends_on: string | null; shared_at: string | null; positions_known: string | null
  watch_rule: string; last_shared_at: string | null; unshared_parts: string[]; unshared_players: string[]
}
type SeasonObjective = { id: string; plan_id: string; place: number; title: string; looks_like: string; status: string; created_at: string; retired_at: string | null }
type PlayerObjective = {
  id: string; squad_player_id: string; title: string; source: string; season_objective_id: string | null; created_at: string; status: string; retired_at: string | null
}

const NOW = '2026-11-06T09:00:00Z'
const SHARED = '2026-11-01T10:00:00Z'
let n = 0
let COACH = { id: 'coach-356' }
let plan: Plan
let objectives: SeasonObjective[] = []
let held: PlayerObjective[] = []
let writes: { method: string; table: string; body: unknown }[] = []
let shares: { p_plan_id: string; p_talked: boolean }[] = []
let watches: { squad_player_id: string; since: string }[] = []

const child = (id: string, name: string, position: string | null) => ({
  id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: 4, position,
  created_at: '2026-10-01T08:00:00Z', linked_player_id: `child-${id}`,
})
const seasonObjective = (id: string, place: number, title: string): SeasonObjective =>
  ({ id, plan_id: 'plan-1', place, title, looks_like: '', status: 'open', created_at: '2026-09-01T08:00:00Z', retired_at: null })
const playerObjective = (id: string, player: string, title: string, retired_at: string | null = null): PlayerObjective =>
  ({ id, squad_player_id: player, title, source: 'library', season_objective_id: null, created_at: SHARED, status: retired_at ? 'retired' : 'open', retired_at })
const sharedPlan = () => { plan = { ...plan, shared_at: SHARED, last_shared_at: SHARED } }
/** The ids a write names: `id=eq.x` or `id=in.(x,y)`. */
const idsOf = (url: URL) => (url.searchParams.get('id') ?? '').replace(/^(eq\.|in\.\()|\)$/g, '').split(',').map(id => id.replace(/"/g, ''))
/** As the database: once shared, a change waits on the plan's list until the coach shares it. */
const note = (part: string) => { if (plan.shared_at && !plan.unshared_parts.includes(part)) plan = { ...plan, unshared_parts: [...plan.unshared_parts, part] } }

beforeEach(() => {
  // Today is NOW: on the real clock the plan's first report day (Sun 29 Nov, the season's third month) fell due, and
  // Home's "Reports ready" to-do hid the suggestions these tests open.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  localStorage.clear()
  COACH = { id: `coach-356-${++n}` }
  plan = { id: 'plan-1', squad: 'U16', starts_on: '2026-09-01', ends_on: '2027-06-30', shared_at: null, positions_known: 'yes',
    watch_rule: 't2', last_shared_at: null, unshared_parts: [], unshared_players: [] }
  objectives = []
  held = []
  writes = []
  shares = []
  watches = []
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('pat', 'Pat Synthetic', 'Defender'), child('quinn', 'Quinn Synthetic', 'Midfielder')]),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    // TRAK-364: a shared plan's evaluations; none published.
    table('season_evaluations', []),
    http.get(`${SUPABASE_URL}/rest/v1/season_plans`, () => HttpResponse.json([plan])),
    http.patch(`${SUPABASE_URL}/rest/v1/season_plans`, async ({ request }) => {
      const body = await request.json() as Partial<Plan>
      writes.push({ method: 'PATCH', table: 'season_plans', body })
      if ((body.starts_on !== undefined && body.starts_on !== plan.starts_on) || (body.ends_on !== undefined && body.ends_on !== plan.ends_on)) note('dates')
      plan = { ...plan, ...body }
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/season_objectives`, () => HttpResponse.json([...objectives].sort((a, b) => a.place - b.place))),
    http.post(`${SUPABASE_URL}/rest/v1/season_objectives`, async ({ request }) => {
      const body = await request.json() as Pick<SeasonObjective, 'plan_id' | 'place' | 'title' | 'looks_like'>[]
      writes.push({ method: 'POST', table: 'season_objectives', body })
      objectives.push(...body.map((o, i) => ({ ...o, id: `so-new-${objectives.length + i}`, status: 'open', created_at: NOW, retired_at: null })))
      note('season_objectives')
      return new HttpResponse(null, { status: 201 })
    }),
    http.patch(`${SUPABASE_URL}/rest/v1/season_objectives`, async ({ request }) => {
      const url = new URL(request.url), body = await request.json() as Partial<SeasonObjective>
      writes.push({ method: 'PATCH', table: 'season_objectives', body })
      objectives = objectives.map(o => (idsOf(url).includes(o.id) ? { ...o, ...body, retired_at: body.status === 'retired' ? NOW : o.retired_at } : o))
      note('season_objectives')
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(`${SUPABASE_URL}/rest/v1/season_objectives`, ({ request }) => {
      writes.push({ method: 'DELETE', table: 'season_objectives', body: idsOf(new URL(request.url)) })
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/player_objectives`, () => HttpResponse.json(held)),
    // TRAK-355: who is watched first.
    http.get(`${SUPABASE_URL}/rest/v1/player_watches`, () => HttpResponse.json(watches)),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/share_season_plan`, async ({ request }) => {
      shares.push(await request.json() as (typeof shares)[number])
      plan = { ...plan, shared_at: plan.shared_at ?? NOW, last_shared_at: NOW, unshared_parts: [], unshared_players: [] }
      return HttpResponse.json(NOW)
    }),
    // Home, and a player's page.
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('coach_calendar_events', []),
    table('event_absences', []),
    table('event_confirmations', []),
    table('notification_settings', []),
    table('game_plans', []),
    table('game_evaluations', []),
    rpc('game_plan_changes', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json([])),
    table('training_notes', []),
    table('squad_player_also_plays', []), table('squad_player_roles', []), table('squad_position_history', []),
    table('squad_player_profiles', []),
    rpc('coach_player_birth_dates', () => []),
    rpc('coach_squad_season', () => []),
    table('coach_assessment_notes', []),
    table('coach_shared_feedback', []),
    // The pitch-ready page's pitch (24 Nov): no default formation, so Positions shows the list.
    table('formations', []),
  )
})
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear(); vi.useRealTimers() })

const user = () => userEvent.setup()
const TICK = 'I’ve talked objectives through with the players, face to face'

describe('TRAK-356 Share', () => {
  it('shares with zero objectives: no tick, no claim that players and families cannot see it, and the plan opens shared', async () => {
    renderApp('/coach/season-plan/share')
    expect(await screen.findByRole('heading', { name: 'What goes out' })).toBeInTheDocument()
    expect(screen.queryByText(/don.t see the season plan/)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    await user().click(screen.getByRole('button', { name: 'Share now' }))
    await waitFor(() => expect(shares).toEqual([{ p_plan_id: 'plan-1', p_talked: false }]))
    expect(await screen.findByText('Shared · 6 Nov')).toBeInTheDocument()
    // TRAK-494 (Kostas, 20 Nov): the Shared box is its title alone.
    expect(screen.queryByText('Edits wait here until you share them.')).toBeNull()
    expect(screen.queryByText(/don.t see the season plan/)).toBeNull()
    expect(window.location.pathname).toBe('/coach/season-plan')
    expect(screen.queryByRole('navigation', { name: 'Season plan steps' })).toBeNull()
  }, 30_000)

  it('shows the tick only when there is something to tell, and waits for it', async () => {
    objectives = [seasonObjective('so-1', 1, 'Stay compact')]
    renderApp('/coach/season-plan/share')
    expect(await screen.findByRole('checkbox', { name: TICK })).toBeInTheDocument()

    cleanup()
    objectives = []
    held = [playerObjective('po-1', 'pat', 'Wins their headers')]
    renderApp('/coach/season-plan/share')
    const tick = await screen.findByRole('checkbox', { name: TICK })
    const share = screen.getByRole('button', { name: 'Share now' })
    expect(share).toBeDisabled()
    expect(screen.getByText('Tick that you’ve talked it through first')).toBeInTheDocument()
    await user().click(tick)
    expect(share).toBeEnabled()
    await user().click(share)
    await waitFor(() => expect(shares).toEqual([{ p_plan_id: 'plan-1', p_talked: true }]))
  }, 30_000)

  it('needs the season’s dates, and sends the coach back for them', async () => {
    plan = { ...plan, starts_on: null, ends_on: null }
    renderApp('/coach/season-plan/share')
    expect(await screen.findByText('No dates yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share now' })).toBeDisabled()
    await user().click(screen.getByRole('button', { name: 'Add the season’s dates first' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/season-plan'))
    expect(shares).toEqual([])
  })
})

describe('TRAK-356 once shared', () => {
  it('Home says View plan, and the set-up steps never come back', async () => {
    sharedPlan()
    renderApp('/coach/home')
    // TRAK-361: the card folds; open, it offers View plan. TRAK-549: the state is a label, the weeks left beside it.
    const card = await screen.findByRole('region', { name: 'U16 season plan' })
    expect(await within(card).findByText('Shared 1 Nov')).toBeInTheDocument()
    expect(within(card).getByText(/^\d+ weeks? left$/)).toBeInTheDocument()
    await user().click(within(card).getByRole('button', { name: 'Open the U16 season plan' }))
    await user().click(screen.getByRole('button', { name: 'View plan' }))
    expect(await screen.findByText('Shared · 1 Nov')).toBeInTheDocument()
    for (const step of ['positions', 'objectives', 'share']) {
      cleanup()
      renderApp(`/coach/season-plan/${step}`)
      expect(await screen.findByText('Shared · 1 Nov')).toBeInTheDocument()
      expect(window.location.pathname).toBe('/coach/season-plan')
      expect(screen.queryByRole('navigation', { name: 'Season plan steps' })).toBeNull()
    }
  }, 30_000)

  it('every Edit is one screen, and Cancel changes nothing', async () => {
    sharedPlan()
    objectives = [seasonObjective('so-1', 1, 'Win it back within 5 seconds'), seasonObjective('so-2', 2, 'Stay compact')]
    renderApp('/coach/season-plan')
    await user().click(await screen.findByRole('button', { name: 'Edit Objectives' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Season objectives' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Season plan steps' })).toBeNull()
    await user().type(screen.getByLabelText('Objective 1'), ', always')
    await user().click(screen.getByRole('button', { name: 'Remove Stay compact' }))
    await user().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Shared · 1 Nov')).toBeInTheDocument()
    expect(screen.getByText('Win it back within 5 seconds')).toBeInTheDocument()
    expect(screen.getByText('Stay compact')).toBeInTheDocument()

    // 24 Nov: the dates and reports share one Edit schedule screen.
    await user().click(screen.getByRole('button', { name: 'Edit Schedule' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Season schedule' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user().click(screen.getByRole('button', { name: 'Season plan' }))
    expect(await screen.findByText('Shared · 1 Nov')).toBeInTheDocument()
    expect(writes).toEqual([])
  }, 30_000)

  it('removing a season objective retires it into its history, and Share the changes clears the banner', async () => {
    sharedPlan()
    objectives = [seasonObjective('so-1', 1, 'Win it back within 5 seconds'), seasonObjective('so-2', 2, 'Stay compact')]
    renderApp('/coach/season-plan')
    await user().click(await screen.findByRole('button', { name: 'Edit Objectives' }))
    await user().click(await screen.findByRole('button', { name: 'Remove Stay compact' }))
    await user().click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Not shared yet: season objectives.')).toBeInTheDocument()
    expect(writes).toEqual([{ method: 'PATCH', table: 'season_objectives', body: { status: 'retired' } }])
    const removed = screen.getByRole('heading', { name: 'Removed' }).parentElement!
    // September is "Sept" or "Sep", by the runtime's ICU: the app's own format.
    const added = new Date('2026-09-01T08:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    expect(removed).toHaveTextContent(`Stay compact · added ${added}, removed 6 Nov`)
    expect(within(screen.getByRole('region', { name: 'Core tactical objectives' })).getAllByRole('listitem')[0]).toHaveTextContent('Win it back within 5 seconds')

    await user().click(screen.getByRole('button', { name: 'Share the changes' }))
    await waitFor(() => expect(shares).toEqual([{ p_plan_id: 'plan-1', p_talked: false }]))
    expect(await screen.findByText('Shared · 6 Nov')).toBeInTheDocument()
    // The banner's old line crossfades out (Arc's alert).
    await waitFor(() => expect(screen.queryByText(/^Not shared yet/)).toBeNull())
    expect(screen.queryByRole('button', { name: 'Share the changes' })).toBeNull()
  }, 30_000)

  it('a player with no position is one tap from it: Home’s Place them lands on the plan, the name opens the sheet', async () => {
    sharedPlan()
    server.use(table('squad_players', [child('pat', 'Pat Synthetic', 'Defender'), child('uma', 'Uma Synthetic', null)]))
    renderApp('/coach/home')
    await user().click(await screen.findByRole('button', { name: 'Place them' }))
    expect(await screen.findByText('Shared · 1 Nov')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/coach/season-plan')
    // The header shows while the plan loads (24 Nov), so wait for the card itself.
    const positions = await screen.findByRole('region', { name: 'Positions' })
    expect(positions).toHaveTextContent(/1 \/ 2\s*players placed/)
    await user().click(within(positions).getByRole('button', { name: 'Uma Synthetic' }))
    expect(await screen.findByRole('dialog', { name: "Uma's position and roles" })).toBeInTheDocument()
  }, 30_000)

  it('names what waits, each player by first name, and a removed player objective shows in their history', async () => {
    sharedPlan()
    plan = { ...plan, unshared_parts: ['dates'], unshared_players: ['quinn'] }
    held = [playerObjective('po-gone', 'pat', 'Wins their headers', '2026-11-05T10:00:00Z')]
    renderApp('/coach/season-plan')
    expect(await screen.findByText('Not shared yet: season dates, Quinn’s objectives.')).toBeInTheDocument()
    // 24 Nov: the header's pill says changes wait; the player rows no longer fold.
    expect(screen.getByText('Changes not shared')).toBeInTheDocument()
    const players = screen.getByRole('region', { name: 'Player Objectives' })
    expect(within(players).getByRole('button', { name: /^Pat Synthetic/ })).toHaveTextContent('Removed: Wins their headers (5 Nov)')

    cleanup()
    renderApp('/coach/squad/player/pat')
    const section = await screen.findByRole('region', { name: 'Objective' })
    expect(within(section).getByText('No objective yet.')).toBeInTheDocument()
    expect(section).toHaveTextContent('Wins their headers · given 1 Nov, removed 5 Nov')
  }, 30_000)

  // TRAK-423: an Edit screen has no grey "Edit" over its title. 24 Nov (mockup): a player's row ends in a chevron,
  // its accessible name still ending in Edit.
  it("a player's row ends in the chevron, and an Edit screen is titled by its part alone", async () => {
    sharedPlan()
    renderApp('/coach/season-plan')
    const pat = within(await screen.findByRole('region', { name: 'Player Objectives' })).getByRole('button', { name: /^Pat Synthetic/ })
    expect(pat.querySelector('svg.lucide-chevron-right')).not.toBeNull()
    expect(pat).toHaveAccessibleName(/Edit$/)
    expect(within(pat).queryByText('Edit', { ignore: '.sr-only' })).toBeNull()

    await user().click(screen.getByRole('button', { name: 'Edit Schedule' }))
    const title = await screen.findByRole('heading', { level: 1, name: 'Season schedule' })
    expect(title.closest('header')).not.toHaveTextContent(/^Edit/)
  }, 30_000)

  it('names who is watched first on the Share step, with the reminder', async () => {
    watches = [{ squad_player_id: 'quinn', since: new Date(Date.now() - 2 * 86400_000).toISOString() }]
    renderApp('/coach/season-plan/share')
    const watching = await screen.findByRole('region', { name: /^Watching first/ })
    expect(watching).toHaveTextContent('Quinn Synthetic')
    expect(within(watching).getByRole('group', { name: 'Remind me' })).toBeInTheDocument()
  }, 30_000)

  it('once shared: Watching lists who is watched, and the reminder is one screen that never waits to be shared', async () => {
    sharedPlan()
    watches = [{ squad_player_id: 'quinn', since: new Date(Date.now() - 2 * 86400_000).toISOString() }]
    renderApp('/coach/season-plan')
    const watching = await screen.findByRole('region', { name: /^Watching/ })
    // No trainings on the schedule or in the register: the squad's reminder counts weeks (TRAK-355).
    expect(watching).toHaveTextContent('Reminder after 2 weeks, 4 weeks at the latest.')
    expect(watching).toHaveTextContent('Quinn Synthetic')
    expect(watching).toHaveTextContent('0 of 2 weeks so far')

    await user().click(within(watching).getByRole('button', { name: 'Edit Reminder' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Watching reminder' })).toBeInTheDocument()
    expect(screen.getByText('Only you see this.')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: '4 weeks' }))
    await user().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Shared · 1 Nov')).toBeInTheDocument()
    expect(writes).toEqual([])

    await user().click(screen.getByRole('button', { name: 'Edit Reminder' }))
    await user().click(await screen.findByRole('button', { name: '4 weeks' }))
    await user().click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Shared · 1 Nov')).toBeInTheDocument()
    expect(writes).toEqual([{ method: 'PATCH', table: 'season_plans', body: { watch_rule: 'w4' } }])
    expect(screen.queryByText(/^Not shared yet/)).toBeNull()
  }, 30_000)

  it('once shared, Home’s Set up for a due watched player opens their sheet on the plan', async () => {
    sharedPlan()
    watches = [{ squad_player_id: 'pat', since: new Date(Date.now() - 30 * 86400_000).toISOString() }]
    renderApp('/coach/home')
    expect(await screen.findByText('Watched 2 weeks')).toBeInTheDocument()
    expect(screen.getByText('Set Pat up')).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: 'Set up' }))
    const sheet = await screen.findByRole('dialog', { name: "Pat's objectives" })
    expect(window.location.pathname).toBe('/coach/season-plan')
    expect(within(sheet).getByRole('button', { name: 'Keep watching' })).toBeInTheDocument()
  }, 30_000)
})

