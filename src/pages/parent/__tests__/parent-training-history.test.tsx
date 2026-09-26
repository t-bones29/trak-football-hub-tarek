/**
 * TRAK-77 (J6): the parent sees the training the coach logged for the child
 * they have selected, through family_training_history() (TRAK-76): date,
 * focus labels and that child's attendance only. Sibling switching must stay
 * scoped, including when an earlier sibling's response arrives late.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ParentChildrenProvider } from '@/contexts/ParentChildrenContext'
import ParentMatches from '../ParentMatches'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'
import { formatParentDate } from '@/lib/parent-data'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'parent-a', email: 'parent-a@test.invalid' },
    profile: { full_name: 'Test Parent', role: 'parent' },
    signOut: vi.fn(), refreshProfile: vi.fn(),
  }),
}))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))

const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
const RPC = endpoint('rpc/family_training_history')
const TRAINING: Record<string, object[]> = {
  Alex: [{ session_id: 's-alex', session_date: '2026-09-20', focus: ['Technical', 'Tactical'], attendance: 'present' }],
  Zara: [{ session_id: 's-zara', session_date: '2026-09-21', focus: ['Finishing'], attendance: 'late' }],
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  server.use(
    http.get(endpoint('player_parent_links'), () => HttpResponse.json([{ player_user_id: 'Alex' }, { player_user_id: 'Zara' }])),
    http.get(endpoint('profiles'), ({ request }) => {
      const filter = new URL(request.url).searchParams.get('user_id') ?? ''
      return HttpResponse.json(['Alex', 'Zara'].filter(id => filter.includes(id)).map(user_id => ({ user_id, full_name: user_id })))
    }),
    http.get(endpoint('matches'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
  )
})
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); onlineManager.setOnline(true) })

function renderMatches() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/parent/matches']}>
      <ParentChildrenProvider>
        <Routes><Route path="/parent/matches" element={<ParentMatches />} /></Routes>
      </ParentChildrenProvider>
    </MemoryRouter>
  </QueryClientProvider>)
}

describe('TRAK-77: parent training history', () => {
  it('shows the selected child\'s training, and only that child\'s after switching', async () => {
    const asked: unknown[] = []
    server.use(http.post(RPC, async ({ request }) => {
      const body = await request.json() as { p_player_user_id: string }
      asked.push(body.p_player_user_id)
      return HttpResponse.json(TRAINING[body.p_player_user_id] ?? [])
    }))
    const user = userEvent.setup()
    renderMatches()
    expect(await screen.findByText('Technical · Tactical')).toBeInTheDocument()
    expect(screen.getByText(formatParentDate('2026-09-20'))).toBeInTheDocument()
    expect(screen.getByText('Present')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Following' }), 'Zara')
    expect(await screen.findByText('Finishing')).toBeInTheDocument()
    expect(screen.getByText('Late')).toBeInTheDocument()
    expect(screen.queryByText('Technical · Tactical')).toBeNull()
    expect(asked).toEqual(['Alex', 'Zara'])
  })

  it('ignores a late answer for the child the parent has switched away from', async () => {
    const alexHeld = deferred()
    server.use(http.post(RPC, async ({ request }) => {
      const body = await request.json() as { p_player_user_id: string }
      if (body.p_player_user_id === 'Alex') await alexHeld.promise
      return HttpResponse.json(TRAINING[body.p_player_user_id] ?? [])
    }))
    const user = userEvent.setup()
    renderMatches()
    const selector = await screen.findByRole('combobox', { name: 'Following' })
    await user.selectOptions(selector, 'Zara')
    expect(await screen.findByText('Finishing')).toBeInTheDocument()
    await act(async () => { alexHeld.resolve(); await new Promise(r => setTimeout(r, 30)) })
    expect(screen.getByText('Finishing')).toBeInTheDocument()
    expect(screen.queryByText('Technical · Tactical')).toBeNull()
  })

  it('tells the parent their own approval is what the training is waiting for', async () => {
    server.use(http.post(RPC, () => HttpResponse.json({ code: '42501', message: 'consent_required' }, { status: 403 })))
    renderMatches()
    expect(await screen.findByText(/appears once you approve/i)).toBeInTheDocument()
    expect(screen.queryByText(/once your parent approves/i)).toBeNull()
  })

  it('shows an error with Retry on a failed read, never an empty history', async () => {
    let fail = true
    server.use(http.post(RPC, () => fail
      ? HttpResponse.json({ code: 'XX000', message: 'synthetic failure' }, { status: 500 })
      : HttpResponse.json(TRAINING.Alex)))
    const user = userEvent.setup()
    renderMatches()
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0))
    expect(screen.queryByText('No training recorded yet.')).toBeNull()
    fail = false
    await user.click(screen.getAllByRole('button', { name: 'Retry' }).at(-1)!)
    expect(await screen.findByText('Technical · Tactical')).toBeInTheDocument()
  })
})
