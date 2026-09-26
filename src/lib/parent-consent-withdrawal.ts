import { supabase } from '@/integrations/supabase/client'
import { createOnboardingSession } from './onboarding-session'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/integrations/supabase/types'

// Generated types predate these existing September RPC/table contracts.
// Keep this narrow adapter local; runtime responses are validated below.
type WithdrawalDatabase = Database & { public: {
  Tables: { parental_consents: {
    Row: { id: string; parent_user_id: string; player_user_id: string; withdrawn_at: string | null }
    Insert: never
    Update: never
    Relationships: []
  } }
  Functions: { withdraw_parental_consent: { Args: { p_player_user_id: string }; Returns: number } }
} }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function parentAccount(parentId: string, signal: AbortSignal) {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  if (!data.session || data.session.user.id !== parentId) throw new Error('Your account changed')
  const account = await createOnboardingSession(data.session)
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  if (!account.user.email_confirmed_at) throw new Error('Verify your email first')
  const { data: profile, error: profileError } = await account.client.from('profiles')
    .select('role').eq('user_id', parentId).abortSignal(signal).retry(false).maybeSingle()
  if (profileError) throw profileError
  if (profile?.role !== 'parent') throw new Error('Use your parent account')
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
  return account.client as unknown as SupabaseClient<WithdrawalDatabase>
}

/** Own approval only: another guardian's approval is a separate record. */
export async function hasOwnConsent(parentId: string, childId: string, signal: AbortSignal): Promise<boolean> {
  const client = await parentAccount(parentId, signal)
  const { data, error } = await client.from('parental_consents').select('id')
    .eq('parent_user_id', parentId).eq('player_user_id', childId).is('withdrawn_at', null)
    .abortSignal(signal).retry(false)
  if (error) throw error
  if (!Array.isArray(data) || data.some(row => !row || typeof row.id !== 'string' || !uuid.test(row.id))) {
    throw new Error('Unconfirmed consent status')
  }
  return data.length > 0
}

export async function withdrawOwnConsent(parentId: string, childId: string, signal: AbortSignal): Promise<void> {
  const client = await parentAccount(parentId, signal)
  const { data, error } = await client.rpc('withdraw_parental_consent', { p_player_user_id: childId })
    .abortSignal(signal).retry(false)
  if (error) throw error
  // Zero is a confirmed idempotent completion; null or a string is not.
  if (typeof data !== 'number' || !Number.isSafeInteger(data) || data < 0) throw new Error('Unconfirmed withdrawal')
}

/** Bound UI recovery even if an earlier Auth SDK lookup ignores cancellation. */
export async function consentRequest<T>(request: AbortController, action: () => Promise<T>): Promise<T> {
  let rejectAbort!: (error: Error) => void
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject })
  const abort = () => rejectAbort(new DOMException('Consent request cancelled', 'AbortError'))
  request.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => request.abort(), 20_000)
  try {
    if (request.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    return await Promise.race([action(), cancelled])
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abort)
  }
}
