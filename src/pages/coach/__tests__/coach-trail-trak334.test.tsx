/**
 * TRAK-334 (Imad, 2 Nov, Matches round 2 item 1): a coach page reached by clicking into something shows a trail at its
 * top, where its back link was, and the first crumb is where the coach came from. Opened from a link, it starts at the
 * page's own nav row; the page's own tabs add nothing. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-334-trail' }

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
  COACH = { id: `coach-334-trail-${++n}` }
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
afterEach(() => { cleanup(); localStorage.clear() })

/** The trail's crumbs, as the coach reads them, once the page has its name. */
async function crumbs(last: string) {
  const nav = await screen.findByRole('navigation', { name: 'Breadcrumb trail' })
  await waitFor(() => expect(within(nav).getAllByRole('listitem').at(-1)).toHaveTextContent(last))
  return within(nav).getAllByRole('listitem').map(item => item.textContent)
}

describe('TRAK-334: a match page\'s trail', { timeout: 30_000 }, () => {
  it('opened from Home it reads Home › vs Parkview Athletic; its own tabs add nothing; Home goes back', async () => {
    const user = userEvent.setup()
    renderApp('/coach/home')
    // TRAK-608: on a day with no events, the To-do takes the next match's next step.
    const todo = await screen.findByRole('region', { name: 'To-do' }, { timeout: 5000 })
    const card = (await within(todo).findByText('Write the plan for Parkview Athletic', {}, { timeout: 5000 })).closest('li')!
    await user.click(within(card).getByRole('button', { name: 'Write plan' }))
    expect(await crumbs('vs Parkview Athletic')).toEqual(['Home', 'vs Parkview Athletic'])
    // The back link it replaces is gone, and the page is the current crumb, not a link.
    expect(screen.queryByRole('link', { name: 'Matches' })).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByText('vs Parkview Athletic')).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('tab', { name: /^Logistics/ }))
    expect(await crumbs('vs Parkview Athletic')).toEqual(['Home', 'vs Parkview Athletic'])
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/home'))
  })

  it('opened from Matches it reads Matches › vs Parkview Athletic, and Matches goes back', async () => {
    const user = userEvent.setup()
    renderApp('/coach/matches')
    await user.click(within(await screen.findByRole('region', { name: 'Upcoming matches' })).getByRole('link', { name: /Parkview Athletic/ }))
    expect(await crumbs('vs Parkview Athletic')).toEqual(['Matches', 'vs Parkview Athletic'])
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByRole('link', { name: 'Matches' }))
    await waitFor(() => expect(window.location.pathname).toBe('/coach/matches'))
  })

  it('opened from a link (or after a refresh) it starts at Matches, its own nav row', async () => {
    renderApp('/coach/matches/g1?tab=plan')
    expect(await crumbs('vs Parkview Athletic')).toEqual(['Matches', 'vs Parkview Athletic'])
    expect(within(screen.getByRole('navigation', { name: 'Breadcrumb trail' })).getByRole('link', { name: 'Matches' })).toHaveAttribute('href', '/coach/matches')
  })
})
