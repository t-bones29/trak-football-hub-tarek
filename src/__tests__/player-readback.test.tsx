import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../tests/support/render-app'
import { signInAs } from '../../tests/support/session'
import { registerAuthUser } from '../../tests/msw/auth-sessions'
import { server } from '../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../tests/msw/supabase'
import { supabase } from '@/integrations/supabase/client'

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const failure = () => HttpResponse.json({ code: '42501', message: 'Synthetic denied read' }, { status: 403 })
const WORDS = 'Keep your head up before receiving the ball.'
// Matched as a substring: main quotes the message in a tap-through card, and
// #141 (TRAK-71) shows it unquoted inside the assessment. These tests are about
// whether the words are shown or cleared, not how they are framed.
let sequence = 0
let account: string
let role: 'player' | 'parent'
const CHILD_A = 'child-alex', CHILD_B = 'child-zara'
const match = (id: string, owner = account) => ({
  id, user_id: owner, opponent: `${id} opposition`, competition: 'League', venue: 'Home',
  created_at: '2026-09-20T10:00:00Z', match_date: '2026-09-18', computed_rating: 7,
  team_score: 2, opponent_score: 1, minutes_played: 60, goals: 1, assists: 0,
  position: 'Defender', age_group: 'U15',
})
const event = { id: 'event-a', coach_user_id: 'coach-a', title: 'Team training', event_type: 'training', published: true, event_date: '2026-09-28', starts_at: '2026-09-28T17:00:00Z', time_known: true }
const assessment = {
  id: 'assessment-a', squad_player_id: 'squad-a', coach_user_id: 'coach-a',
  created_at: '2026-09-20T10:00:00Z', coach_rating: 7,
  work_rate: 7, tactical: 7, attitude: 7, technical: 7, physical: 7, coachability: 7,
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
async function refresh() {
  await act(async () => {
    const { error } = await supabase.auth.refreshSession()
    expect(error).toBeNull()
  })
}
// Wait for MSW to finish the released HTTP response inside React's async act,
// so negative assertions inspect state after the SDK's real response handling.
function nextResponse(name: string) {
  return new Promise<void>(resolve => {
    const listener = ({ request }: { request: Request }) => {
      if (!request.url.startsWith(endpoint(name))) return
      server.events.removeListener('response:mocked', listener)
      resolve()
    }
    server.events.on('response:mocked', listener)
  })
}
async function releaseResponse(pending: ReturnType<typeof deferred>, name: string) {
  const responded = nextResponse(name)
  await act(async () => { pending.resolve(); await responded })
}
function matchResponse(request: Request, row: ReturnType<typeof match>) {
  return HttpResponse.json(request.headers.get('Accept')?.includes('application/vnd.pgrst.object+json') ? row : [row])
}
function navigate(path: string) {
  act(() => {
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
}

beforeEach(() => {
  vi.stubEnv('DEV', false)
  role = 'player'
  account = `readback-account-${++sequence}`
  signInAs({ id: account })
  server.use(
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      if (filter.startsWith('in.')) return HttpResponse.json([
        { user_id: CHILD_A, full_name: 'Alex' }, { user_id: CHILD_B, full_name: 'Zara' },
        { user_id: 'coach-a', full_name: 'Coach Audit' },
      ].filter(p => filter.includes(p.user_id)))
      if (filter === 'eq.coach-a') return HttpResponse.json([{ user_id: 'coach-a', full_name: 'Coach Audit' }])
      return HttpResponse.json([{ id: `profile-${account}`, user_id: account, role, full_name: 'Audit Player' }])
    }),
    table('matches', [match('recent')]),
    table('player_details', [{ position: 'Defender', current_club: 'Audit Academy', age_group: 'U15' }]),
    table('squad_players', [{ id: 'squad-a', coach_user_id: 'coach-a', linked_player_id: account }]),
    table('coach_assessments', [assessment]),
    table('coach_shared_feedback', [{ assessment_id: assessment.id, body: WORDS, published_at: '2026-09-20T10:00:00Z' }]),
    table('coach_calendar_events', []), table('recognition_awards', []),
    table('player_parent_links', [{ player_user_id: CHILD_A }, { player_user_id: CHILD_B }]),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('get_children_awaiting_consent', () => []),
    // Player and parent Matches also list training (TRAK-76/77); none here.
    rpc('family_training_history', () => []),
    http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
      const previous = JSON.parse(localStorage.getItem('sb-test-auth-token')!)
      const user = structuredClone(previous.user)
      return HttpResponse.json({ ...previous, user, access_token: registerAuthUser(user),
        expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600 })
    }),
  )
})
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('player readback through authenticated routes', () => {
  it('CONTROL renders a permitted match detail through the real authenticated route', async () => {
    renderApp('/player/match/recent')
    expect(await screen.findByText('vs recent opposition')).toBeInTheDocument()
  })

  it('shows an actionable error when a match-detail read is denied', async () => {
    server.use(http.get(endpoint('matches'), failure))
    renderApp('/player/match/recent')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull())
    expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled()
  })

  it('finishes loading with a safe unavailable state when RLS returns no match', async () => {
    server.use(table('matches', []))
    renderApp('/player/match/not-owned')
    await waitFor(() => expect(screen.queryByText(/match.*(not found|unavailable)|couldn.t find.*match/i)).not.toBeNull())
    expect(screen.queryByText('vs recent opposition')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /back to matches/i }))
    await screen.findByText('No matches found.')
  })

  it('does not show a previous match while a different match route is still loading', async () => {
    const pending = deferred()
    let requested = false
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')?.slice(3) ?? 'recent'
      if (id === 'second') { requested = true; await pending.promise }
      return matchResponse(request, match(id))
    }))
    renderApp('/player/match/recent')
    await screen.findByText('vs recent opposition')
    try {
      navigate('/player/match/second')
      await waitFor(() => expect(requested).toBe(true))
      expect(screen.queryByText('vs recent opposition')).toBeNull()
    } finally { await releaseResponse(pending, 'matches') }
  })

  it('CONTROL renders player home with the current coach message', async () => {
    renderApp('/player/home')
    expect(await screen.findByText(WORDS, { exact: false })).toBeInTheDocument()
  })

  it('preserves a failed details read when the independent matches read finishes later', async () => {
    const pending = deferred()
    let denied = false
    server.use(
      http.get(endpoint('matches'), async () => { await pending.promise; return HttpResponse.json([match('recent')]) }),
      http.get(endpoint('player_details'), () => { denied = true; return failure() }),
    )
    renderApp('/player/home')
    try {
      await waitFor(() => expect(denied).toBe(true))
      await releaseResponse(pending, 'matches')
      await waitFor(() => expect(Boolean(screen.queryByRole('alert')) || screen.queryAllByText('Audit Player').length > 0).toBe(true))
      expect(screen.queryByRole('alert')).not.toBeNull()
      expect(screen.getByRole('button', { name: /retry/i })).toBeEnabled()
    } finally { pending.resolve() }
  })

  it.each(['squad_players', 'coach_assessments'])(
    'clears the old coach message after refreshed %s returns no accessible rows', async name => {
      server.use(table('coach_calendar_events', [event]))
      renderApp('/player/home')
      await screen.findByText(WORDS, { exact: false })
      await screen.findByText('Team training')
      expect(screen.getByText('Coach Audit')).toBeInTheDocument()
      let checked = false
      server.use(http.get(endpoint(name), () => { checked = true; return HttpResponse.json([]) }))
      await refresh()
      await waitFor(() => expect(checked).toBe(true))
      await screen.findByText('vs recent opposition')
      await waitFor(() => expect(screen.queryByText(WORDS, { exact: false })).toBeNull())
      expect(screen.queryByText('LATEST COACH ASSESSMENT')).toBeNull()
      expect(screen.queryByText('Coach Audit')).toBeNull()
      if (name === 'squad_players') expect(screen.queryByText('Team training')).toBeNull()
      else expect(await screen.findByText('Team training')).toBeInTheDocument()
    },
  )

  it('CONTROL clears the old coach message after a refreshed published-feedback query returns no rows', async () => {
    renderApp('/player/home')
    await screen.findByText(WORDS, { exact: false })
    server.use(table('coach_shared_feedback', []))
    await refresh()
    await screen.findByText('vs recent opposition')
    await waitFor(() => expect(screen.queryByText(WORDS, { exact: false })).toBeNull())
  })

  it('CONTROL a delayed sibling response does not replace the currently selected child', async () => {
    role = 'parent'
    const pending = deferred()
    let requested = false
    let oldRequest: Request | undefined
    const handlerFinished = deferred()
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      if (child === CHILD_A) {
        requested = true
        oldRequest = request
        await pending.promise
        handlerFinished.resolve()
      }
      return HttpResponse.json([match(child, child)])
    }))
    renderApp('/parent/matches')
    try {
      const selector = await screen.findByRole('combobox', { name: 'Following' })
      await waitFor(() => expect(requested).toBe(true))
      await userEvent.selectOptions(selector, CHILD_B)
      await screen.findByText(`${CHILD_B} opposition`)
      expect(oldRequest?.signal.aborted).toBe(true)
      await act(async () => { pending.resolve(); await handlerFinished.promise })
      expect(screen.queryByText(`${CHILD_A} opposition`)).toBeNull()
      expect(screen.getByText(`${CHILD_B} opposition`)).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('CONTROL the parent can retry a failed match read without losing the selected child', async () => {
    role = 'parent'
    let fail = true
    server.use(http.get(endpoint('matches'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      return fail ? failure() : HttpResponse.json([match(child, child)])
    }))
    renderApp('/parent/matches')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull(), { timeout: 3000 })
    expect(screen.queryByText('No matches yet.')).toBeNull()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(`${CHILD_A} opposition`)
    expect(screen.getByRole('combobox')).toHaveValue(CHILD_A)
  })

  it('recovers a denied match detail with Retry', async () => {
    let fail = true
    server.use(http.get(endpoint('matches'), ({ request }) => fail ? failure() : matchResponse(request, match('recent'))))
    renderApp('/player/match/recent')
    await screen.findByRole('alert')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('vs recent opposition')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers safe Matches navigation after a denied match detail', async () => {
    server.use(http.get(endpoint('matches'), ({ request }) => {
      if (new URL(request.url).searchParams.has('id')) return failure()
      return HttpResponse.json([match('recent')])
    }))
    renderApp('/player/match/not-owned')
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: /back to matches/i }))
    expect(await screen.findByText('vs recent opposition')).toBeInTheDocument()
  })

  it('ignores a match detail response arriving after a newer route finished', async () => {
    const pending = deferred()
    let requested = false
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      const id = new URL(request.url).searchParams.get('id')?.slice(3) ?? 'recent'
      if (id === 'older') { requested = true; await pending.promise }
      return matchResponse(request, match(id))
    }))
    renderApp('/player/match/older')
    try {
      await waitFor(() => expect(requested).toBe(true))
      navigate('/player/match/newer')
      await screen.findByText('vs newer opposition')
      await releaseResponse(pending, 'matches')
      expect(screen.queryByText('vs older opposition')).toBeNull()
      expect(screen.getByText('vs newer opposition')).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('refreshes match detail ownership and ignores the superseded read', async () => {
    const pending = deferred()
    let requests = 0
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      if (++requests === 1) {
        await pending.promise
        return matchResponse(request, match('withdrawn'))
      }
      return HttpResponse.json([])
    }))
    renderApp('/player/match/withdrawn')
    try {
      await waitFor(() => expect(requests).toBe(1))
      await refresh()
      await screen.findByText(/match.*(not found|unavailable)|couldn.t find.*match/i)
      await releaseResponse(pending, 'matches')
      expect(screen.queryByText('vs withdrawn opposition')).toBeNull()
      expect(screen.getByText(/match.*(not found|unavailable)|couldn.t find.*match/i)).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('preserves a details failure when matches finishes first', async () => {
    const pending = deferred()
    let requested = false
    server.use(http.get(endpoint('player_details'), async () => {
      requested = true
      await pending.promise
      return failure()
    }))
    const matchesResponded = nextResponse('matches')
    renderApp('/player/home')
    try {
      await waitFor(() => expect(requested).toBe(true))
      await act(async () => { await matchesResponded })
      await releaseResponse(pending, 'player_details')
      expect(await screen.findByRole('alert')).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('retries all Home reads and clears the failure after the fresh load succeeds', async () => {
    server.use(http.get(endpoint('player_details'), failure))
    renderApp('/player/home')
    await screen.findByRole('alert')
    server.use(table('player_details', [{ position: 'Defender', current_club: 'Recovered Academy', age_group: 'U15' }]))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Recovered Academy U15')).toBeInTheDocument()
    expect(await screen.findByText(WORDS, { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['matches', 'player_details', 'squad_players', 'coach_assessments', 'profiles', 'coach_shared_feedback', 'coach_calendar_events'])(
    'ignores a late superseded Home %s response', async name => {
      const pending = deferred()
      let requested = false
      let fresh = false
      const staleRows: Record<string, Record<string, unknown>[]> = {
        matches: [match('stale'), match('stale-second')],
        player_details: [{ position: 'Defender', current_club: 'Stale Academy', age_group: 'U15' }],
        squad_players: [{ id: 'squad-a', coach_user_id: 'coach-a', linked_player_id: account }],
        coach_assessments: [assessment],
        profiles: [{ user_id: 'coach-a', full_name: 'Stale Coach' }],
        coach_shared_feedback: [{ assessment_id: assessment.id, body: WORDS, published_at: '2026-09-20T10:00:00Z' }],
        coach_calendar_events: [event],
      }
      server.use(
        http.get(endpoint('matches'), () => HttpResponse.json([match(fresh ? 'current' : 'recent')])),
        http.get(endpoint('player_details'), () => HttpResponse.json([{ position: 'Defender', current_club: fresh ? 'Current Academy' : 'Audit Academy', age_group: 'U15' }])),
        http.get(endpoint('squad_players'), () => HttpResponse.json(fresh ? [] : staleRows.squad_players)),
      )
      server.use(http.get(endpoint(name), async ({ request }) => {
        if (name === 'profiles' && new URL(request.url).searchParams.get('user_id') !== 'eq.coach-a') return
        if (fresh) return // Let the current-load handlers above answer.
        requested = true
        await pending.promise
        return HttpResponse.json(staleRows[name])
      }))
      renderApp('/player/home')
      try {
        await waitFor(() => expect(requested).toBe(true))
        fresh = true
        await refresh()
        await screen.findByText('vs current opposition')
        await screen.findByText('Current Academy U15')
        await releaseResponse(pending, name)
        expect(screen.queryByRole('alert')).toBeNull()
        expect(screen.getByText('vs current opposition')).toBeInTheDocument()
        expect(screen.getByText('Current Academy U15')).toBeInTheDocument()
        expect(screen.queryByText('vs stale opposition')).toBeNull()
        expect(screen.queryByText('Stale Academy U15')).toBeNull()
        expect(screen.queryByText('Stale Coach')).toBeNull()
        expect(screen.queryByText('LATEST COACH ASSESSMENT')).toBeNull()
        expect(screen.queryByText(WORDS, { exact: false })).toBeNull()
        expect(screen.queryByText('Team training')).toBeNull()
        expect(screen.queryByText('YOUR CARD HAS BEEN UPDATED')).toBeNull()
        expect(localStorage.getItem(`trak_last_match_count_${account}`)).toBe('1')
      } finally { pending.resolve() }
    },
  )

  it('ignores a failed Home read from before a successful refresh', async () => {
    const pending = deferred()
    let requests = 0
    server.use(http.get(endpoint('player_details'), async () => {
      if (++requests === 1) { await pending.promise; return failure() }
      return HttpResponse.json([{ position: 'Defender', current_club: 'Current Academy', age_group: 'U15' }])
    }))
    renderApp('/player/home')
    try {
      await waitFor(() => expect(requests).toBe(1))
      await refresh()
      await screen.findByText('Current Academy U15')
      await releaseResponse(pending, 'player_details')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByText('Current Academy U15')).toBeInTheDocument()
    } finally { pending.resolve() }
  })

  it('keeps feedback failures visible while still loading the calendar', async () => {
    server.use(http.get(endpoint('coach_shared_feedback'), failure), table('coach_calendar_events', [event]))
    renderApp('/player/home')
    expect(await screen.findByText(/Couldn't load your (feedback|coach's message)/)).toBeInTheDocument()
    expect(await screen.findByText('Team training')).toBeInTheDocument()
    expect(screen.queryByText(WORDS, { exact: false })).toBeNull()
  })


  it('records the first match count silently and reveals newly logged matches after refresh', async () => {
    renderApp('/player/home')
    await screen.findByText(WORDS, { exact: false })
    expect(localStorage.getItem(`trak_last_match_count_${account}`)).toBe('1')
    expect(screen.queryByText('YOUR CARD HAS BEEN UPDATED')).toBeNull()
    server.use(table('matches', [match('recent'), match('second')]))
    await refresh()
    expect(await screen.findByText('YOUR CARD HAS BEEN UPDATED')).toBeInTheDocument()
    expect(localStorage.getItem(`trak_last_match_count_${account}`)).toBe('1')
  })

  it('ignores an older consent response after a refreshed Home load', async () => {
    const pending = deferred()
    let requests = 0
    server.use(http.post(endpoint('rpc/my_consent_status'), async () => {
      if (++requests === 1) {
        await pending.promise
        return HttpResponse.json({ required: true, invited_parent: null })
      }
      return HttpResponse.json({ required: false, invited_parent: null })
    }))
    renderApp('/player/home')
    try {
      await waitFor(() => expect(requests).toBe(1))
      await refresh()
      await waitFor(() => expect(requests).toBe(2))
      await screen.findByText(WORDS, { exact: false })
      await releaseResponse(pending, 'rpc/my_consent_status')
      expect(screen.queryByText('Waiting for your parent')).toBeNull()
    } finally { pending.resolve() }
  })


  it.each(['getItem', 'setItem'] as const)(
    'renders a successful Home load when optional card-reveal storage %s throws', async method => {
      const read = Storage.prototype.getItem
      const write = Storage.prototype.setItem
      const storage = method === 'getItem'
        ? vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
          if (key.startsWith('trak_last_match_count_')) throw new DOMException('Storage unavailable', 'SecurityError')
          return read.call(this, key)
        })
        : vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
          if (key.startsWith('trak_last_match_count_')) throw new DOMException('Storage unavailable', 'SecurityError')
          write.call(this, key, value)
        })
      try {
        renderApp('/player/home')
        expect(await screen.findByText('vs recent opposition')).toBeInTheDocument()
        expect(await screen.findByText(WORDS, { exact: false })).toBeInTheDocument()
        expect(screen.queryByRole('alert')).toBeNull()
        expect(screen.queryByText('YOUR CARD HAS BEEN UPDATED')).toBeNull()
      } finally { storage.mockRestore() }
    },
  )

  // Kostas's #133 review (P2): AuthContext hands out a new user object on every
  // same-account token refresh (hourly, and on returning to the tab), so this
  // load re-runs. A re-run must refresh what is on screen, not blank it.
  it('keeps the home card and the coach message on screen while a same-account refresh reloads', async () => {
    renderApp('/player/home')
    await screen.findByText(WORDS, { exact: false })
    const pending = deferred()
    server.use(http.get(endpoint('matches'), async () => { await pending.promise; return HttpResponse.json([match('recent')]) }))
    try {
      await refresh()
      const cardShown = screen.queryAllByText(/recent opposition/).length > 0
      const messageShown = screen.queryByText(WORDS, { exact: false }) !== null
      await releaseResponse(pending, 'matches')
      expect(cardShown, 'match list stays visible during a same-account refresh').toBe(true)
      expect(messageShown, "the coach's message stays visible during a same-account refresh").toBe(true)
    } finally { pending.resolve() }
  })

  // Kostas and Imad (P3): if a callback throws instead of resolving with
  // { error }, Promise.all rejected and loading never ended.
  it('ends in a retryable error, not an endless skeleton, when a Home callback throws', async () => {
    server.use(http.get(endpoint('matches'), () => HttpResponse.json({ unexpected: 'shape' })))
    renderApp('/player/home')
    expect(await screen.findByRole('button', { name: /retry/i })).toBeEnabled()
  })

  // Imad's #133 review: the squad callback's cancelled guard was unpinned.
  it('ignores a squad failure from before a successful refresh', async () => {
    const pending = deferred()
    let requests = 0
    server.use(http.get(endpoint('squad_players'), async () => {
      if (++requests === 1) { await pending.promise; return failure() }
      return HttpResponse.json([{ id: 'squad-a', coach_user_id: 'coach-a', linked_player_id: account }])
    }))
    renderApp('/player/home')
    try {
      await waitFor(() => expect(requests).toBe(1))
      await refresh()
      await screen.findByText(WORDS, { exact: false })
      await releaseResponse(pending, 'squad_players')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByText(WORDS, { exact: false })).toBeInTheDocument()
    } finally { pending.resolve() }
  })

})
