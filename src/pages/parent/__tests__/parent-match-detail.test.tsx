/**
 * TRAK-73 item 1 (J6): a parent who missed the game opens the same match
 * detail the player sees, from parent home and the Matches tab. A child still
 * awaiting this parent's approval shows only what the parent already saw
 * before (score, opponent, competition, venue, band), and so does a failed
 * approval read: it fails closed.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import ParentHome from '../ParentHome'
import ParentMatches from '../ParentMatches'
import ParentMatchDetail from '../ParentMatchDetail'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

// One stable object, as AuthContext gives: match detail keys its load on `user`.
const auth = vi.hoisted(() => ({
  user: { id: 'parent-a', email: 'parent-a@test.invalid' },
  profile: { full_name: 'Test Parent', role: 'parent' },
  signOut: () => {}, refreshProfile: () => {},
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const ALEX = '11111111-1111-4111-8111-111111111111'
const ZARA = '22222222-2222-4222-8222-222222222222'
const NAMES: Record<string, string> = { [ALEX]: 'Alex', [ZARA]: 'Zara' }
const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const fullMatch = (child: string) => ({
  id: `match-${NAMES[child]}`, user_id: child, opponent: `${NAMES[child]} opposition`, competition: 'League',
  venue: 'Home', created_at: '2026-09-18T10:00:00Z', match_date: '2026-09-18',
  team_score: 3, opponent_score: 1, computed_rating: 7.2,
  position: 'Midfielder', age_group: 'U15', minutes_played: 64, goals: 2, assists: 1,
})
let awaiting: 'fail' | Array<Record<string, unknown>> = []
let approvalReads = 0

beforeEach(() => {
  awaiting = []
  approvalReads = 0
  server.use(
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([ALEX, ZARA].map(player_user_id => ({ player_user_id })))),
    http.get(endpoint('profiles'), () => HttpResponse.json([ALEX, ZARA].map(user_id => ({ user_id, full_name: NAMES[user_id] })))),
    http.get(endpoint('matches'), ({ request }) => {
      const params = new URL(request.url).searchParams
      const id = params.get('id')?.slice(3)
      if (id) {
        const row = [ALEX, ZARA].map(fullMatch).find(m => m.id === id)
        return HttpResponse.json(row ?? null, { status: row ? 200 : 406 })
      }
      return HttpResponse.json([fullMatch(params.get('user_id')!.slice(3))])
    }),
    http.get(endpoint('player_details'), () => HttpResponse.json([{ position: 'mid', current_club: 'Academy', age_group: 'U15' }])),
    http.get(endpoint('squad_players'), () => HttpResponse.json([])),
    http.get(endpoint('coach_assessments'), () => HttpResponse.json([])),
    http.get(endpoint('recognition_awards'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => {
      approvalReads += 1
      return awaiting === 'fail' ? HttpResponse.json({ message: 'unavailable' }, { status: 503 }) : HttpResponse.json(awaiting)
    }),
  )
})
afterEach(cleanup)

function Where() { return <p data-testid="where">{useLocation().pathname}</p> }

function renderParent(route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[route]}>
      <ParentChildrenProvider>
        <Routes>
          <Route path="/parent/home" element={<ParentHome />} />
          <Route path="/parent/matches" element={<ParentMatches />} />
          <Route path="/parent/match/:id" element={<ParentMatchDetail />} />
        </Routes>
        <Where />
      </ParentChildrenProvider>
    </MemoryRouter>
  </QueryClientProvider>)
}

describe('parent match detail (TRAK-73)', () => {
  it('opens the selected child\'s match from parent home with the full detail', async () => {
    const user = userEvent.setup()
    renderParent('/parent/home')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Following' }), 'Zara')
    await user.click(await screen.findByRole('link', { name: /Zara opposition/ }))
    expect(screen.getByTestId('where')).toHaveTextContent(`/parent/match/match-Zara`)
    expect(await screen.findByText('3–1')).toBeInTheDocument()
    expect(screen.getByText("64'")).toBeInTheDocument()
    expect(screen.getByText('Midfielder')).toBeInTheDocument()
    expect(screen.getByText('Goals')).toBeInTheDocument()
  })

  it('opens a match from the Matches tab', async () => {
    const user = userEvent.setup()
    renderParent('/parent/matches')
    await user.click(await screen.findByRole('link', { name: /Alex opposition/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/parent/match/match-Alex')
    expect(await screen.findByText("64'")).toBeInTheDocument()
  })

  it('shows a child awaiting approval only what the parent already saw', async () => {
    awaiting = [{ player_user_id: ALEX, full_name: 'Alex', age_years: 14 }]
    renderParent('/parent/match/match-Alex')
    expect(await screen.findByText('3–1')).toBeInTheDocument()
    // Limited because Alex is waiting, not because the list is still loading.
    await waitFor(() => expect(approvalReads).toBe(1))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.getByText('League')).toBeInTheDocument()
    expect(screen.queryByText("64'")).not.toBeInTheDocument()
    expect(screen.queryByText('Midfielder')).not.toBeInTheDocument()
    expect(screen.queryByText('Goals')).not.toBeInTheDocument()
  })

  it('fails closed when the approval list cannot be read', async () => {
    awaiting = 'fail'
    renderParent('/parent/match/match-Zara')
    expect(await screen.findByText('3–1')).toBeInTheDocument()
    expect(screen.queryByText("64'")).not.toBeInTheDocument()
    expect(screen.queryByText('Goals')).not.toBeInTheDocument()
  })

  it('stays in the parent app: parent nav, back to parent matches', async () => {
    renderParent('/parent/match/match-Zara')
    expect(await screen.findByText('3–1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Alerts' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Card' })).not.toBeInTheDocument()
  })
})
