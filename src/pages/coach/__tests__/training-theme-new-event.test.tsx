import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { localTodayISO, toInstant } from '@/lib/event-time'
import { pickTime } from '../../../../tests/support/arc-pickers'
import { eventStep, saveEventWith } from '../../../../tests/support/event-steps'
import { atMorningToday } from '../../../../tests/support/clock'
import { openNewEvent } from '../../../../tests/support/schedule-actions'

/**
 * [scope] Training theme on New event: setting up a training, the coach picks
 * its themes from the catalogue's seven libraries (TRAK-635: any number, tick
 * boxes) and can open the Coaching Session Catalogue on a theme to find sessions.
 */

const COACH = { id: 'coach-theme' }
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
const today = localTodayISO()
const SAVED = {
  id: 'ev-1', coach_user_id: COACH.id, title: 'Training', event_type: 'training', starts_at: toInstant(today, '23:00'),
  ends_at: null, event_date: today, start_time: '23:00:00', end_time: null, venue: null, opponent: null,
  notes: null, published: false, source: 'manual', meet_time: null, kit: null, home_away: null, status: 'scheduled',
  cancel_reason: null, series_id: null, training_themes: ['goalkeeping'],
}

let posts: unknown[]
let patches: unknown[]
// TRAK-419: whether the academy's Training switch is on (every other feature is on).
let trainingOn: boolean
beforeEach(() => {
  trainingOn = false
  // TRAK-253: the saved event is today 23:00, which has started (and is locked, TRAK-230)
  // once a CI runner passes 19:00 UTC. The Schedule suites run at 09:00 today.
  atMorningToday()
  signInAs(COACH)
  posts = []
  patches = []
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json([SAVED])),
    http.post(EVENTS, async ({ request }) => { posts.push(await request.json()); return HttpResponse.json([{ id: 'new-1' }], { status: 201 }) }),
    http.patch(EVENTS, async ({ request }) => { patches.push(await request.json()); return HttpResponse.json([{ id: 'ev-1' }]) }),
    table('coach_sessions', []),
    table('squad_players', []),
    table('session_attendance', []),
    table('event_absences', []),
    rpc('feature_on', ({ p_feature }) => p_feature !== 'training' || trainingOn),
    rpc('coach_squad_player_consent_required', () => false),
  )
})
afterEach(() => { server.events.removeAllListeners(); vi.useRealTimers() })

async function newEvent() {
  renderApp('/coach/schedule')
  await openNewEvent()
  return screen.getByRole('dialog', { name: 'New event' })
}

describe('Training theme on New event', { timeout: 30_000 }, () => {
  // TRAK-635 (Kostas, 28 Nov): any number of the seven, and a picked one unpicks on a second tap.
  it('a training offers the seven themes as tick boxes, none picked', async () => {
    const sheet = await newEvent()
    const group = within(sheet).getByRole('group', { name: 'Theme (Optional)' })
    expect(within(group).getAllByRole('checkbox')).toHaveLength(7)
    for (const name of ['Technical', 'Attacking', 'Defending', 'Transition', 'Goalkeeping', 'Physical & movement', 'Psychological & social']) {
      expect(within(group).getByRole('checkbox', { name: new RegExp(`^${name}`) })).not.toBeChecked()
    }
    expect(within(group).getByText('82 sessions · 4 topics')).toBeInTheDocument()
  })

  it('TRAK-635: several can be picked, and a second tap unpicks one', async () => {
    const sheet = await newEvent()
    const group = within(sheet).getByRole('group', { name: 'Theme (Optional)' })
    const box = (name: string) => within(group).getByRole('checkbox', { name: new RegExp(`^${name}`) })
    await userEvent.click(box('Attacking'))
    await userEvent.click(box('Transition'))
    await userEvent.click(box('Goalkeeping'))
    expect(box('Attacking')).toBeChecked()
    expect(box('Transition')).toBeChecked()
    expect(box('Goalkeeping')).toBeChecked()
    await userEvent.click(box('Goalkeeping'))
    expect(box('Goalkeeping')).not.toBeChecked()
    expect(box('Attacking')).toBeChecked()
  })

  it('links to the catalogue, on the picked theme when there is exactly one', async () => {
    const sheet = await newEvent()
    const link = () => within(sheet).getByRole('link', { name: /Trainings Catalogue/ })
    expect(link()).toHaveAttribute('href', '/coach/trainings')
    expect(link()).toHaveAttribute('target', '_blank')
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Defending/ }))
    expect(link()).toHaveAttribute('href', '/coach/trainings/defending')
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Technical/ }))
    expect(link()).toHaveAttribute('href', '/coach/trainings')
  })

  // TRAK-419 (11 Nov review): where Training is on, Drills is the one library. The link opens Training › Drills, on the
  // theme's drills where Drills can show them, and the old catalogue's counts go (they are not Drills' counts).
  it('with Training on, links to Training › Drills, on the picked theme, without the catalogue counts', async () => {
    trainingOn = true
    // A coach of their own, so the app's cache never carries the earlier tests' "off" into this one.
    signInAs({ id: 'coach-theme-training' })
    server.use(table('profiles', [{ id: 'p', user_id: 'coach-theme-training', role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]))
    const sheet = await newEvent()
    const group = within(sheet).getByRole('group', { name: 'Theme (Optional)' })
    // The switch answers after the sheet opens.
    expect(await within(sheet).findByRole('link', { name: /Training › Drills/ })).toHaveTextContent('Browse all drills in Training › Drills')
    const link = () => within(sheet).getByRole('link', { name: /Training › Drills/ })
    const box = (name: string) => within(group).getByRole('checkbox', { name: new RegExp(`^${name}`) })
    expect(within(group).queryByText('82 sessions · 4 topics')).toBeNull()
    expect(within(sheet).queryByRole('link', { name: /Catalogue/ })).toBeNull()
    expect(link()).toHaveAttribute('href', '/coach/training/drills')
    expect(link()).toHaveAttribute('target', '_blank')
    await userEvent.click(box('Goalkeeping'))
    expect(link()).toHaveTextContent('Find Goalkeeping drills in Training › Drills')
    expect(link()).toHaveAttribute('href', '/coach/training/drills/all?show=Goalkeeping')
    // Two picked: all the drills.
    await userEvent.click(box('Defending'))
    expect(link()).toHaveTextContent('Browse all drills in Training › Drills')
    expect(link()).toHaveAttribute('href', '/coach/training/drills')
    await userEvent.click(box('Goalkeeping'))
    expect(link()).toHaveAttribute('href', '/coach/training/drills/all?q=defend')
    await userEvent.click(box('Defending'))
    await userEvent.click(box('Psychological'))
    expect(link()).toHaveAttribute('href', '/coach/training/drills')
  })

  it('a match or other event has no theme', async () => {
    const sheet = await newEvent()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    expect(within(sheet).queryByRole('group', { name: 'Theme (Optional)' })).toBeNull()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Other' }))
    expect(within(sheet).queryByRole('group', { name: 'Theme (Optional)' })).toBeNull()
  })

  it('saves every picked theme and lists them on Review', async () => {
    const sheet = await newEvent()
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Transition/ }))
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /^Attacking/ }))
    await eventStep(sheet, 'When')
    await pickTime(userEvent, 'Start', '23:00')
    await eventStep(sheet, 'Review')
    expect(within(sheet).getByText('Themes').nextElementSibling).toHaveTextContent('Attacking, Transition')
    await saveEventWith(sheet, 'Save draft')
    expect(posts).toHaveLength(1)
    expect(posts[0]).toEqual([expect.objectContaining({ event_type: 'training', training_themes: ['attacking', 'transition'] })])
  })

  it('an edit opens with the saved theme picked', async () => {
    renderApp('/coach/schedule?edit=ev-1')
    const sheet = await screen.findByRole('dialog', { name: 'Edit event' })
    expect(within(sheet).getByRole('checkbox', { name: /^Goalkeeping/ })).toBeChecked()
    expect(within(sheet).getByRole('checkbox', { name: /^Technical/ })).not.toBeChecked()
  })
})

// TRAK-635 (Kostas, 28 Nov): a training is named by the coach; a match keeps its optional title.
describe('TRAK-635: a training needs a title', { timeout: 30_000 }, () => {
  it('Next is refused until the training has a title', async () => {
    const sheet = await newEvent()
    const title = within(sheet).getByLabelText('Title', { exact: true })
    expect(title).toHaveValue('')
    expect(title).toHaveAttribute('placeholder', 'e.g. Finishing in the box')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Next' }))
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Give the training a title')
    expect(sheet.querySelector('[aria-current="step"]')?.textContent).toContain('What')
    await userEvent.type(title, 'Finishing in the box')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Next' }))
    expect(sheet.querySelector('[aria-current="step"]')?.textContent).toContain('When')
  })

  it('a match keeps "Title (Optional)"', async () => {
    const sheet = await newEvent()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    expect(within(sheet).getByLabelText('Title (Optional)')).toBeInTheDocument()
    expect(within(sheet).queryByLabelText('Title', { exact: true })).toBeNull()
  })
})
