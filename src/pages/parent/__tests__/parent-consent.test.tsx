/**
 * Real App/router/AuthProvider/Supabase SDK, with synthetic intercepted HTTP.
 * Exercises the existing list/record RPC contract, not the deferred P2 policy
 * migration. This does not establish backend authentication, consent policy
 * or academy enforcement; those need independent database/runtime evidence.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '@supabase/supabase-js'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { supabase } from '@/integrations/supabase/client'
import { CONSENT_NOTICE_VERSION, CONSENT_STATEMENT } from '@/lib/consent'
import { server } from '../../../../tests/msw/server'
import { SUPABASE_URL } from '../../../../tests/msw/supabase'

const endpoint = (table: string) => `${SUPABASE_URL}/rest/v1/${table}`
const childA = { player_user_id: '99000000-0000-4000-8000-000000000001', full_name: 'Alex Synthetic', age_years: 12 }
const childB = { player_user_id: '99000000-0000-4000-8000-000000000002', full_name: 'Blair Synthetic', age_years: 13 }
const consentId = '99000000-0000-4000-8000-000000000003'
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
interface PendingReply { data: Json; status?: number }

let sequence = 0
let session: Session
let sessions: Map<string, Session>
let pendingReplies: PendingReply[]
let pendingBodies: unknown[]
let pendingAccounts: string[]
let grantBodies: unknown[]
let grantAccounts: string[]
let grantReply: PendingReply
let grantWait: Promise<void> | null
let completedGrants: string[]
let releaseRequests: (() => void)[]
let unexpected: string[]

const unavailable: PendingReply = {
  status: 503,
  data: { code: 'PGRST000', message: 'Synthetic pending-approval read unavailable', details: null, hint: null },
}

function expectedGrant(childId: string) {
  return {
    p_player_user_id: childId,
    p_relationship: 'parent',
    p_purposes: { coaching_records: true, recognition: false, parent_visibility: false },
    p_notice_version: CONSENT_NOTICE_VERSION,
    p_consent_text: CONSENT_STATEMENT,
  }
}

function assertAuthenticated(request: Request) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const account = sessions.get(token)
  expect(account, 'HTTP request must use a registered synthetic account token').toBeDefined()
  if (!account) throw new Error('Unknown synthetic account')
  return account
}

function newSession(): Session {
  // Unique parents keep the real App's module-level query cache isolated.
  const id = `99000000-0000-4000-8000-${String(100 + ++sequence).padStart(12, '0')}`
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expiresAt, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')
    + '.' + Buffer.from('synthetic-signature').toString('base64url')
  const account: Session = {
    access_token: token, refresh_token: `synthetic-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
    user: { id, email: `parent-${sequence}@consent.test.invalid`, aud: 'authenticated', role: 'authenticated',
      app_metadata: { provider: 'email' }, user_metadata: {},
      email_confirmed_at: '2026-09-18T08:00:00Z', created_at: '2026-09-18T08:00:00Z' },
  }
  sessions.set(token, account)
  return account
}

function heldRequest() {
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  releaseRequests.push(release)
  return { wait, release }
}

async function openConsent(replies: PendingReply[]) {
  pendingReplies = replies
  const result = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
  expect(result.error).toBeNull()
  window.history.replaceState({}, '', '/parent/consent')
  render(<App />)
}

async function approveAlex() {
  await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })
  expect(screen.getByRole('checkbox', { name: /recognition awards/i })).not.toBeChecked()
  expect(screen.getByRole('checkbox', { name: /I can see their progress/i })).not.toBeChecked()
  const button = screen.getByRole('button', { name: "Approve Alex Synthetic's account" })
  expect(button).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
  await userEvent.click(button)
  await waitFor(() => expect(grantBodies).toEqual([expectedGrant(childA.player_user_id)]))
}

beforeEach(() => {
  vi.stubEnv('DEV', false)
  sessionStorage.clear()
  pendingReplies = []
  pendingBodies = []
  pendingAccounts = []
  grantBodies = []
  grantAccounts = []
  grantReply = { data: consentId }
  grantWait = null
  completedGrants = []
  releaseRequests = []
  unexpected = []
  sessions = new Map()
  session = newSession()
  server.use(
    http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => {
      const account = assertAuthenticated(request)
      return HttpResponse.json(account.user)
    }),
    http.get(endpoint('profiles'), ({ request }) => {
      const account = assertAuthenticated(request)
      const query = new URL(request.url).searchParams
      expect(query.get('user_id')).toBe(`eq.${account.user.id}`)
      // AuthProvider loads the full profile; approval re-verifies only role
      // using its captured-session client. Both are real, authorized reads.
      expect(['*', 'role']).toContain(query.get('select'))
      return HttpResponse.json(query.get('select') === 'role' ? [{ role: 'parent' }]
        : [{ id: account.user.id, user_id: account.user.id, role: 'parent', full_name: 'Synthetic Parent', nationality: null }])
    }),
    // This independent family read is not the authority for pending consent.
    // Keeping it empty also lets an erroneous Home navigation settle without
    // inventing a development-record backend for a consent recovery test.
    http.get(endpoint('player_parent_links'), ({ request }) => {
      const account = assertAuthenticated(request)
      const query = new URL(request.url).searchParams
      expect(query.get('parent_user_id')).toBe(`eq.${account.user.id}`)
      expect(query.get('select')).toBe('player_user_id')
      return HttpResponse.json([])
    }),
    http.post(endpoint('telemetry_events'), ({ request }) => {
      assertAuthenticated(request)
      return new HttpResponse(null, { status: 201 })
    }),
    http.post(endpoint('rpc/get_children_awaiting_consent'), async ({ request }) => {
      const account = assertAuthenticated(request)
      const body: unknown = await request.json()
      pendingBodies.push(body)
      pendingAccounts.push(account.user.id)
      expect(body).toEqual({})
      // Repeating the final response permits real retry/Home reads; their
      // counts remain observable, rather than forcing a passing sequence.
      const reply = pendingReplies[Math.min(pendingBodies.length - 1, pendingReplies.length - 1)]
      if (!reply) throw new Error('No synthetic pending-approval reply configured')
      return HttpResponse.json(reply.data, { status: reply.status ?? 200 })
    }),
    http.post(endpoint('rpc/record_parental_consent'), async ({ request }) => {
      const account = assertAuthenticated(request)
      grantBodies.push(await request.json())
      grantAccounts.push(account.user.id)
      // Capture the response before pausing: later account changes cannot
      // substitute their fixture response into an earlier parent's request.
      const reply = grantReply
      if (grantWait) await grantWait
      completedGrants.push(account.user.id)
      // Actual SQL returns a UUID scalar, not an object or array.
      return HttpResponse.json(reply.data, { status: reply.status ?? 200 })
    }),
    http.all('*', ({ request }) => {
      unexpected.push(`${request.method} ${request.url}`)
      return HttpResponse.json({ message: 'Unexpected request blocked by consent fixture' }, { status: 500 })
    }),
  )
})

afterEach(({ task }) => {
  if (task.result?.state === 'fail') {
    console.info('Synthetic consent request diagnostic', {
      route: window.location.pathname,
      pendingReads: pendingBodies.length,
      grantWrites: grantBodies.length,
      emptyState: !!screen.queryByText('Nothing to approve'),
      crashed: !!screen.queryByText('Something went wrong'),
      abortGuardAvailable: typeof new AbortController().signal.throwIfAborted,
    })
  }
  cleanup()
  releaseRequests.forEach(release => release())
  expect(unexpected).toEqual([])
  vi.unstubAllEnvs()
})

describe('parent consent read and grant recovery through the real route', () => {
  it('shows a newly pending child after granting the formerly last child, without navigating Home', async () => {
    await openConsent([{ data: [childA] }, { data: [childB] }])
    await approveAlex()
    expect(await screen.findByRole('heading', { name: "Approve Blair Synthetic's account" })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/parent/consent')
    expect(screen.queryByRole('heading', { name: 'Home' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: CONSENT_STATEMENT })).not.toBeChecked()
    expect(screen.getByRole('button', { name: "Approve Blair Synthetic's account" })).toBeDisabled()
    expect(pendingBodies).toEqual([{}, {}])
    expect(grantBodies).toEqual([expectedGrant(childA.player_user_id)])
  })

  it('keeps a successful grant separate from a failed refresh and retries only the pending read', async () => {
    await openConsent([{ data: [childA] }, unavailable, { data: [childB] }])
    await approveAlex()
    const retry = await screen.findByRole('button', { name: /retry/i })
    expect(window.location.pathname).toBe('/parent/consent')
    expect(screen.queryByText('Nothing to approve')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: "Approve Alex Synthetic's account" })).not.toBeInTheDocument()
    expect(pendingBodies).toEqual([{}, {}])
    expect(grantBodies).toEqual([expectedGrant(childA.player_user_id)])
    await userEvent.click(retry)
    expect(await screen.findByRole('heading', { name: "Approve Blair Synthetic's account" })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/parent/consent')
    expect(pendingBodies).toEqual([{}, {}, {}])
    expect(grantBodies).toEqual([expectedGrant(childA.player_user_id)])
  })

  it('CONTROL: accepts a genuine empty pending list without submitting a grant', async () => {
    await openConsent([{ data: [] }])
    expect(await screen.findByText('Nothing to approve')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/parent/consent')
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(pendingBodies).toEqual([{}])
    expect(grantBodies).toEqual([])
  })

  it('CONTROL: an initial unavailable list can be retried into a real approval form', async () => {
    await openConsent([unavailable, { data: [childA] }])
    const retry = await screen.findByRole('button', { name: /retry/i })
    expect(screen.queryByText('Nothing to approve')).not.toBeInTheDocument()
    expect(pendingBodies).toEqual([{}])
    await userEvent.click(retry)
    expect(await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/parent/consent')
    expect(pendingBodies).toEqual([{}, {}])
    expect(grantBodies).toEqual([])
  })

  it.each<{ label: string; reply: PendingReply }>([
    { label: 'null UUID response', reply: { data: null } },
    { label: 'HTTP 503 response', reply: unavailable },
  ])('rechecks status after $label without re-granting, preserving same-child choices', async ({ reply }) => {
    grantReply = reply
    await openConsent([{ data: [childA] }, { data: [childA] }, { data: [] }])
    await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })
    await userEvent.click(screen.getByRole('button', { name: 'Legal guardian' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /recognition awards/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
    await userEvent.click(screen.getByRole('button', { name: "Approve Alex Synthetic's account" }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't confirm whether your approval was saved/i)
    expect(window.location.pathname).toBe('/parent/consent')
    expect(screen.queryByText(/Approval saved for/i)).not.toBeInTheDocument()
    const chosenGrant = { ...expectedGrant(childA.player_user_id), p_relationship: 'legal_guardian',
      p_purposes: { coaching_records: true, recognition: true, parent_visibility: false } }
    expect(grantBodies).toEqual([chosenGrant])
    expect(pendingBodies).toEqual([{}])

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })
    expect(screen.getByRole('checkbox', { name: /recognition awards/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /I can see their progress/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: CONSENT_STATEMENT })).toBeChecked()
    expect(screen.getByRole('button', { name: "Approve Alex Synthetic's account" })).toBeEnabled()
    expect(pendingBodies).toEqual([{}, {}])
    expect(grantBodies).toEqual([chosenGrant])

    // Only this new explicit click may submit again, after the authoritative
    // read still lists A. Its payload also proves the relationship survived.
    grantReply = { data: consentId }
    await userEvent.click(screen.getByRole('button', { name: "Approve Alex Synthetic's account" }))
    await screen.findByRole('heading', { name: 'Home' })
    expect(grantBodies).toEqual([chosenGrant, chosenGrant])
    expect(window.location.pathname).toBe('/parent/home')
  })

  it('resets relationship, optional purposes and confirmation for the next child', async () => {
    await openConsent([{ data: [childA] }, { data: [childB] }, { data: [] }])
    await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })
    await userEvent.click(screen.getByRole('button', { name: 'Legal guardian' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /recognition awards/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /I can see their progress/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
    await userEvent.click(screen.getByRole('button', { name: "Approve Alex Synthetic's account" }))
    await screen.findByRole('heading', { name: "Approve Blair Synthetic's account" })
    expect(screen.getByRole('checkbox', { name: /recognition awards/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /I can see their progress/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: CONSENT_STATEMENT })).not.toBeChecked()
    expect(screen.getByRole('button', { name: "Approve Blair Synthetic's account" })).toBeDisabled()
    expect(grantBodies).toEqual([{ ...expectedGrant(childA.player_user_id), p_relationship: 'legal_guardian',
      p_purposes: { coaching_records: true, recognition: true, parent_visibility: true } }])

    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
    await userEvent.click(screen.getByRole('button', { name: "Approve Blair Synthetic's account" }))
    await screen.findByRole('heading', { name: 'Home' })
    expect(grantBodies).toHaveLength(2)
    expect(grantBodies[1]).toEqual(expectedGrant(childB.player_user_id))
  })

  it('disables choices and duplicate submission while the grant HTTP response is held', async () => {
    const gate = heldRequest()
    grantWait = gate.wait
    await openConsent([{ data: [childA] }, { data: [childB] }])
    await approveAlex()
    const saving = screen.getByRole('button', { name: 'Saving…' })
    expect(saving).toBeDisabled()
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Parent' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Legal guardian' })).toBeDisabled()
    await userEvent.dblClick(saving)
    await userEvent.click(screen.getByRole('checkbox', { name: /recognition awards/i }))
    expect(grantBodies).toEqual([expectedGrant(childA.player_user_id)])
    expect(completedGrants).toEqual([])
    expect(pendingBodies).toEqual([{}])
    await act(async () => { gate.release(); await gate.wait })
    await screen.findByRole('heading', { name: "Approve Blair Synthetic's account" })
    expect(grantBodies).toHaveLength(1)
    expect(pendingBodies).toEqual([{}, {}])
  })

  it('discards the old parent completion after an SDK account change while a verified grant is held', async () => {
    const parentA = session
    const gate = heldRequest()
    grantWait = gate.wait
    await openConsent([{ data: [childA] }, { data: [childB] }, { data: [] }])
    await approveAlex()
    expect(grantAccounts).toEqual([parentA.user.id])
    expect(completedGrants).toEqual([])

    const parentB = newSession()
    session = parentB
    await act(async () => {
      const result = await supabase.auth.setSession({ access_token: parentB.access_token, refresh_token: parentB.refresh_token })
      expect(result.error).toBeNull()
    })
    await screen.findByRole('heading', { name: "Approve Blair Synthetic's account" })
    expect(screen.queryByRole('heading', { name: "Approve Alex Synthetic's account" })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: CONSENT_STATEMENT })).not.toBeChecked()
    expect(pendingAccounts).toEqual([parentA.user.id, parentB.user.id])
    await act(async () => { gate.release(); await gate.wait })
    await waitFor(() => expect(completedGrants).toEqual([parentA.user.id]))
    expect(screen.getByRole('heading', { name: "Approve Blair Synthetic's account" })).toBeInTheDocument()
    expect(screen.queryByText(/Approval saved for Alex/i)).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/parent/consent')
    expect(pendingAccounts).toEqual([parentA.user.id, parentB.user.id])
    expect(grantBodies).toEqual([expectedGrant(childA.player_user_id)])
    expect(grantAccounts).toEqual([parentA.user.id])

    // B's explicit approval uses B's token and B's child, never A's payload.
    grantWait = null
    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
    await userEvent.click(screen.getByRole('button', { name: "Approve Blair Synthetic's account" }))
    await screen.findByRole('heading', { name: 'Home' })
    expect(grantBodies).toEqual([expectedGrant(childA.player_user_id), expectedGrant(childB.player_user_id)])
    expect(grantAccounts).toEqual([parentA.user.id, parentB.user.id])
  })

  it.each(['email no longer verified', 'role no longer parent'] as const)(
    'does not send approval when fresh account verification finds %s', async condition => {
      await openConsent([{ data: [childA] }])
      await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })
      if (condition === 'email no longer verified') {
        server.use(http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => {
          const account = assertAuthenticated(request)
          return HttpResponse.json({ ...account.user, email_confirmed_at: null })
        }))
      } else {
        server.use(http.get(endpoint('profiles'), ({ request }) => {
          const account = assertAuthenticated(request)
          const query = new URL(request.url).searchParams
          expect(query.get('user_id')).toBe(`eq.${account.user.id}`)
          expect(query.get('select')).toBe('role')
          return HttpResponse.json([{ role: 'coach' }])
        }))
      }
      await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
      await userEvent.click(screen.getByRole('button', { name: "Approve Alex Synthetic's account" }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't confirm whether your approval was saved/i)
      expect(grantBodies).toEqual([])
      expect(pendingBodies).toEqual([{}])
      expect(window.location.pathname).toBe('/parent/consent')
    },
  )

  it.each<{ label: string; data: Json }>([
    { label: 'null body', data: null },
    { label: 'null child', data: [null] },
    { label: 'non-array body', data: { unexpected: true } },
    { label: 'malformed child', data: [{ ...childA, full_name: null }] },
  ])('treats $label as a retryable read error, never an empty result or application crash', async ({ data }) => {
    await openConsent([{ data }, { data: [childA] }])
    const retry = await screen.findByRole('button', { name: /retry/i })
    expect(window.location.pathname).toBe('/parent/consent')
    expect(screen.queryByText('Nothing to approve')).not.toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    expect(pendingBodies).toEqual([{}])
    expect(grantBodies).toEqual([])
    await userEvent.click(retry)
    expect(await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })).toBeInTheDocument()
    expect(pendingBodies).toEqual([{}, {}])
    expect(grantBodies).toEqual([])
  })
})

describe('explicit child choice for parent approval', () => {
  it('identifies full names and submits the chosen second child with fresh choices', async () => {
    const sibling = { ...childB, full_name: 'Alex Otherfamily' }
    await openConsent([{ data: [childA, sibling] }, { data: [childA] }])
    await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })
    await userEvent.click(screen.getByRole('checkbox', { name: /recognition awards/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Child to approve' }), sibling.player_user_id)
    await screen.findByRole('heading', { name: "Approve Alex Otherfamily's account" })
    expect(screen.getByRole('checkbox', { name: /recognition awards/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: CONSENT_STATEMENT })).not.toBeChecked()
    const approve = screen.getByRole('button', { name: "Approve Alex Otherfamily's account" })
    expect(approve).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
    await userEvent.click(approve)
    await waitFor(() => expect(grantBodies).toEqual([expectedGrant(sibling.player_user_id)]))
    await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })
    expect(screen.getByRole('checkbox', { name: CONSENT_STATEMENT })).not.toBeChecked()
  })

  it('prevents switching children while an approval is in flight', async () => {
    const held = heldRequest()
    grantWait = held.wait
    await openConsent([{ data: [childA, childB] }, { data: [childB] }])
    await screen.findByRole('heading', { name: "Approve Alex Synthetic's account" })
    await userEvent.click(screen.getByRole('checkbox', { name: CONSENT_STATEMENT }))
    await userEvent.click(screen.getByRole('button', { name: "Approve Alex Synthetic's account" }))
    await waitFor(() => expect(grantBodies).toHaveLength(1))
    expect(screen.getByRole('combobox', { name: 'Child to approve' })).toBeDisabled()
    held.release()
    await screen.findByRole('heading', { name: "Approve Blair Synthetic's account" })
    expect(grantBodies).toEqual([expectedGrant(childA.player_user_id)])
  })
})
