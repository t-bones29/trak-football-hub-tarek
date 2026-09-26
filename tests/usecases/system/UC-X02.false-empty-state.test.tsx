import { it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { useCase } from '../../support/use-case'
import { renderApp } from '../../support/render-app'
import { signInAs } from '../../support/session'
import { server } from '../../msw/server'
import { rpc, table, tableError } from '../../msw/supabase'
import { http, HttpResponse } from 'msw'
import { SUPABASE_URL } from '../../msw/supabase'

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

/**
 * Waits for the mocked matches response to land. The screen renders its
 * heading and filter chips synchronously, so waiting on those proves nothing
 * about whether the failure was processed.
 */
async function matchesRequestSettled(run: () => void) {
  let landed = false
  const onResponse = ({ request }: { request: Request }) => {
    if (request.url.includes('/matches')) landed = true
  }
  server.events.on('response:mocked', onResponse)
  try {
    run()
    await waitFor(() => expect(landed).toBe(true))
  } finally {
    server.events.removeListener('response:mocked', onResponse)
  }
}

useCase('UC-X02', () => {
  it('shows a retryable error when the request fails', async () => {
    signedInAthlete()
    server.use(tableError('matches', 401, { code: '42501', message: 'permission denied for table matches' }))

    await matchesRequestSettled(() => renderApp('/player/matches'))

    // "A retryable error is shown"
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('does not render the empty-state message for a failed request', async () => {
    signedInAthlete()
    server.use(tableError('matches', 500, { message: 'upstream unavailable' }))

    await matchesRequestSettled(() => renderApp('/player/matches'))

    // "The error is visibly different from the genuine empty state" — half one:
    // the empty copy must be absent. A player with a full season must never be
    // told their record does not exist.
    expect(screen.queryByText(/no matches found/i)).toBeNull()
  })

  it('renders the empty state, and no error, when the request genuinely returns nothing', async () => {
    signedInAthlete()
    server.use(table('matches', []))

    await matchesRequestSettled(() => renderApp('/player/matches'))

    // "The error is visibly different from the genuine empty state" — half two.
    // Without this the first two tests could be satisfied by showing the error
    // unconditionally, which would be just as dishonest in the other direction.
    expect(await screen.findByText(/no matches found/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

useCase('UC-X02', () => {
  it('a failed page never silently skips matches', async () => {
    signedInAthlete()

    // Page 1 (rows 0-19) succeeds, page 2 (20-39) fails, page 3 (40-59) would
    // succeed. Reproduces Imad's finding on #18: advancing the cursor on
    // request rather than on success let the middle twenty vanish.
    const pageOne = Array.from({ length: 20 }, (_, i) => ({
      id: `p1-${i}`, user_id: ATHLETE.id, opponent: `First ${i}`, competition: 'League',
      match_date: `2026-09-${String(20 - i).padStart(2, '0')}`, created_at: '2026-09-01T18:00:00.000Z',
      team_score: 1, opponent_score: 0, computed_rating: 7,
    }))
    const pageThree = [{
      id: 'p3-0', user_id: ATHLETE.id, opponent: 'Third page club', competition: 'League',
      match_date: '2026-06-01', created_at: '2026-06-01T18:00:00.000Z',
      team_score: 2, opponent_score: 0, computed_rating: 7,
    }]

    const served: string[] = []
    server.use(
      http.get(`${SUPABASE_URL}/rest/v1/matches`, ({ request }) => {
        // supabase-js sends the range as offset/limit query params, not a
        // Range header.
        const offset = new URL(request.url).searchParams.get('offset') ?? '0'
        served.push(offset)
        if (offset === '0') return HttpResponse.json(pageOne)
        if (offset === '20') return HttpResponse.json({ message: 'boom' }, { status: 500 })
        return HttpResponse.json(pageThree)
      }),
    )

    await matchesRequestSettled(() => renderApp('/player/matches'))
    expect(await screen.findByText('vs First 0')).toBeInTheDocument()

    const loadMore = await screen.findByRole('button', { name: /load more/i })
    loadMore.click()
    await waitFor(() => expect(served.includes('20')).toBe(true))

    // The next request must be page 2 again, never page 3. Before the fix the
    // cursor had already moved, so the retry fetched 40-59 and rows 20-39 were
    // gone from the player's season with nothing to show it.
    const retry = await screen.findByRole('button', { name: /retry/i })
    retry.click()
    await waitFor(() => expect(served.filter((r) => r === '20').length).toBe(2))
    expect(served.includes('40')).toBe(false)
  })
})
