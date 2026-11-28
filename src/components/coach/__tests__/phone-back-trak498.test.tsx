/**
 * TRAK-498 (Imad, 19–20 Nov): on a phone, every page below a tab's first page has a back arrow in its header, and the
 * Home tab always lands on Home. The arrow goes back where the coach came from; opened from a link, to the page above it
 * on its trail. A laptop is unchanged (its top bar is the trail). Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'
import { SIDE_MENU_QUERY } from '@/lib/side-menu-screen'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-498' }
const realMatchMedia = window.matchMedia
function screenIs(laptop: boolean) {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: laptop && query === SIDE_MENU_QUERY })) as typeof window.matchMedia
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(laptop ? 1440 : 390)
}

/** A Dubai academy's match `days` from now (UTC+4 all year). */
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

beforeEach(() => {
  COACH = { id: `coach-498-${++n}` }
  signInAs(COACH)
  server.use(
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
    table('formation_copies', []),
    rpc('game_plan_changes', () => []),
    table('season_plans', []),
    table('season_objectives', []),
    table('player_objectives', []),
    table('season_evaluations', []),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); window.matchMedia = realMatchMedia; vi.restoreAllMocks() })

/** The page's back arrow, beside its trail. */
const backArrow = async () => {
  const trail = await screen.findByRole('navigation', { name: 'Breadcrumb trail' })
  return within(trail.closest('[data-trail]') as HTMLElement).getByRole('link', { name: 'Back' })
}

describe('TRAK-498: a way back on a phone', { timeout: 30_000 }, () => {
  it('a match opened from Matches: the arrow goes back to Matches', async () => {
    screenIs(false)
    const user = userEvent.setup()
    renderApp('/coach/matches')
    await user.click(within(await screen.findByRole('region', { name: 'Upcoming matches' })).getByRole('link', { name: /Parkview Athletic/ }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/matches/g1'))
    await user.click(await backArrow())
    await waitFor(() => expect(window.location.pathname).toBe('/coach/matches'))
  })

  it('a match opened from a link: the arrow goes to Matches, its tab\'s first page', async () => {
    screenIs(false)
    renderApp('/coach/matches/g1?tab=plan')
    expect(await backArrow()).toHaveAttribute('href', '/coach/matches')
  })

  it('Season plan: the arrow goes to Home, and so does the Home tab, though Home is the tab it sits under', async () => {
    screenIs(false)
    const user = userEvent.setup()
    renderApp('/coach/season-plan')
    expect(await backArrow()).toHaveAttribute('href', '/coach/home')
    const tabs = screen.getByRole('tablist', { name: 'Coach' })
    expect(within(tabs).getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
    await user.click(within(tabs).getByRole('tab', { name: 'Home' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/home'))
  })

  it('on a laptop nothing changes: no arrow, the top bar is the trail', async () => {
    screenIs(true)
    renderApp('/coach/matches/g1?tab=plan')
    expect(await screen.findByRole('link', { name: 'Matches' })).toHaveAttribute('href', '/coach/matches')
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull()
  })
})

// TRAK-540 (Imad, 22 Nov): Events gets the arrow too, beside the avatar (it is a nav row, so it has no trail).
describe('TRAK-540: Events on a phone has the arrow too', { timeout: 30_000 }, () => {
  it('opened from Home\'s calendar icon: one tap goes back to Home', async () => {
    screenIs(false)
    const user = userEvent.setup()
    renderApp('/coach/home')
    await user.click(await screen.findByRole('link', { name: 'Events' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/schedule'))
    await user.click(await screen.findByRole('link', { name: 'Back' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/home'))
  })

  it('opened from a link: the arrow goes to Home', async () => {
    screenIs(false)
    renderApp('/coach/schedule')
    expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '/coach/home')
  })

  it('on a laptop Events has no arrow: it is a row in the sidebar', async () => {
    screenIs(true)
    renderApp('/coach/schedule')
    await screen.findByRole('heading', { name: 'Events' })
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull()
  })
})
