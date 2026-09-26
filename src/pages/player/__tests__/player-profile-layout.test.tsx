/**
 * TRAK-71 part 2 (J6, use-case test 25 Sep): the player's Profile tab reads
 * Performance Trend → Coach Assessments (each one opens) → My Passport →
 * Connections → How Trak works → Settings. Connections replaces the separate
 * "Your coach" card once a coach is linked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc } from '../../../../tests/msw/supabase'

const PLAYER = { id: 'player-profile' }
const assessment = (id: string, created_at: string, score: number) => ({ id, squad_player_id: 'squad-1', coach_user_id: 'coach-1',
  created_at, work_rate: score, tactical: score, attitude: score, technical: score, physical: score, coachability: score })

beforeEach(() => {
  signInAs(PLAYER)
  server.use(
    table('profiles', [{ id: 'p', user_id: PLAYER.id, role: 'player', full_name: 'Manos Synthetic' }]),
    table('player_details', [{ user_id: PLAYER.id, position: 'Defender', shirt_number: 13 }]),
    table('matches', []),
    table('squad_players', [{ id: 'squad-1', coach_user_id: 'coach-1', linked_player_id: PLAYER.id, status: 'active' }]),
    table('coach_assessments', [assessment('assessment-2', '2026-09-24T10:00:00Z', 9), assessment('assessment-1', '2026-09-12T10:00:00Z', 6)]),
    table('player_parent_links', [{ parent_user_id: 'parent-1' }]),
    rpc('get_player_invites_for_current_user', () => []),
    rpc('my_consent_status', () => ({ required: false, invited_parent: null })),
  )
})
afterEach(() => cleanup())

const labels = ['PERFORMANCE TREND', 'COACH ASSESSMENTS', 'MY PASSPORT', 'CONNECTIONS', 'HOW TRAK WORKS', 'SETTINGS']

describe('TRAK-71: player Profile tab', () => {
  it('shows the sections in the agreed order', async () => {
    renderApp('/player/profile')
    await screen.findByText('CONNECTIONS')
    await screen.findByText('COACH ASSESSMENTS')
    const nodes = labels.map(label => screen.getByText(label))
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${labels[i - 1]} before ${labels[i]}`).toBeTruthy()
    }
  })

  it('drops the separate "Your coach" card once a coach is linked', async () => {
    renderApp('/player/profile')
    await screen.findByText('CONNECTIONS')
    await waitFor(() => expect(screen.queryByText('YOUR COACH')).toBeNull())
  })

  // TRAK-48 slice 4: the roster is the only way into a squad, so a player with
  // no coach yet is never offered a code to type.
  it('offers no coach code to a player who is not linked yet', async () => {
    server.use(table('squad_players', []))
    renderApp('/player/profile')
    await screen.findByText('CONNECTIONS')
    await waitFor(() => expect(screen.queryByText('CONNECT TO YOUR COACH')).toBeNull())
    expect(screen.queryByPlaceholderText('TRK-XXXX')).toBeNull()
    expect(screen.queryByRole('button', { name: /^connect$/i })).toBeNull()
  })

  it('lists each coach assessment, and opening one goes to that assessment', async () => {
    const user = userEvent.setup()
    renderApp('/player/profile')
    const older = await screen.findByRole('button', { name: /12 Sept/ })
    expect(screen.getByRole('button', { name: /24 Sept/ })).toBeInTheDocument()
    await user.click(older)
    await waitFor(() => expect(window.location.pathname).toBe('/player/feedback/assessment-1'))
  })
})
