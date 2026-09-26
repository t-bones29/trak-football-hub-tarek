import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import ParentHome from '../ParentHome'
import ParentMatches from '../ParentMatches'
import ParentAlerts from '../ParentAlerts'
import ParentProfilePage from '../ParentProfilePage'
import Settings from '@/pages/Settings'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const auth = vi.hoisted(() => ({ parentId: 'parent-a' }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: auth.parentId, email: `${auth.parentId}@test.invalid` },
    profile: { full_name: 'Test Parent', role: 'parent' },
    signOut: vi.fn(), refreshProfile: vi.fn(),
  }),
}))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const fail = () => HttpResponse.json({ code: '42501', message: 'permission denied' }, { status: 403 })
const match = (child: string, rating: number | null = 0) => ({
  id: `match-${child}`, user_id: child, opponent: `${child} opposition`, competition: 'League',
  venue: null, created_at: '2026-09-18T10:00:00Z', match_date: '2026-09-01',
  team_score: 0, opponent_score: 0, computed_rating: rating,
})
const assessment = (child: string) => ({
  id: `assessment-${child}`, squad_player_id: `squad-${child}`, coach_user_id: `coach-${child}`,
  created_at: '2026-09-17T10:00:00Z', coach_rating: 0,
  work_rate: 0, tactical: 0, attitude: 0, technical: 0, physical: 0, coachability: 0,
})

function installFamily() {
  server.use(
    http.get(endpoint('player_parent_links'), ({ request }) => {
      const parent = new URL(request.url).searchParams.get('parent_user_id')
      return HttpResponse.json((parent === 'eq.parent-a' ? ['Alex', 'Zara'] : ['Sam'])
        .map(player_user_id => ({ player_user_id })))
    }),
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara', 'Sam', 'coach-Alex', 'coach-Zara', 'coach-Sam']
        .filter(id => filter.includes(id)).map(user_id => ({ user_id, full_name: user_id })))
    }),
    http.get(endpoint('matches'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      return HttpResponse.json([match(child)])
    }),
    http.get(endpoint('player_details'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3)
      return HttpResponse.json([{ position: 'mid', current_club: `${child} academy`, age_group: 'U15' }])
    }),
    http.get(endpoint('squad_players'), ({ request }) => {
      const child = new URL(request.url).searchParams.get('linked_player_id')?.slice(3)
      return HttpResponse.json([{ id: `squad-${child}` }])
    }),
    http.get(endpoint('coach_assessments'), ({ request }) => {
      const ids = new URL(request.url).searchParams.get('squad_player_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara', 'Sam'].filter(id => ids.includes(id)).map(assessment))
    }),
    http.get(endpoint('recognition_awards'), ({ request }) => {
      const ids = new URL(request.url).searchParams.get('squad_player_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara', 'Sam'].filter(id => ids.includes(id)).map(child => ({
        id: `award-${child}`, coach_user_id: `coach-${child}`, created_at: '2026-09-16T10:00:00Z',
        award_type: 'player_of_week', awarded_for: `${child} teamwork`, note: null,
      })))
    }),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
    // TRAK-77: Matches also lists the selected child's training; none here.
    http.post(endpoint('rpc/family_training_history'), () => HttpResponse.json([])),
  )
}

const clients: QueryClient[] = []
function renderFamily(route = '/parent/home') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  const tree = () => <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[route]}>
      <ParentChildrenProvider>
        <Routes>
          <Route path="/parent/home" element={<ParentHome />} />
          <Route path="/parent/matches" element={<ParentMatches />} />
          <Route path="/parent/alerts" element={<ParentAlerts />} />
          <Route path="/parent/profile" element={<ParentProfilePage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </ParentChildrenProvider>
    </MemoryRouter>
  </QueryClientProvider>
  return { ...render(tree()), tree, client }
}

beforeEach(() => { auth.parentId = 'parent-a'; installFamily() })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true) })

describe('parent family navigation', () => {
  it('keeps the selected child across all parent views and lists both children in Settings', async () => {
    const user = userEvent.setup()
    renderFamily()
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Following' }), 'Zara')
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    expect(screen.getByText('mid · Zara academy · U15')).toBeInTheDocument()
    expect(screen.getByText('Zara teamwork')).toBeInTheDocument()
    expect(screen.queryByText('Alex teamwork')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Matches' }))
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('Zara')
    await user.click(screen.getByRole('button', { name: 'Alerts' }))
    expect(await screen.findByText('vs Zara opposition · 0–0')).toBeInTheDocument()
    expect(screen.queryByText(/vs Alex opposition/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByText('Following Zara · 2 children linked')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('Zara')
    await user.click(screen.getByRole('button', { name: /settings account settings/i }))
    const connections = await screen.findByRole('list', { name: 'Linked children' })
    expect(within(connections).getByText('Alex')).toBeInTheDocument()
    expect(within(connections).getByText('Zara')).toBeInTheDocument()
  })

  it('does not carry child names or match data into another parent account', async () => {
    const view = renderFamily('/parent/matches')
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    auth.parentId = 'parent-b'
    view.rerender(view.tree())
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(await screen.findByText('Sam opposition')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('Sam')
    expect(screen.queryByRole('option', { name: 'Alex' })).not.toBeInTheDocument()
  })

  it('rejects an old child response after switching to a faster child', async () => {
    let release!: () => void
    let requested = false
    const pending = new Promise<void>(resolve => { release = resolve })
    server.use(http.get(endpoint('matches'), async ({ request }) => {
      const child = new URL(request.url).searchParams.get('user_id')?.slice(3) ?? ''
      if (child === 'Alex') { requested = true; await pending }
      return HttpResponse.json([match(child)])
    }))
    renderFamily('/parent/matches')
    const selector = await screen.findByRole('combobox')
    await waitFor(() => expect(requested).toBe(true))
    await userEvent.selectOptions(selector, 'Zara')
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    await act(async () => { release(); await pending })
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(screen.getByText('Zara opposition')).toBeInTheDocument()
  })

  it('reconciles the selection when a link is removed and never shows that child again', async () => {
    const view = renderFamily('/parent/matches')
    await userEvent.selectOptions(await screen.findByRole('combobox'), 'Zara')
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }])))
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['parent', 'parent-a', 'children'] }) })
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    expect(screen.queryByText('Zara opposition')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Zara' })).not.toBeInTheDocument()
  })

  it('picks up a newly linked second child on navigation without signing in again', async () => {
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }])))
    renderFamily('/parent/matches')
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    installFamily()
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByRole('option', { name: 'Zara' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Zara')
    expect(screen.getByText('Following Zara · 2 children linked')).toBeInTheDocument()
  })
})

// J7 (TRAK-10): a parent open is the child's latest assessment on screen.
describe('J7 parent open', () => {
  const views = async () => {
    const { trackEvent } = await import('@/lib/telemetry')
    return vi.mocked(trackEvent).mock.calls.filter(([type]) => type === 'assessment_viewed').map(([, meta]) => meta)
  }
  beforeEach(async () => { const { trackEvent } = await import('@/lib/telemetry'); vi.mocked(trackEvent).mockClear() })

  it('records the shown assessment once, and the sibling\'s when the parent switches child', async () => {
    renderFamily()
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    await waitFor(async () => expect(await views()).toEqual([{ assessment_id: 'assessment-Alex' }]))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Following' }), 'Zara')
    expect(await screen.findByText('Zara opposition')).toBeInTheDocument()
    await waitFor(async () => expect(await views()).toEqual([{ assessment_id: 'assessment-Alex' }, { assessment_id: 'assessment-Zara' }]))
  })

  it('records nothing when the assessment failed to load or there is none', async () => {
    server.use(http.get(endpoint('coach_assessments'), fail))
    const failed = renderFamily()
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeInTheDocument()
    expect(await views()).toEqual([])
    failed.unmount()

    server.use(http.get(endpoint('coach_assessments'), () => HttpResponse.json([])))
    renderFamily()
    expect(await screen.findByText('No coach assessments yet.')).toBeInTheDocument()
    expect(await views()).toEqual([])
  })
})

describe('parent loading, empty and error states', () => {
  it('shows loading until links resolve, then a genuine empty family', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    server.use(http.get(endpoint('player_parent_links'), async () => { await pending; return HttpResponse.json([]) }))
    renderFamily('/parent/matches')
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(screen.queryByText('No child linked yet')).not.toBeInTheDocument()
    await act(async () => { release(); await pending })
    expect(await screen.findByText('No child linked yet')).toBeInTheDocument()
    expect(screen.queryByText('No matches yet.')).not.toBeInTheDocument()
  })

  it('shows a links failure rather than claiming there is no child, then retries', async () => {
    server.use(http.get(endpoint('player_parent_links'), fail))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your linked children")
    expect(screen.queryByText('No child linked yet')).not.toBeInTheDocument()
    installFamily()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
  })

  it.each(['player_details', 'squad_players', 'coach_assessments', 'recognition_awards'])(
    'does not turn a %s subquery failure into empty development data', async table => {
      server.use(http.get(endpoint(table), fail))
      renderFamily()
      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this child's information")
      expect(screen.queryByText('No coach assessments yet.')).not.toBeInTheDocument()
      expect(screen.queryByText(/No matches yet/)).not.toBeInTheDocument()
    },
  )

  it('clears the previous child when the selected child has no records', async () => {
    server.use(http.get(endpoint('matches'), ({ request }) => HttpResponse.json(
      new URL(request.url).searchParams.get('user_id') === 'eq.Alex' ? [match('Alex')] : [],
    )))
    renderFamily('/parent/matches')
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Zara')
    expect(screen.queryByText('Alex opposition')).not.toBeInTheDocument()
    expect(await screen.findByText('No matches yet.')).toBeInTheDocument()
  })

  it('shows a matches failure and can recover without changing child', async () => {
    server.use(http.get(endpoint('matches'), fail))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load matches")
    expect(screen.queryByText('No matches yet.')).not.toBeInTheDocument()
    installFamily()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Alex opposition')).toBeInTheDocument()
  })

  it('reports an offline failure instead of leaving a paused loading screen forever', async () => {
    onlineManager.setOnline(false)
    server.use(http.get(endpoint('player_parent_links'), () => HttpResponse.error()))
    renderFamily('/parent/matches')
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your linked children")
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('truthful parent ratings', () => {
  it('includes a newly logged backfilled match among the latest 20 match alerts', async () => {
    const historicalMatches = Array.from({ length: 20 }, (_, index) => ({
      ...match(`Fixture ${index + 1}`),
      match_date: `2026-09-${String(20 - index).padStart(2, '0')}`,
      created_at: `2026-09-${String(20 - index).padStart(2, '0')}T10:00:00Z`,
    }))
    server.use(http.get(endpoint('matches'), () => HttpResponse.json([
      ...historicalMatches,
      { ...match('Backfilled'), match_date: '2026-08-01', created_at: '2026-09-21T10:00:00Z' },
    ])))
    const { client } = renderFamily('/parent/alerts')
    expect(await screen.findByText('vs Backfilled opposition · 0–0')).toBeInTheDocument()
    const alerts = screen.getAllByText('Match logged')
    expect(alerts).toHaveLength(20)
    expect(alerts[0].parentElement).toHaveTextContent('vs Backfilled opposition')
    expect(screen.queryByText('vs Fixture 20 opposition · 0–0')).not.toBeInTheDocument()
    // Alerts must not reorder the shared match cache used by the Matches view.
    // Assert before navigation: a mount refetch could hide an in-place mutation.
    const cachedMatches = client.getQueryData<{ id: string }[]>(['parent', 'parent-a', 'Alex', 'matches'])
    expect(cachedMatches?.map(row => row.id)).toEqual([
      ...historicalMatches.map(row => row.id), 'match-Backfilled',
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Matches' }))
    expect((await screen.findAllByText(/opposition/))[0]).toHaveTextContent('Fixture 1 opposition')
  })

  it('shows zero as Difficult, null as Not rated, and uses the match date', async () => {
    server.use(http.get(endpoint('matches'), () => HttpResponse.json([
      match('Zero', 0), { ...match('Unknown', null), team_score: null, opponent_score: null },
    ])))
    renderFamily('/parent/matches')
    expect(await screen.findByText('Difficult')).toBeInTheDocument()
    expect(screen.getByText('Not rated')).toBeInTheDocument()
    expect(screen.getByText('Score not recorded')).toBeInTheDocument()
    expect(screen.getByText('D 0–0')).toBeInTheDocument()
    expect(screen.getAllByText('1 Sept · League')).toHaveLength(2)
  })

  it('does not replace a missing rating in the average and preserves zero assessment categories', async () => {
    server.use(http.get(endpoint('matches'), () => HttpResponse.json([match('Zero', 0), match('Unknown', null)])))
    renderFamily()
    const summary = await screen.findByRole('region', { name: 'Recorded matches summary' })
    expect(within(summary).getByText('Difficult')).toBeInTheDocument()
    const development = screen.getByRole('region', { name: 'Latest coach assessment' })
    expect(within(development).getAllByText('Difficult')).toHaveLength(7)
    expect(screen.queryByText('Steady')).not.toBeInTheDocument()
  })
})
