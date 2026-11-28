/**
 * TRAK-347 (Imad, 3 Nov, Matches round 3): "you should have simply turned what we already had into breadcrumbs". On a
 * laptop the top bar is the trail: "Matches / vs Parkview Athletic", every crumb but the last a link that goes back as
 * TRAK-334's trail does, and the club's name is gone from it (the sidebar shows it by its logo). The page has no trail
 * of its own there. A phone keeps TRAK-334's trail at the top of the page (coach-trail-trak334). Test people are named
 * after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-347' }

function game(id: string, opponent: string, days: number) {
  const kickOff = Math.ceil((Date.now() + days * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `vs ${opponent}`, event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent, home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null, family_note: null, notes: null,
    series_id: null, training_themes: [], cancel_reason: null,
  }
}

const realMatchMedia = window.matchMedia
beforeEach(() => {
  // A laptop: the frame's sidebar and top bar. jsdom lays nothing out, so the frame is told it is wide.
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: query === SIDE_MENU_QUERY })) as typeof window.matchMedia
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440)
  COACH = { id: `coach-347-${++n}` }
  signInAs(COACH)
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' }]),
    table('coach_calendar_events', [game('g1', 'Parkview Athletic', 3)]),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('notification_settings', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_plans', []),
    table('game_plan_players', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); window.matchMedia = realMatchMedia; vi.restoreAllMocks() })

const topBar = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
/** The top bar's crumbs, as the coach reads them, once it ends with `last`. */
async function crumbs(last: string) {
  await waitFor(() => expect(within(topBar()).getAllByRole('listitem').at(-1)).toHaveTextContent(last))
  return within(topBar()).getAllByRole('listitem').map(item => item.textContent)
}

describe('TRAK-347: on a laptop, the top bar is the trail', { timeout: 30_000 }, () => {
  it('a nav row shows its name only: no club', async () => {
    renderApp('/coach/matches')
    await screen.findByRole('region', { name: 'Upcoming matches' })
    expect(await crumbs('Matches')).toEqual(['Matches'])
    expect(within(topBar()).queryByText('Rehearsal FC')).toBeNull()
  })

  it('from Matches: Matches / vs Parkview Athletic, with no trail on the page; Matches goes back', async () => {
    const user = userEvent.setup()
    renderApp('/coach/matches')
    await user.click(within(await screen.findByRole('region', { name: 'Upcoming matches' })).getByRole('link', { name: /Parkview Athletic/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'vs Parkview Athletic' })).toBeInTheDocument()
    expect(await crumbs('vs Parkview Athletic')).toEqual(['Matches', 'vs Parkview Athletic'])
    expect(within(topBar()).getByText('vs Parkview Athletic').closest('li')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb trail' })).toBeNull()

    await user.click(within(topBar()).getByRole('link', { name: 'Matches' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/matches'))
    expect(await crumbs('Matches')).toEqual(['Matches'])
  })

  it('from Home: Home / vs Parkview Athletic, and Home goes back', async () => {
    const user = userEvent.setup()
    renderApp('/coach/home')
    // TRAK-608: on a day with no events, the To-do takes the next match's next step.
    const todo = await screen.findByRole('region', { name: 'To-do' }, { timeout: 5000 })
    const card = (await within(todo).findByText('Write the plan for Parkview Athletic', {}, { timeout: 5000 })).closest('li')!
    await user.click(within(card).getByRole('button', { name: 'Write plan' }))
    expect(await crumbs('vs Parkview Athletic')).toEqual(['Home', 'vs Parkview Athletic'])
    await user.click(within(topBar()).getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/home'))
  })

  it('while a page\'s name loads, the top bar shows its nav row\'s: Squad for a player', async () => {
    // The squad never answers, so the player's page never learns the name.
    server.use(http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => new Promise<never>(() => {})))
    renderApp('/coach/squad/player/sp-1')
    expect(await crumbs('Squad')).toEqual(['Squad'])
  })

  it('opened from a link (or after a refresh), it starts at Matches, its nav row', async () => {
    renderApp('/coach/matches/g1?tab=plan')
    expect(await crumbs('vs Parkview Athletic')).toEqual(['Matches', 'vs Parkview Athletic'])
    expect(within(topBar()).getByRole('link', { name: 'Matches' })).toHaveAttribute('href', '/coach/matches')
  })
})
