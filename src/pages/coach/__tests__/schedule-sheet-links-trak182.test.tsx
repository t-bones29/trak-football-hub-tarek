import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { atMorningToday } from '../../../../tests/support/clock'
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { localTodayISO, toInstant } from '@/lib/event-time'

/**
 * TRAK-182: the event sheet on Home sends Edit to Schedule as ?edit=<id>, and a
 * weekly series' Publish as ?publish=<id> (Schedule asks "this week or the
 * following"). Schedule opens that sheet once its rows load.
 */
const COACH = { id: 'coach-182' }
const today = localTodayISO()
const row = (over: Record<string, unknown>) => ({
  coach_user_id: COACH.id, event_type: 'training', starts_at: toInstant(today, '17:00'), ends_at: null,
  event_date: today, start_time: '17:00:00', venue: 'Academy Pitch 2', opponent: null, notes: null,
  published: false, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null, ...over,
})

// TRAK-230: today's 17:00 and 19:00 events are still to come, so the links open them.
afterEach(() => vi.useRealTimers())
beforeEach(() => {
  atMorningToday()
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, () => HttpResponse.json([
      row({ id: 'one-1', title: 'Finishing' }),
      row({ id: 'wk-1', title: 'Weekly', series_id: 'series-1', starts_at: toInstant(today, '19:00'), start_time: '19:00:00' }),
    ])),
    table('coach_sessions', []),
    table('squad_players', []),
    rpc('feature_on', () => true),
  )
})

describe('TRAK-182: Schedule opens what the event sheet asked for', () => {
  it('opens the edit sheet for ?edit=<id>', async () => {
    renderApp('/coach/schedule?edit=one-1')
    const sheet = await screen.findByRole('dialog', { name: 'Edit event' })
    // An edit opens on its first step, filled in (TRAK-182, live run 3).
    expect(within(sheet).getByLabelText('Title', { exact: true })).toHaveValue('Finishing')
  })

  it('asks this week or the following for a series\' ?publish=<id>', async () => {
    renderApp('/coach/schedule?publish=wk-1')
    expect(await screen.findByRole('dialog', { name: 'Publish event' })).toBeInTheDocument()
  })

  it('opens the cancel sheet for ?cancel=<id>', async () => {
    renderApp('/coach/schedule?cancel=one-1')
    expect(await screen.findByRole('dialog', { name: 'Cancel event' })).toBeInTheDocument()
  })

  it('opens nothing for an id that is not on the schedule', async () => {
    renderApp('/coach/schedule?edit=gone')
    await screen.findByText('Finishing')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
