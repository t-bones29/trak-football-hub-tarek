/**
 * TRAK-335 (Imad, 2 Nov, Matches round 2 item 4): while a coach page loads, Arc's skeleton shaped like what's coming
 * shows in place of a "Loading…" line, and screen readers still hear what is loading. One page per coach tab, and the
 * Matches pages. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
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
let COACH = { id: 'coach-335-skeleton' }

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
  COACH = { id: `coach-335-skeleton-${++n}` }
  signInAs(COACH)
  server.use(
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

/** Holds every read of `name` until the test lets it go, answering `rows`. */
let release: () => void = () => {}
function hold(name: string, rows: unknown[]) {
  const held = new Promise<void>(resolve => { release = resolve })
  return http.get(`${SUPABASE_URL}/rest/v1/${name}`, async () => { await held; return HttpResponse.json(rows) })
}
afterEach(() => release())

/** The skeleton: a labelled, busy status that shows no words, and no "Loading" line anywhere. */
async function skeleton(label: string) {
  const status = await screen.findByRole('status', { name: label }, { timeout: 5000 })
  expect(status).toHaveAttribute('aria-busy', 'true')
  expect(status.textContent).toBe('')
  expect(screen.queryByText(/^Loading/)).toBeNull()
  return status
}

/** TRAK-461: Arc's Skeleton morph. Placeholders shaped like the page (`blocks` of them, hidden from screen readers) in a
 *  busy region; "Loading …" is heard once, from one status, and no "Loading" line shows. */
async function morph(label: string, blocks: number) {
  // A live status says it in words (a status takes no name from its text, so it is found by them).
  const status = await screen.findByText(label, {}, { timeout: 5000 })
  expect(status).toHaveAttribute('role', 'status')
  expect(screen.getAllByText(label)).toHaveLength(1)
  const region = status.closest('[aria-busy="true"]') as HTMLElement
  expect(region).not.toBeNull()
  expect(region.querySelectorAll('[data-state="skeleton"]')).toHaveLength(blocks)
  for (const placeholder of region.querySelectorAll('[data-state="skeleton"] > [aria-hidden="true"]')) expect(placeholder.textContent).toBe('')
  expect(screen.getAllByText(/^Loading/)).toEqual([status])
  return region
}
/** Once loaded, every placeholder has become the part it stood for, and nothing is heard as loading. */
async function grown(region: HTMLElement, label: string) {
  await waitFor(() => expect(region.querySelectorAll('[data-state="skeleton"]')).toHaveLength(0))
  expect(region).not.toHaveAttribute('aria-busy')
  expect(screen.queryByText(label)).toBeNull()
}

describe('TRAK-335: skeletons while the coach app loads', { timeout: 30_000 }, () => {
  // TRAK-461: placeholders (Next match, the "Your matches" list) grow into the page. TRAK-588: no Open drafts. TRAK-590: no month.
  it('Matches shows placeholders shaped like the page, then they grow into the next match', async () => {
    server.use(hold('coach_calendar_events', [game('g1', 'Parkview Athletic', 3)]))
    renderApp('/coach/matches')
    const region = await morph('Loading your matches…', 2)
    release()
    expect(await screen.findByRole('region', { name: 'Next match' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Open drafts' })).toBeNull()
    await grown(region, 'Loading your matches…')
  })

  it('a match page shows a skeleton, then the match', async () => {
    server.use(hold('coach_calendar_events', [game('g1', 'Parkview Athletic', 3)]))
    renderApp('/coach/matches/g1')
    await skeleton('Loading the match…')
    release()
    expect(await screen.findByRole('heading', { level: 1, name: 'vs Parkview Athletic' })).toBeInTheDocument()
  })

  it('Squad shows a skeleton, then the players', async () => {
    server.use(hold('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U16', status: 'active', created_at: '2026-10-01T08:00:00Z' }]))
    renderApp('/coach/squad')
    await skeleton('Loading your squad…')
    release()
    expect(await screen.findByRole('button', { name: /^Angelos Charisteas/ })).toBeInTheDocument()
  })

  // TRAK-461: one placeholder the size of the week grows into it.
  // TRAK-611: Upcoming took the week strip's place on Home.
  it("Home's Upcoming shows a placeholder while the events load, then the week", async () => {
    server.use(hold('coach_calendar_events', []))
    renderApp('/coach/home')
    const statuses = await screen.findAllByRole('status', { name: 'Loading the next 7 days…' }, { timeout: 5000 })
    expect(statuses.length).toBeGreaterThan(0)
    release()
    expect(await within(await screen.findByRole('region', { name: 'Trainings' })).findByText('None this week.', {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('Training shows a skeleton while it loads', async () => {
    server.use(hold('coach_calendar_events', []))
    renderApp('/coach/training')
    await skeleton('Loading your trainings…')
  })

  it('Events shows card-shaped placeholders for the day, not "Nothing planned", until the events are read', async () => {
    server.use(hold('coach_calendar_events', []))
    renderApp('/coach/schedule')
    // TRAK-461: two placeholders the size of an event's card.
    const region = await morph('Loading your events…', 2)
    expect(screen.queryByText(/Nothing planned/)).toBeNull()
    release()
    expect(await screen.findByText(/Nothing planned/)).toBeInTheDocument()
    await grown(region, 'Loading your events…')
  })
})
