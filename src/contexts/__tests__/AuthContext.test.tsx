import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from '../AuthContext'

const api = vi.hoisted(() => ({
  session: null as Session | null,
  listener: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
  getSession: vi.fn(),
  getUser: vi.fn(),
  lookup: vi.fn(),
  provision: vi.fn(),
  update: vi.fn(),
  invite: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  logoutResult: vi.fn(),
}))

// Each scoped client keeps its own session; the application's ordinary client
// follows the current account, just as the SDK does on a shared phone.
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: { accessToken: () => Promise<string> }) => client(false, options.accessToken),
}))
vi.mock('@/integrations/supabase/client', () => ({
  supabase: client(true),
  SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1',
  SUPABASE_ANON_KEY: 'test-anon-key',
}))
vi.mock('@/lib/telemetry', () => ({ setTelemetryRole: vi.fn(), trackSessionOpen: vi.fn() }))
vi.mock('sonner', () => ({ toast: { warning: api.warning, error: api.error } }))

function client(shared: boolean, accessToken?: () => Promise<string>) {
  const current = async () => shared ? api.session : sessions.get(await accessToken!())
  return {
    auth: {
      onAuthStateChange: (listener: typeof api.listener) => {
        api.listener = listener
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      getSession: () => api.getSession(),
      getUser: (token: string) => api.getUser(token),
      updateUser: async (attributes: unknown) => api.update((await current())?.user.id, attributes),
      signUp: (options: unknown) => api.signUp(options),
      signInWithPassword: vi.fn(),
      signOut: () => api.signOut(),
    },
    from: () => ({ select: () => ({ eq: (_: string, id: string) => ({
      maybeSingle: () => api.lookup(id),
    }) }) }),
    rpc: async (name: string, payload: unknown) => api.provision((await current())?.user.id, name, payload),
    // Options are forwarded, not dropped: F-5's fix lives in the request BODY,
    // and a mock that discards it lets a caller silently stop binding the send.
    functions: { invoke: async (name: string, options?: unknown) => api.invite((await current())?.user.id, name, options) },
  }
}

const sessions = new Map<string, Session>()
const pending = (name: string) => ({ role: 'player' as const, full_name: name, nationality: null })
function session(id: string, onboarding?: object): Session {
  const value = {
    access_token: `token-${id}`,
    refresh_token: `refresh-${id}`,
    user: {
      id, email: `${id}@example.test`,
      user_metadata: onboarding ? { trak_onboarding: onboarding } : {},
    } as User,
  } as Session
  sessions.set(value.access_token, value)
  return value
}
const profile = (id: string) => ({ id: `profile-${id}`, user_id: id, role: 'player', full_name: id, nationality: null })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}
async function emit(event: AuthChangeEvent, value: Session | null) {
  await act(async () => {
    api.session = value
    api.listener?.(event, value)
  })
}
function Draft() {
  const [text, setText] = useState('')
  return <input aria-label="Unsubmitted assessment" value={text} onChange={e => setText(e.target.value)} />
}
function Screen() {
  const { user, profile: data, loading, refreshProfile, signUp, signOut } = useAuth()
  return <>
    <output data-testid="identity">{user?.id ?? '-'}:{data?.user_id ?? '-'}</output>
    <button onClick={() => refreshProfile()}>Retry setup</button>
    <button onClick={() => signUp('a@example.test', 'a-strong-password', pending('A'))}>Sign up</button>
    <button onClick={async () => api.logoutResult(await signOut())}>Sign out</button>
    {loading ? <span>Loading</span> : <Draft />}
  </>
}
let queryClient: QueryClient
function mount() { return render(<QueryClientProvider client={queryClient}><AuthProvider><Screen /></AuthProvider></QueryClientProvider>) }

beforeEach(() => {
  vi.clearAllMocks()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  sessions.clear()
  api.session = null
  api.listener = null
  api.getSession.mockImplementation(async () => ({ data: { session: api.session } }))
  api.getUser.mockImplementation(async (token: string) => ({ data: { user: sessions.get(token)?.user }, error: null }))
  api.lookup.mockImplementation(async (id: string) => ({ data: profile(id), error: null }))
  api.provision.mockResolvedValue({ data: { warnings: [] }, error: null })
  api.update.mockResolvedValue({ data: {}, error: null })
  api.invite.mockResolvedValue({ data: { sent: true }, error: null })
  api.signUp.mockResolvedValue({ data: { user: null }, error: null })
  api.signOut.mockResolvedValue({ error: null })
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const token = new Headers(init.headers).get('Authorization')?.replace('Bearer ', '') ?? ''
    await api.update(sessions.get(token)?.user.id, JSON.parse(init.body as string))
    return new Response('{}', { status: 200 })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('account-bound onboarding and auth lifecycle', () => {
  it('provisions B only from B metadata, never A’s abandoned shared-phone payload', async () => {
    localStorage.setItem('trak_pending_profile', JSON.stringify(pending('A')))
    api.session = session('b', pending('B'))
    api.lookup.mockResolvedValueOnce({ data: null, error: null })
    mount()
    await waitFor(() => expect(api.provision).toHaveBeenCalledWith('b', 'provision_my_profile', { p: expect.objectContaining(pending('B')) }))
    expect(localStorage.getItem('trak_pending_profile')).toBeNull()
  })

  it('does not provision an account without its own onboarding metadata', async () => {
    localStorage.setItem('trak_pending_profile', JSON.stringify(pending('A')))
    api.session = session('b')
    api.lookup.mockResolvedValue({ data: null, error: null })
    mount()
    await screen.findByLabelText('Unsubmitted assessment')
    expect(api.provision).not.toHaveBeenCalled()
    expect(screen.getByTestId('identity')).toHaveTextContent('b:-')
  })

  it('uses fresh authenticated metadata, not a stale copy in the cached session', async () => {
    api.session = session('a', pending('Stale name'))
    api.getUser.mockResolvedValue({ data: { user: { ...api.session.user, user_metadata: { trak_onboarding: pending('Verified name') } } }, error: null })
    api.lookup.mockResolvedValueOnce({ data: null, error: null })
    mount()
    await waitFor(() => expect(api.provision).toHaveBeenCalledWith('a', 'provision_my_profile', { p: expect.objectContaining(pending('Verified name')) }))
  })

  it('does not interpret a failed profile query as permission to provision', async () => {
    api.session = session('a', pending('A'))
    api.lookup.mockResolvedValue({ data: null, error: { message: 'offline' } })
    mount()
    await screen.findByLabelText('Unsubmitted assessment')
    expect(api.provision).not.toHaveBeenCalled()
  })

  it('discards A’s delayed profile after the phone switches to B', async () => {
    const slow = deferred<{ data: ReturnType<typeof profile>; error: null }>()
    api.session = session('a')
    api.lookup.mockImplementation((id: string) => id === 'a' ? slow.promise : Promise.resolve({ data: profile(id), error: null }))
    mount()
    await waitFor(() => expect(api.lookup).toHaveBeenCalledWith('a'))
    await emit('SIGNED_IN', session('b'))
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('b:b'))
    await act(async () => slow.resolve({ data: profile('a'), error: null }))
    expect(screen.getByTestId('identity')).toHaveTextContent('b:b')
  })

  it('clears A immediately on account change while B is still loading', async () => {
    api.session = session('a')
    mount()
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('a:a'))
    queryClient.setQueryData(['private-account-data'], { owner: 'a' })
    api.lookup.mockImplementation(() => new Promise(() => {}))
    await emit('SIGNED_IN', session('b'))
    expect(screen.getByTestId('identity')).toHaveTextContent('b:-')
    expect(queryClient.getQueryData(['private-account-data'])).toBeUndefined()
  })

  it('ignores a stale initial getSession result after a newer auth event', async () => {
    const initial = deferred<{ data: { session: Session | null } }>()
    api.getSession.mockReturnValue(initial.promise)
    mount()
    await emit('SIGNED_IN', session('b'))
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('b:b'))
    await act(async () => initial.resolve({ data: { session: session('a') } }))
    expect(screen.getByTestId('identity')).toHaveTextContent('b:b')
  })

  it('keeps unsaved form state during TOKEN_REFRESHED and same-account SIGNED_IN', async () => {
    api.session = session('a')
    mount()
    const draft = await screen.findByLabelText('Unsubmitted assessment')
    fireEvent.change(draft, { target: { value: 'A coach’s unfinished feedback' } })
    api.lookup.mockImplementation(() => new Promise(() => {}))
    await emit('TOKEN_REFRESHED', api.session)
    expect(screen.getByLabelText('Unsubmitted assessment')).toHaveValue('A coach’s unfinished feedback')
    await emit('SIGNED_IN', api.session)
    expect(screen.getByLabelText('Unsubmitted assessment')).toHaveValue('A coach’s unfinished feedback')
  })

  it('does not mail or clear B metadata when A provisioning finishes after an account switch', async () => {
    const rpc = deferred<{ data: { warnings: string[] }; error: null }>()
    api.session = session('a', { ...pending('A'), parent_email: 'parent-a@example.test' })
    api.lookup.mockImplementation(async (id: string) => ({ data: id === 'a' ? null : profile(id), error: null }))
    api.provision.mockReturnValue(rpc.promise)
    mount()
    await waitFor(() => expect(api.provision).toHaveBeenCalled())
    await emit('SIGNED_IN', session('b'))
    await act(async () => rpc.resolve({ data: { warnings: [] }, error: null }))
    expect(api.invite).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()
    expect(screen.getByTestId('identity')).toHaveTextContent('b:b')
  })

  it('does not duplicate provisioning when the same account signs in during setup', async () => {
    const rpc = deferred<{ data: { warnings: string[] }; error: null }>()
    api.session = session('a', pending('A'))
    api.provision.mockReturnValue(rpc.promise)
    mount()
    await waitFor(() => expect(api.provision).toHaveBeenCalledTimes(1))
    await emit('SIGNED_IN', api.session)
    await emit('TOKEN_REFRESHED', api.session)
    expect(api.provision).toHaveBeenCalledTimes(1)
    await act(async () => rpc.resolve({ data: { warnings: [] }, error: null }))
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('a', { data: { trak_onboarding: null } }))
  })

  it('discards a pending profile after sign-out starts and does not clear a later sign-in', async () => {
    const lookup = deferred<{ data: ReturnType<typeof profile>; error: null }>()
    const logout = deferred<{ error: null }>()
    api.session = session('a')
    api.lookup.mockImplementation((id: string) => id === 'a' ? lookup.promise : Promise.resolve({ data: profile(id), error: null }))
    api.signOut.mockReturnValue(logout.promise)
    mount()
    await waitFor(() => expect(api.lookup).toHaveBeenCalledWith('a'))
    fireEvent.click(screen.getByText('Sign out'))
    await emit('SIGNED_IN', session('b'))
    await act(async () => {
      lookup.resolve({ data: profile('a'), error: null })
      logout.resolve({ error: null })
    })
    expect(screen.getByTestId('identity')).toHaveTextContent('b:b')
  })

  it.each(['returned', 'thrown'] as const)('retains the account on a %s logout error instead of claiming success', async failureMode => {
    api.session = session('a')
    const failure = new Error('network unavailable')
    if (failureMode === 'returned') api.signOut.mockResolvedValue({ error: failure })
    else api.signOut.mockRejectedValue(failure)
    mount()
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('a:a'))
    queryClient.setQueryData(['private-account-data'], { owner: 'a' })
    fireEvent.click(screen.getByText('Sign out'))
    await waitFor(() => expect(api.error).toHaveBeenCalledWith(expect.stringContaining('still signed in')))
    expect(api.logoutResult).toHaveBeenCalledWith({ error: failure })
    expect(screen.getByTestId('identity')).toHaveTextContent('a:a')
    expect(queryClient.getQueryData(['private-account-data'])).toEqual({ owner: 'a' })
  })

  it('does not restore an initial cached session after sign-out starts', async () => {
    const initial = deferred<{ data: { session: Session | null } }>()
    const logout = deferred<{ error: null }>()
    api.getSession.mockReturnValue(initial.promise)
    api.signOut.mockReturnValue(logout.promise)
    mount()
    fireEvent.click(screen.getByText('Sign out'))
    await act(async () => initial.resolve({ data: { session: session('a') } }))
    expect(api.lookup).not.toHaveBeenCalled()
    expect(screen.getByTestId('identity')).toHaveTextContent('-:-')
    await act(async () => logout.resolve({ error: null }))
  })

  it('clears account query state only when the SDK confirms sign-out', async () => {
    api.session = session('a')
    mount()
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('a:a'))
    queryClient.setQueryData(['private-account-data'], { owner: 'a' })
    await emit('SIGNED_OUT', null)
    expect(screen.getByTestId('identity')).toHaveTextContent('-:-')
    expect(queryClient.getQueryData(['private-account-data'])).toBeUndefined()
  })

  it('stops onboarding follow-up effects after the provider unmounts', async () => {
    const rpc = deferred<{ data: { warnings: string[] }; error: null }>()
    api.session = session('a', { ...pending('A'), parent_email: 'parent@example.test' })
    api.provision.mockReturnValue(rpc.promise)
    const view = mount()
    await waitFor(() => expect(api.provision).toHaveBeenCalled())
    view.unmount()
    await act(async () => rpc.resolve({ data: { warnings: [] }, error: null }))
    expect(api.invite).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()
  })

  it('preserves metadata repair and reports failed invite delivery without losing the profile', async () => {
    api.session = session('a', { ...pending('A'), parent_email: 'parent@example.test' })
    api.invite.mockResolvedValue({ data: { sent: false, reason: 'mail_rejected' }, error: null })
    mount()
    await waitFor(() => expect(api.provision).toHaveBeenCalled())
    await waitFor(() => expect(api.warning).toHaveBeenCalledWith(expect.stringContaining("couldn't email"), expect.any(Object)))
    expect(screen.getByTestId('identity')).toHaveTextContent('a:a')
  })

  // F-5. The handler narrows to the caller's own invite whose address matches
  // parent_email, but still accepts a body-less call for compatibility — so if
  // this caller ever stops sending the address, the unbound "any active invite"
  // path returns and nothing else would notice. Proven: dropping the body
  // passed all 666 tests before this assertion existed.
  it('binds the invite send to the parent address this signup supplied', async () => {
    api.session = session('a', { ...pending('A'), parent_email: 'guardian-a@example.test' })
    mount()
    await waitFor(() => expect(api.invite).toHaveBeenCalled())
    expect(api.invite).toHaveBeenCalledWith('a', 'send-parent-invite', { body: { parent_email: 'guardian-a@example.test' } })
  })

  it('keeps new signup metadata on the returned account rather than browser-global storage', async () => {
    mount()
    fireEvent.click(screen.getByText('Sign up'))
    await waitFor(() => expect(api.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ data: { trak_onboarding: pending('A') } }),
    })))
    expect(localStorage.getItem('trak_pending_profile')).toBeNull()
  })
})
