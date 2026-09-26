/**
 * TRAK-76 (J6): the player sees the training their coach logged, on their
 * history page. The data comes only from family_training_history(): date,
 * focus labels and their own attendance (Kostas's TRAK-6 contract). Real App,
 * AuthProvider and SDK, with MSW behind them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { registerAuthUser } from '../../../../tests/msw/auth-sessions'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { supabase } from '@/integrations/supabase/client'
import { formatParentDate } from '@/lib/parent-data'

const RPC = `${SUPABASE_URL}/rest/v1/rpc/family_training_history`
const TECH = { session_id: 's-1', session_date: '2026-09-23', focus: ['Technical', 'Tactical'], attendance: 'present' }
const PLAIN = { session_id: 's-2', session_date: '2026-09-21', focus: null, attendance: 'late' }
let sequence = 0
let account: string

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  account = `training-player-${++sequence}`
  signInAs({ id: account })
  server.use(
    table('profiles', [{ id: 'p', user_id: account, role: 'player', full_name: 'Training Player' }]),
    table('matches', []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
    rpc('get_player_invites_for_current_user', () => []),
    http.post(`${SUPABASE_URL}/auth/v1/token`, () => {
      const previous = JSON.parse(localStorage.getItem('sb-test-auth-token')!)
      const user = structuredClone(previous.user)
      return HttpResponse.json({ ...previous, user, access_token: registerAuthUser(user),
        expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600 })
    }),
  )
})
afterEach(() => cleanup())

describe('TRAK-76: player training history', () => {
  it('shows each training with its date, focus labels and the player\'s attendance', async () => {
    let asked: unknown
    server.use(rpc('family_training_history', args => { asked = args; return [TECH, PLAIN] }))
    renderApp('/player/matches')
    expect(await screen.findByText('Technical · Tactical')).toBeInTheDocument()
    expect(screen.getByText(formatParentDate('2026-09-23'))).toBeInTheDocument()
    expect(screen.getByText('Present')).toBeInTheDocument()
    // No structured focus: just "Training", never a guess.
    expect(screen.getAllByText('Training').length).toBe(2)
    expect(screen.getByText(formatParentDate('2026-09-21'))).toBeInTheDocument()
    expect(screen.getByText('Late')).toBeInTheDocument()
    expect(asked).toEqual({ p_player_user_id: account })
  })

  it('says so truthfully when the coach has logged no training', async () => {
    server.use(rpc('family_training_history', () => []))
    renderApp('/player/matches')
    expect(await screen.findByText('No training recorded yet.')).toBeInTheDocument()
  })

  it('shows an error with Retry when the read fails, never an empty history', async () => {
    let fail = true
    server.use(rpc('family_training_history', () =>
      fail ? { status: 500, body: { code: 'XX000', message: 'synthetic failure' } } : [TECH]))
    renderApp('/player/matches')
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByText('No training recorded yet.')).toBeNull()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Technical · Tactical')).toBeInTheDocument()
  })

  it('tells a player waiting for approval why there is nothing yet', async () => {
    server.use(rpc('family_training_history', () => ({ status: 403, body: { code: '42501', message: 'consent_required' } })))
    renderApp('/player/matches')
    expect(await screen.findByText(/once your parent approves/i)).toBeInTheDocument()
    expect(screen.queryByText('No training recorded yet.')).toBeNull()
  })

  it('never lets an older response replace a newer one', async () => {
    const first = deferred()
    let calls = 0
    server.use(http.post(RPC, async () => {
      calls++
      if (calls === 1) { await first.promise; return HttpResponse.json([PLAIN]) }
      return HttpResponse.json([TECH])
    }))
    renderApp('/player/matches')
    await waitFor(() => expect(calls).toBe(1))
    // A same-account token refresh re-reads (the result can have changed).
    await act(async () => { await supabase.auth.refreshSession() })
    expect(await screen.findByText('Technical · Tactical')).toBeInTheDocument()
    await act(async () => { first.resolve(); await new Promise(r => setTimeout(r, 30)) })
    expect(screen.getByText('Technical · Tactical')).toBeInTheDocument()
    expect(screen.queryByText('Late')).toBeNull()
  })
})
