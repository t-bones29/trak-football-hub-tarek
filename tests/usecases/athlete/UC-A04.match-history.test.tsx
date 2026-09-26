import { it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { rpc, table, tableError } from '../../msw/supabase'

const ATHLETE = { id: 'athlete-1' }

function signedInAthlete() {
  signInAs(ATHLETE)
  server.use(
    table('profiles', [
      { id: 'p-athlete', user_id: ATHLETE.id, role: 'player', full_name: 'Nikos Papadopoulos', nationality: 'GR' },
    ]),
    // The Matches screen also lists training (TRAK-76); none here, so the
    // match assertions stay about matches.
    rpc('family_training_history', () => []),
  )
}

const MATCH = {
  id: 'match-1',
  user_id: ATHLETE.id,
  opponent: 'Panathinaikos U15',
  competition: 'League',
  created_at: '2026-09-01T18:00:00.000Z',
  team_score: 2,
  opponent_score: 1,
  computed_rating: 7.4,
}

const OTHER_MATCH = {
  id: 'match-2',
  user_id: ATHLETE.id,
  opponent: 'Olympiacos U15',
  competition: 'Cup',
  created_at: '2026-08-20T18:00:00.000Z',
  team_score: 1,
  opponent_score: 1,
  computed_rating: 5.9,
}

useCase('UC-A04', () => {
  it('shows every logged match as a card', async () => {
    signedInAthlete()
    server.use(table('matches', [MATCH, OTHER_MATCH]))

    renderApp('/player/matches')

    expect(await screen.findByRole('heading', { name: 'Matches' })).toBeInTheDocument()
    // A single mocked row cannot distinguish "renders the array" from
    // "renders only the first element" — two distinguishable rows can.
    // findByText on the first row waits out the fetch; getByText on the
    // second then proves both are present in the same, already-settled
    // render (a lone findByText per row would still pass if the second
    // showed up in a later render), matching UC-C03's stronger shape.
    expect(await screen.findByText('vs Panathinaikos U15')).toBeInTheDocument()
    expect(screen.getByText('vs Olympiacos U15')).toBeInTheDocument()
  })

  it('shows an explicit empty message when nothing has been logged', async () => {
    signedInAthlete()
    server.use(table('matches', []))

    // PlayerMatches renders the empty-history message from its initial
    // `matches = []` state, before the fetch resolves — so a plain
    // `findByText` here would pass immediately without ever observing the
    // mocked response, and would keep passing even if the fetch replaced
    // that state with real rows. Wait for the mocked response to land first
    // so this genuinely exercises the post-fetch render, same as the
    // settle-signal technique below.
    let matchesResponseLanded = false
    function onResponseMocked({ request }: { request: Request }) {
      if (request.url.includes('/matches')) {
        matchesResponseLanded = true
      }
    }
    server.events.on('response:mocked', onResponseMocked)

    try {
      renderApp('/player/matches')

      await waitFor(() => expect(matchesResponseLanded).toBe(true))

      expect(await screen.findByText(/no matches found/i)).toBeInTheDocument()
    } finally {
      server.events.removeListener('response:mocked', onResponseMocked)
    }
  })

  // This is the assertion the audit's "false empty state" defect fails.
  // A permission-denied read currently renders identically to an empty
  // match history. Same root cause as Q-2026-09-07-02 (UC-C03), now also
  // recorded against PlayerMatches.tsx.
  it('distinguishes a failed load from an empty history', async () => {
    signedInAthlete()
    server.use(
      tableError('matches', 401, { code: '42501', message: 'permission denied for table matches' }),
    )

    // PlayerMatches renders its "Matches" heading and filter chips
    // synchronously, before the fetch resolves, so waiting on those proves
    // nothing about whether the mocked failure was processed. As in UC-C03,
    // the independent settle signal is the mocked matches response landing;
    // only after that has it is it safe to query synchronously for absence.
    let matchesResponseLanded = false
    function onResponseMocked({ request }: { request: Request }) {
      if (request.url.includes('/matches')) {
        matchesResponseLanded = true
      }
    }
    server.events.on('response:mocked', onResponseMocked)

    try {
      renderApp('/player/matches')

      await waitFor(() => expect(matchesResponseLanded).toBe(true))

      // EXPECTED TO FAIL — PlayerMatches.tsx destructures only `{ data }`
      // from the failed request, so `data` is null, `rows` falls back to
      // `[]`, and the empty-history panel renders for a permission failure
      // exactly as it would for a genuinely empty history. Recorded as
      // Q-2026-09-07-02 in docs/use-cases/OPEN-QUESTIONS.md — do not weaken
      // this assertion to make it pass.
      const emptyMessage = screen.queryByText(/no matches found/i)
      expect(
        emptyMessage,
        'A failed load must not render the empty-history message. ' +
        'See UC-A04, UC-C03 and UC-X02 in docs/use-cases/registry.yaml.',
      ).toBeNull()
    } finally {
      server.events.removeListener('response:mocked', onResponseMocked)
    }
  })
})
