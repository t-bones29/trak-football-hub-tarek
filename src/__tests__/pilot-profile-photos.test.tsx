import { act, cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlayerProfile from '@/pages/player/PlayerProfilePage'
import CoachProfile from '@/pages/coach/CoachProfilePage'
import ParentProfile from '@/pages/parent/ParentProfilePage'
import ClubProfile from '@/pages/club/ClubProfile'

const mocks = vi.hoisted(() => ({
  user: { id: 'synthetic-profile', email: 'profile@test.invalid' },
  profile: { full_name: 'Synthetic Profile', avatar_url: 'https://photos.test.invalid/child.jpg', invite_code: 'SYNTH1' },
  avatar: vi.fn(() => 'https://photos.test.invalid/signed.jpg'),
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => mocks }))
vi.mock('@/hooks/use-avatar-url', () => ({ useAvatarUrl: mocks.avatar }))
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }))
vi.mock('@/contexts/ParentChildrenContext', () => ({ useParentChildren: () => ({ children: [], selectedChild: null, loading: false, error: null }) }))
vi.mock('@/components/player/ParentInviteCard', () => ({ ParentInviteCard: () => null }))
vi.mock('@/components/player/PlayerConnections', () => ({ PlayerConnections: () => null }))

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => {
    const query = {
      select: () => query, eq: () => query, order: () => query, limit: () => query,
      maybeSingle: () => Promise.resolve({ data: { invite_code: 'SYNTH1' }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return query
  } },
  // Imported at load by the parent consent code the profile now renders (TRAK-13).
  SUPABASE_FUNCTIONS_URL: 'https://test.supabase.co/functions/v1',
  SUPABASE_ANON_KEY: 'test-anon-key',
}))
beforeEach(() => mocks.avatar.mockClear())
afterEach(cleanup)

describe('G7 profile photos', () => {
  it.each([['player', PlayerProfile], ['coach', CoachProfile], ['parent', ParentProfile], ['club', ClubProfile]] as const)(
    '%s never renders or signs a stored photo', async (_role, Profile) => {
      let container!: HTMLElement
      await act(async () => { ({ container } = render(<MemoryRouter><Profile /></MemoryRouter>)) })
      expect(container.querySelector('img')).toBeNull()
      expect(mocks.avatar).not.toHaveBeenCalled()
      expect(container.textContent).toContain('Synthetic Profile')
    },
  )
})
