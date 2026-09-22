import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL, table, tableError } from '../../../../tests/msw/supabase'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { supabase } from '@/integrations/supabase/client'
import { authUserForToken } from '../../../../tests/msw/auth-sessions'

/**
 * Regression cases first reproduced red on main 9114f4c, 21 September 2026.
 * Real App/router/RouteGuard/AuthProvider/Supabase SDK; only HTTP is synthetic.
 * No production requests are made by these tests.
 */
const ADMIN = 'academy-admin-test'
const COACH = 'academy-coach-test'
const PLAYER = {
  id: 'academy-roster-test', player_name: 'Synthetic Academy Player',
  coach_user_id: COACH, linked_player_id: 'academy-player-test',
  position: 'Midfielder', age: 15, age_group: 'U15', status: 'active',
}
const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`

function assessment(id: string, score: number, createdAt: string) {
  return {
    id, squad_player_id: PLAYER.id, coach_user_id: COACH,
    work_rate: score, tactical: score, attitude: score,
    technical: score, physical: score, coachability: score, created_at: createdAt,
  }
}

beforeEach(() => {
  signInAs({ id: ADMIN })
  server.use(
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id')
      return HttpResponse.json(filter === `eq.${ADMIN}`
        ? [{ id: 'admin-profile', user_id: ADMIN, role: 'club', full_name: 'Synthetic Director' }]
        : [{ user_id: COACH, role: 'coach', full_name: 'Synthetic Coach' }])
    }),
    table('organizations', [{ id: 'academy-test', name: 'Synthetic Academy', admin_user_id: ADMIN }]),
    table('coach_details', [{ user_id: COACH, current_club: 'Synthetic Academy', team: 'U15 test squad', coach_role: 'Head Coach' }]),
    table('squad_players', [PLAYER]),
    table('coach_assessments', []),
    table('matches', []),
  )
})
afterEach(() => cleanup())

async function loadRoute(route: string, finalTable: string) {
  let responded = false
  const onResponse = ({ request }: { request: Request }) => {
    if (new URL(request.url).pathname === `/rest/v1/${finalTable}`) responded = true
  }
  server.events.on('response:mocked', onResponse)
  try {
    renderApp(route)
    await waitFor(() => expect(responded).toBe(true))
    await screen.findByRole('heading', { name: 'Synthetic Academy' })
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  } finally {
    server.events.removeListener('response:mocked', onResponse)
  }
}

function observed() {
  return `Observed routed UI: ${document.body.textContent}`
}

describe('academy dashboard correctness and recovery', () => {
  it('control: renders a successful populated academy through the real route', async () => {
    await loadRoute('/club/home', 'coach_assessments')
    expect(screen.getByText('1 Coaches')).toBeInTheDocument()
    expect(screen.getByText('1 players')).toBeInTheDocument()
    expect(screen.getByText('Synthetic Coach · Head Coach')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a retryable home error, not zero players and no connected coaches, after a 403', async () => {
    server.use(tableError('coach_details', 403, { code: '42501', message: 'synthetic permission denial' }))
    await loadRoute('/club/home', 'coach_details')
    expect.soft(screen.queryByRole('alert'), observed()).toBeInTheDocument()
    expect.soft(screen.queryByRole('button', { name: /retry|try again/i }), observed()).toBeInTheDocument()
    expect.soft(screen.queryByText(/no coaches connected yet/i), observed()).not.toBeInTheDocument()
    const total = screen.getByText('Total Players').nextElementSibling?.textContent
    expect(total, observed()).not.toBe('0')
  })

  it('shows a retryable roster error, not an empty academy, after a 500', async () => {
    server.use(tableError('squad_players', 500, { message: 'synthetic upstream unavailable' }))
    await loadRoute('/club/squads', 'squad_players')
    expect.soft(screen.queryByRole('alert'), observed()).toBeInTheDocument()
    expect.soft(screen.queryByRole('button', { name: /retry|try again/i }), observed()).toBeInTheDocument()
    expect(screen.queryByText('No players found.'), observed()).not.toBeInTheDocument()
  })

  it('control: a successful empty roster may honestly report no players', async () => {
    server.use(table('squad_players', []))
    await loadRoute('/club/squads', 'squad_players')
    expect(screen.getByText('No players found.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('labels a player with no assessment as unassessed rather than assigning Steady', async () => {
    await loadRoute('/club/squads', 'matches')
    expect(screen.getByText(PLAYER.player_name)).toBeInTheDocument()
    expect.soft(screen.queryByText(/not assessed|unassessed/i), observed()).toBeInTheDocument()
    expect(screen.queryByText('Steady'), observed()).not.toBeInTheDocument()
  })

  it('preserves six valid zero ratings as Difficult instead of inventing Steady', async () => {
    server.use(table('coach_assessments', [assessment('zero-rating', 0, '2026-09-20T10:00:00Z')]))
    await loadRoute('/club/squads', 'matches')
    expect(screen.getByText(PLAYER.player_name)).toBeInTheDocument()
    expect.soft(screen.queryByText('Difficult'), observed()).toBeInTheDocument()
    expect(screen.queryByText('Steady'), observed()).not.toBeInTheDocument()
  })

  it('includes a valid zero in an average of zero and ten instead of reporting Exceptional', async () => {
    const row = {
      ...assessment('mixed-zero-rating', 0, '2026-09-20T10:00:00Z'),
      tactical: 10, attitude: null, technical: null, physical: null, coachability: null,
    }
    server.use(table('coach_assessments', [row]))
    await loadRoute('/club/squads', 'matches')
    expect.soft(screen.queryByText('Mixed'), observed()).toBeInTheDocument()
    expect(screen.queryByText('Exceptional'), observed()).not.toBeInTheDocument()
  })

  it('uses the newest assessment for home bands even when natural database order is oldest-first', async () => {
    const older = assessment('older-exceptional', 9, '2026-09-01T10:00:00Z')
    const newer = assessment('newer-good', 7, '2026-09-20T10:00:00Z')
    let requestedOrder: string | null = null
    server.use(http.get(endpoint('coach_assessments'), ({ request }) => {
      requestedOrder = new URL(request.url).searchParams.get('order')
      // Respect explicit PostgREST ordering; otherwise return a valid natural
      // row order. A caller must request an order or select the newest itself.
      return HttpResponse.json(requestedOrder?.includes('created_at.desc') ? [newer, older] : [older, newer])
    }))
    await loadRoute('/club/home', 'coach_assessments')
    const card = screen.getByText('U15 test squad').closest('div.p-4') as HTMLElement
    const detail = `${observed()}; coach_assessments order=${requestedOrder ?? '<absent>'}`
    expect.soft(within(card).queryByText('G', { exact: true }), detail).toBeInTheDocument()
    expect(within(card).queryByText('E', { exact: true }), detail).not.toBeInTheDocument()
  })

  // ClubSquads selects no created_at and keeps the FIRST row per player as the
  // latest, so the requested order is the only thing making "newest wins" true
  // on that screen. The test above pins it for /club/home only; reversing the
  // Squads order passed all 23 tests and showed each player's oldest band.
  it('uses the newest assessment for the squads band even when natural database order is oldest-first', async () => {
    const older = assessment('older-exceptional', 9, '2026-09-01T10:00:00Z')
    const newer = assessment('newer-good', 7, '2026-09-20T10:00:00Z')
    let requestedOrder: string | null = null
    server.use(http.get(endpoint('coach_assessments'), ({ request }) => {
      requestedOrder = new URL(request.url).searchParams.get('order')
      return HttpResponse.json(requestedOrder?.includes('created_at.desc') ? [newer, older] : [older, newer])
    }))
    await loadRoute('/club/squads', 'matches')
    const detail = `${observed()}; coach_assessments order=${requestedOrder ?? '<absent>'}`
    expect.soft(screen.queryByText('Good'), detail).toBeInTheDocument()
    expect(screen.queryByText('Exceptional'), detail).not.toBeInTheDocument()
  })

  // Found on production (rehearsal director, 22 Sep): the same academy header
  // read "3 Coaches" on Home and "2 Coaches" on Squads, because Squads counted
  // coaches with roster rows while Home counted the academy's coaches. A coach
  // with no players yet (a goalkeeping coach, a new hire) is still a coach.
  it('reports the same coach count on Home and Squads when a coach has no players yet', async () => {
    const withRosterlessCoach = table('coach_details', [
      { user_id: COACH, current_club: 'Synthetic Academy', team: 'U15 test squad', coach_role: 'Head Coach' },
      { user_id: 'academy-gk-coach-test', current_club: 'Synthetic Academy', team: 'U15 test squad', coach_role: 'Goalkeeping Coach' },
    ])
    server.use(withRosterlessCoach)
    await loadRoute('/club/home', 'coach_assessments')
    expect(screen.getByText('2 Coaches'), observed()).toBeInTheDocument()
    cleanup()
    server.use(withRosterlessCoach)
    await loadRoute('/club/squads', 'matches')
    expect(screen.getByText('2 Coaches'), observed()).toBeInTheDocument()
  })

  it('includes zero in the home distribution when it moves Exceptional down to Standout', async () => {
    server.use(table('coach_assessments', [{ ...assessment('with-zero', 10, '2026-09-20T10:00:00Z'), work_rate: 0 }]))
    await loadRoute('/club/home', 'coach_assessments')
    const card = screen.getByText('U15 test squad').closest('div.p-4') as HTMLElement
    expect(within(card).getByText('S', { exact: true })).toBeInTheDocument()
    expect(within(card).queryByText('E', { exact: true })).not.toBeInTheDocument()
  })

  it.each([
    ['/club/home', 'organizations'], ['/club/home', 'coach_details'],
    ['/club/home', 'profiles'], ['/club/home', 'squad_players'], ['/club/home', 'coach_assessments'],
    ['/club/squads', 'organizations'], ['/club/squads', 'squad_players'],
    ['/club/squads', 'profiles'], ['/club/squads', 'coach_assessments'], ['/club/squads', 'matches'],
  ])('%s recovers after a failed required %s query', async (route, failedTable) => {
    let failedCalls = 0
    server.use(http.get(endpoint(failedTable), ({ request }) => {
      const url = new URL(request.url)
      // Keep AuthProvider's own profile hydration healthy; fail the dashboard read.
      if (failedTable === 'profiles' && url.searchParams.get('user_id') === `eq.${ADMIN}`) {
        return HttpResponse.json([{ id: 'admin-profile', user_id: ADMIN, role: 'club', full_name: 'Synthetic Director' }])
      }
      failedCalls++
      return HttpResponse.json({ message: 'Synthetic required read unavailable' }, { status: 500 })
    }))
    renderApp(route)
    await screen.findByRole('alert')
    expect(failedCalls).toBe(1)
    expect(screen.queryByText('0 Coaches')).not.toBeInTheDocument()
    expect(screen.queryByText(/No players found|No coaches connected yet/)).not.toBeInTheDocument()
    expect(screen.queryByText(PLAYER.player_name)).not.toBeInTheDocument()
    if (route === '/club/home') {
      expect(screen.getByText('Total Players').nextElementSibling).toHaveTextContent('—')
      expect(screen.getByText('Assessments this week').nextElementSibling).toHaveTextContent('—')
    }

    // Restore the successful HTTP contract, then exercise the actual Retry button.
    server.use(
      table('organizations', [{ id: 'academy-test', name: 'Synthetic Academy', admin_user_id: ADMIN }]),
      table('coach_details', [{ user_id: COACH, team: 'U15 test squad', coach_role: 'Head Coach' }]),
      table('profiles', [{ user_id: COACH, full_name: 'Synthetic Coach' }]),
      table('squad_players', [PLAYER]), table('coach_assessments', []), table('matches', []),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(route === '/club/home' ? '1 players' : PLAYER.player_name)
    expect(screen.getByText('1 Coaches')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it.each([
    ['/club/home', 200], ['/club/home', 500], ['/club/squads', 200], ['/club/squads', 500],
  ] as const)('%s ignores an old HTTP %s after an SDK account switch', async (route, oldStatus) => {
    const nextAdmin = 'academy-admin-next-test'
    const oldStorage = localStorage.getItem('sb-test-auth-token')!
    signInAs({ id: nextAdmin })
    const nextSession = JSON.parse(localStorage.getItem('sb-test-auth-token')!)
    localStorage.setItem('sb-test-auth-token', oldStorage)
    let release!: () => void
    const oldReply = new Promise<void>(resolve => { release = resolve })
    let oldRequested = false
    let oldReleased = false
    const downstreamAccounts: string[] = []
    const requestAccount = (request: Request) =>
      authUserForToken((request.headers.get('Authorization') ?? '').replace(/^Bearer /, ''))?.id
    server.use(
      http.post(`${SUPABASE_URL}/auth/v1/token`, () => HttpResponse.json(nextSession)),
      http.get(endpoint('profiles'), ({ request }) => {
        const filter = new URL(request.url).searchParams.get('user_id')
        const id = filter === `eq.${ADMIN}` ? ADMIN : nextAdmin
        return HttpResponse.json([{ id: `profile-${id}`, user_id: id, role: 'club', full_name: 'Synthetic Director' }])
      }),
      http.get(endpoint('organizations'), async ({ request }) => {
        const id = requestAccount(request)
        if (id === ADMIN) {
          oldRequested = true
          await oldReply
          oldReleased = true
          if (oldStatus !== 200) return HttpResponse.json({ message: 'Old academy read failed' }, { status: oldStatus })
        }
        return HttpResponse.json([{ id: `org-${id}`, name: id === ADMIN ? 'Old Academy' : 'Next Academy', admin_user_id: id }])
      }),
      ...['coach_details', 'squad_players'].map(name => http.get(endpoint(name), ({ request }) => {
        downstreamAccounts.push(requestAccount(request) ?? 'unauthenticated')
        return HttpResponse.json([])
      })),
    )

    renderApp(route)
    try {
      await waitFor(() => expect(oldRequested).toBe(true))
      await act(async () => {
        const result = await supabase.auth.signInWithPassword({ email: `${nextAdmin}@example.test`, password: 'synthetic-only' })
        expect(result.error).toBeNull()
      })
      await screen.findByRole('heading', { name: 'Next Academy' })
      await screen.findByText(route === '/club/home'
        ? 'No coaches connected yet. Share your academy code with coaches to get started.' : 'No players found.')
      const callsAfterNextLoad = [...downstreamAccounts]
      // Every downstream read belongs to the new account (Squads makes two:
      // its roster and the academy's coach count). None from the old one.
      expect(callsAfterNextLoad.length).toBeGreaterThan(0)
      expect(callsAfterNextLoad.filter(account => account !== nextAdmin)).toEqual([])

      await act(async () => { release(); await oldReply })
      await waitFor(() => expect(oldReleased).toBe(true))
      expect(screen.getByRole('heading', { name: 'Next Academy' })).toBeInTheDocument()
      expect(screen.queryByText('Old Academy')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(downstreamAccounts).toEqual(callsAfterNextLoad)
    } finally {
      release()
    }
  })
})
