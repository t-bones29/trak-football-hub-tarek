import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import App from '@/App'
import { supabase } from '@/integrations/supabase/client'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const childA = '99000000-0000-4000-8000-000000000001'
const childB = '99000000-0000-4000-8000-000000000002'
const endpoint = (name: string) => `${SUPABASE_URL}/rest/v1/${name}`
let seq = 600
let session: Session
let active: Set<string>
let matchReads: number
let reads: string[]
let writes: { parent: string; child: string }[]
let response: number | string | null
let status: number
let readFailure: boolean
let hold: Promise<void> | null
let release: (() => void) | undefined
let unexpected: string[]
const sessions = new Map<string, Session>()
function makeSession(): Session {
  const id = `99000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expiresAt, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic-signature'
  const value: Session = { access_token: token, refresh_token: `synthetic-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
    user: { id, email: `parent-${seq}@synthetic.test.invalid`, aud: 'authenticated', role: 'authenticated',
      app_metadata: { provider: 'email' }, user_metadata: {}, email_confirmed_at: '2026-09-18T08:00:00Z', created_at: '2026-09-18T08:00:00Z' } }
  sessions.set(token, value)
  return value
}
function account(request: Request) {
  const found = sessions.get((request.headers.get('authorization') ?? '').replace(/^Bearer /, ''))
  expect(found).toBeDefined()
  return found!
}
beforeEach(() => {
  vi.stubEnv('DEV', false)
  matchReads = 0
  session = makeSession(); active = new Set([childA, childB]); reads = []; writes = []
  response = 1; status = 200; readFailure = false; hold = null; release = undefined; unexpected = []
  server.use(
    http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => HttpResponse.json(account(request).user)),
    http.get(endpoint('profiles'), ({ request }) => {
      const me = account(request); const q = new URL(request.url).searchParams
      if (q.get('select') === 'user_id,full_name') return HttpResponse.json([
        { user_id: childA, full_name: 'Amber Synthetic' }, { user_id: childB, full_name: 'Indigo Synthetic' }])
      expect(q.get('user_id')).toBe(`eq.${me.user.id}`)
      return HttpResponse.json([{ id: me.user.id, user_id: me.user.id, role: 'parent', full_name: 'Synthetic Parent' }])
    }),
    http.get(endpoint('player_parent_links'), ({ request }) => {
      expect(new URL(request.url).searchParams.get('parent_user_id')).toBe(`eq.${account(request).user.id}`)
      return HttpResponse.json([{ player_user_id: childA }, { player_user_id: childB }])
    }),
    http.get(endpoint('parental_consents'), ({ request }) => {
      const me = account(request); const q = new URL(request.url).searchParams
      expect(q.get('parent_user_id')).toBe(`eq.${me.user.id}`)
      expect(q.get('withdrawn_at')).toBe('is.null')
      const child = q.get('player_user_id')!.slice(3); reads.push(child)
      if (readFailure) return HttpResponse.json({ message: 'Synthetic unavailable' }, { status: 503 })
      return HttpResponse.json(active.has(child) ? [{ id: '99000000-0000-4000-8000-000000000003' }] : [])
    }),
    http.post(endpoint('rpc/withdraw_parental_consent'), async ({ request }) => {
      const me = account(request); const body = await request.json() as { p_player_user_id: string }
      expect(Object.keys(body)).toEqual(['p_player_user_id'])
      writes.push({ parent: me.user.id, child: body.p_player_user_id })
      const reply = response, code = status
      if (hold) await hold
      if (code === 200) active.delete(body.p_player_user_id)
      return HttpResponse.json(reply, { status: code })
    }),
    http.get(endpoint('matches'), () => {
      matchReads++
      return HttpResponse.json(active.has(childA) ? [{ id: childA, opponent: 'Cached Amber match', match_date: '2026-09-20', computed_rating: 0 }] : [])
    }),
    http.get(endpoint('player_details'), () => HttpResponse.json([])),
    http.get(endpoint('squad_players'), () => HttpResponse.json([])),
    http.post(endpoint('rpc/get_children_awaiting_consent'), () => HttpResponse.json([])),
    http.post(endpoint('telemetry_events'), () => new HttpResponse(null, { status: 201 })),
    http.all('*', ({ request }) => { unexpected.push(`${request.method} ${request.url}`); return new HttpResponse(null, { status: 500 }) }),
  )
})
afterEach(() => { cleanup(); release?.(); expect(unexpected).toEqual([]); vi.unstubAllEnvs() })
async function open() {
  await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
  window.history.replaceState({}, '', '/parent/profile'); render(<App />)
  await screen.findByText('Following Amber Synthetic · 2 children linked')
}
async function confirm(name = 'Amber Synthetic') {
  await userEvent.click(await screen.findByRole('button', { name: `Withdraw consent for ${name}` }))
  await userEvent.click(screen.getByRole('button', { name: `Confirm withdrawal for ${name}` }))
}
describe('parent Profile consent withdrawal through real App and SDK', () => {
  it('exposes the promised control, confirms the named child, and leaves the second child approved', async () => {
    await open()
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw consent for Amber Synthetic' }))
    expect(writes).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Keep consent' }))
    expect(writes).toEqual([])
    await confirm()
    await screen.findByText('Your consent for Amber Synthetic has been withdrawn.')
    expect(writes).toEqual([{ parent: session.user.id, child: childA }])
    expect(active.has(childB)).toBe(true)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Following' }), childB)
    await screen.findByRole('button', { name: 'Withdraw consent for Indigo Synthetic' })
    expect(screen.queryByText('Your consent for Amber Synthetic has been withdrawn.')).not.toBeInTheDocument()
  })
  it('drops the selected child history cache after withdrawal before the normal stale interval', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Home' }))
    await screen.findByText('Cached Amber match')
    expect(matchReads).toBe(1)
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }))
    await confirm()
    await screen.findByText('Your consent for Amber Synthetic has been withdrawn.')
    await userEvent.click(screen.getByRole('button', { name: 'Home' }))
    await waitFor(() => expect(matchReads).toBe(2))
    expect(screen.queryByText('Cached Amber match')).not.toBeInTheDocument()
  })
  it('clears confirmation on child change so it cannot approve withdrawal for another child', async () => {
    await open()
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw consent for Amber Synthetic' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Following' }), childB)
    await screen.findByRole('button', { name: 'Withdraw consent for Indigo Synthetic' })
    expect(screen.queryByRole('button', { name: /Confirm withdrawal/ })).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })
  it('accepts an idempotent zero response', async () => {
    response = 0; await open(); await confirm()
    await screen.findByText('Your consent for Amber Synthetic has been withdrawn.')
    expect(writes).toHaveLength(1)
  })
  it('reconciles a rejected write and can retry only after reading active status again', async () => {
    status = 503; await open(); await confirm()
    await screen.findByText(/Couldn.t confirm whether your consent was withdrawn/)
    expect(writes).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Check consent status' }))
    await screen.findByRole('button', { name: 'Withdraw consent for Amber Synthetic' })
    status = 200; await confirm()
    await screen.findByText('Your consent for Amber Synthetic has been withdrawn.')
    expect(writes).toHaveLength(2)
  })
  it('shows no active own approval without claiming the child is globally unapproved', async () => {
    active.delete(childA); await open()
    await screen.findByText('You have no active consent recorded for Amber Synthetic.')
    expect(screen.queryByRole('button', { name: /Withdraw consent for/ })).not.toBeInTheDocument()
    expect(writes).toEqual([])
  })
  it('does not turn a failed status read into no approval and provides a working retry', async () => {
    readFailure = true; await open()
    await screen.findByRole('alert')
    expect(screen.queryByText(/You have no active consent/)).not.toBeInTheDocument()
    readFailure = false
    await userEvent.click(screen.getByRole('button', { name: 'Check consent status' }))
    await screen.findByRole('button', { name: 'Withdraw consent for Amber Synthetic' })
  })
  it.each([null, -1, '1'])('reconciles an ambiguous reply %j before offering another write', async reply => {
    response = reply; await open(); await confirm()
    await screen.findByText(/Couldn.t confirm whether your consent was withdrawn/)
    expect(screen.queryByRole('button', { name: /Confirm withdrawal/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Check consent status' }))
    await screen.findByText('You have no active consent recorded for Amber Synthetic.')
    expect(writes).toHaveLength(1)
  })
  it('does not repeat a pending write or apply its result after switching children', async () => {
    hold = new Promise(resolve => { release = resolve }); await open(); await confirm()
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Withdrawing…' })).toBeDisabled()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Following' }), childB)
    await screen.findByRole('button', { name: 'Withdraw consent for Indigo Synthetic' })
    await act(async () => { release!() })
    expect(screen.queryByText(/Your consent for Amber/)).not.toBeInTheDocument()
    expect(writes).toEqual([{ parent: session.user.id, child: childA }])
  })
  it('keeps an in-flight write bound to the parent who confirmed it', async () => {
    hold = new Promise(resolve => { release = resolve }); await open(); await confirm()
    await waitFor(() => expect(writes).toHaveLength(1))
    const first = session.user.id; session = makeSession()
    await act(async () => { await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }) })
    await screen.findByRole('button', { name: 'Withdraw consent for Amber Synthetic' })
    await act(async () => { release!() })
    expect(writes).toEqual([{ parent: first, child: childA }])
    expect(screen.queryByText(/has been withdrawn/)).not.toBeInTheDocument()
  })
})
