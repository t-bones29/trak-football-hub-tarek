import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { localTodayISO, toAcademyInstant, toInstant } from '@/lib/event-time'

/**
 * TRAK-127 (J8.4). With events switched on, the coach creates a training,
 * match or other event as a draft, publishes it, edits it (live once
 * published), and cancels it: it stays on the schedule as Cancelled. Only a
 * draft nobody has seen can be deleted. A failed save keeps what was typed.
 * The AI "Read Schedule" import is gone (G7). Driven through the rendered app
 * and the real SDK.
 */

const COACH = { id: 'coach-1' }
const today = localTodayISO()
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`

const row = (over: Record<string, unknown>) => ({
  coach_user_id: COACH.id, event_type: 'training', starts_at: toInstant(today, '17:00'),
  ends_at: null, event_date: today, start_time: '17:00:00', venue: 'Academy Pitch 2', opponent: null,
  notes: null, published: false, source: 'manual', meet_time: null, kit: null, home_away: null,
  status: 'scheduled', cancel_reason: null, ...over,
})
const DRAFT = row({ id: 'draft-1', title: 'Finishing' })
const LIVE = row({
  id: 'live-1', title: 'vs Synthetic Rovers', event_type: 'match', opponent: 'Synthetic Rovers',
  starts_at: toInstant(today, '18:30'), start_time: '18:30:00', venue: 'Rovers Park', published: true,
})

type Write = { method: string; query: string; body: unknown }
let writes: Write[]
let requests: string[]
let rows: Record<string, unknown>[]
let failWrites: false | 'error' | 'no-row'
let emailNudges: number

function fixtures() {
  writes = []
  requests = []
  failWrites = false
  emailNudges = 0
  rows = [DRAFT, LIVE]
  server.events.on('request:start', ({ request }) => { requests.push(new URL(request.url).pathname) })
  const write = (method: string) => async ({ request }: { request: Request }) => {
    const body = method === 'delete' ? null : await request.json()
    writes.push({ method, query: decodeURIComponent(new URL(request.url).search), body })
    if (failWrites === 'error') return HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })
    if (failWrites === 'no-row') return HttpResponse.json([])
    return HttpResponse.json([{ id: 'written' }], { status: method === 'post' ? 201 : 200 })
  }
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Coach', invite_code: 'ABCD' }]),
    http.get(EVENTS, () => HttpResponse.json(rows)),
    table('coach_sessions', []),
    table('squad_players', []), // TRAK-139: the squad label for the WhatsApp message
    rpc('feature_on', () => true),
    http.post(EVENTS, write('post')),
    http.patch(EVENTS, write('patch')),
    http.delete(EVENTS, write('delete')),
    // TRAK-135: the app asks the server to send queued family emails.
    http.post(`${SUPABASE_URL}/functions/v1/send-event-emails`, () => {
      emailNudges++
      return HttpResponse.json({ accepted: true }, { status: 202 })
    }),
  )
}

const card = (title: string) => screen.getByText(title).closest('div.rounded-\\[14px\\]') as HTMLElement
async function open() {
  renderApp('/coach/schedule')
  await screen.findByText('Finishing')
  // The switch is on: the "Coming soon" pill goes away.
  await waitFor(() => expect(screen.queryByRole('note', { name: 'This screen is coming soon' })).toBeNull())
}

describe('J8.4: the coach creates, edits and cancels events', () => {
  afterEach(() => { server.events.removeAllListeners() })
  beforeEach(() => {
    signInAs(COACH)
    fixtures()
  })

  it('creates a match with every field as a draft only the coach sees', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    await userEvent.type(within(sheet).getByLabelText('Opponent'), 'Synthetic United')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Away' }))
    await userEvent.type(within(sheet).getByLabelText('Kickoff'), '16:00')
    await userEvent.click(within(sheet).getByRole('button', { name: '75 min' }))
    await userEvent.type(within(sheet).getByLabelText('Venue'), 'United Ground')
    await userEvent.type(within(sheet).getByLabelText('Meet time (if earlier)'), '15:15')
    await userEvent.type(within(sheet).getByLabelText('Kit'), 'Red shirts')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].method).toBe('post')
    // One event is a one-row insert; a weekly series (J8.5) is the same insert with more rows.
    expect(writes[0].body).toHaveLength(1)
    const [inserted] = writes[0].body as Record<string, unknown>[]
    expect(inserted).toMatchObject({
      coach_user_id: COACH.id, title: 'vs Synthetic United', event_type: 'match',
      starts_at: toAcademyInstant(today, '16:00'),
      ends_at: new Date(new Date(toAcademyInstant(today, '16:00')!).getTime() + 75 * 60_000).toISOString(),
      event_date: today, start_time: '16:00:00', end_time: '17:15:00',
      venue: 'United Ground', meet_time: '15:15:00', opponent: 'Synthetic United',
      home_away: 'away', kit: 'Red shirts', published: false, source: 'manual',
    })
    // The app never writes the status or the sequence number.
    expect(inserted).not.toHaveProperty('status')
    expect(inserted).not.toHaveProperty('sequence')
    expect(inserted).not.toHaveProperty('series_id')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // A draft has no families yet: no email (TRAK-135).
    expect(emailNudges).toBe(0)
  })

  // TRAK-161 (J8.8): training kit matters too, and families get a short note
  // under it. Dora had typed "Shin guards are optional" into Kit.
  it('gives a training Kit and a note for families', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.type(within(sheet).getByLabelText('Start'), '17:00')
    await userEvent.type(within(sheet).getByLabelText('Kit'), 'Green kits')
    const note = within(sheet).getByLabelText('Note for families')
    expect(note).toHaveAttribute('maxlength', '200')
    expect(within(sheet).getByText(/players and parents see this/i)).toBeInTheDocument()
    await userEvent.type(note, 'Bring extra water, it is a hot day')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save draft' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    const [inserted] = writes[0].body as Record<string, unknown>[]
    expect(inserted).toMatchObject({ event_type: 'training', kit: 'Green kits', family_note: 'Bring extra water, it is a hot day' })
    // The coach-only notes column is never written from here.
    expect(inserted).not.toHaveProperty('notes')
  })

  // TRAK-161 follow-up (Kostas, #293): told as they type, not after families miss it.
  it('warns as the coach types a note families won\'t see', async () => {
    server.use(table('squad_players', [{ age_group: 'U15', player_name: 'Omar Haddad', status: 'active' }]))
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    const note = within(sheet).getByLabelText('Note for families')
    await userEvent.type(note, 'Bring water')
    expect(within(sheet).queryByText(/families won't see this note/i)).toBeNull()
    await userEvent.type(note, ', Omar brings the bibs')
    expect(await within(sheet).findByText("Families won't see this note: it names a player.")).toBeInTheDocument()
    await userEvent.clear(note)
    await userEvent.type(note, 'Directions: maps.app.goo.gl/abc')
    expect(within(sheet).getByText("Families won't see this note: it has a link.")).toBeInTheDocument()
    expect(note).toHaveAccessibleDescription(/it has a link/)
  })

  it('picks a venue the coach has used before', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const options = [...document.querySelectorAll('#saved-venues option')].map(o => (o as HTMLOptionElement).value)
    // Most recent first: the 18:30 match, then the 17:00 training.
    expect(options).toEqual(['Rovers Park', 'Academy Pitch 2'])
  })

  it('says what is missing and sends nothing', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
    const sheet = screen.getByRole('dialog', { name: 'New event' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Match' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save draft' }))
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Add the opponent')

    await userEvent.type(within(sheet).getByLabelText('Opponent'), 'Synthetic United')
    await userEvent.type(within(sheet).getByLabelText('Kickoff'), '16:00')
    await userEvent.type(within(sheet).getByLabelText('Meet time (if earlier)'), '16:30')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save draft' }))
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Meet time must be before the start')
    expect(writes).toEqual([])
  })

  it.each([
    { mode: 'error', why: 'the request fails' },
    { mode: 'no-row', why: 'the database refuses the row' },
  ] as const)(
    'keeps what was typed and says what failed when $mode ($why)', async ({ mode }) => {
      await open()
      failWrites = mode
      await userEvent.click(screen.getByRole('button', { name: 'Add event' }))
      const sheet = screen.getByRole('dialog', { name: 'New event' })
      await userEvent.type(within(sheet).getByLabelText('Start'), '17:00')
      await userEvent.type(within(sheet).getByLabelText('Venue'), 'Academy Pitch 1')
      await userEvent.click(within(sheet).getByRole('button', { name: 'Save draft' }))

      expect(await within(sheet).findByRole('alert')).toHaveTextContent("Couldn't save the event")
      expect(screen.getByRole('dialog', { name: 'New event' })).toBeInTheDocument()
      expect(within(sheet).getByLabelText('Venue')).toHaveValue('Academy Pitch 1')
      expect(within(sheet).getByLabelText('Start')).toHaveValue('17:00')
    })

  it('publishes a draft', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Publish Finishing' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'patch', query: '?id=eq.draft-1&select=id', body: { published: true } })
    // Publishing isn't a change families need emailing about (TRAK-135).
    expect(emailNudges).toBe(0)
  })

  it('edits a published event live, without touching published', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Edit vs Synthetic Rovers' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit event' })
    // The saved event fills the form.
    expect(within(sheet).getByLabelText('Opponent')).toHaveValue('Synthetic Rovers')
    expect(within(sheet).getByLabelText('Kickoff')).toHaveValue('18:30')
    expect(within(sheet).getByText('Families see the change as soon as you save.')).toBeInTheDocument()
    const venue = within(sheet).getByLabelText('Venue')
    await userEvent.clear(venue)
    await userEvent.type(venue, 'Rovers Park Pitch 3')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'patch', query: '?id=eq.live-1&select=id' })
    expect(writes[0].body).toMatchObject({ venue: 'Rovers Park Pitch 3', title: 'vs Synthetic Rovers', opponent: 'Synthetic Rovers' })
    expect(writes[0].body).not.toHaveProperty('published')
    // TRAK-135: the server is asked to send whatever email the change queued.
    await waitFor(() => expect(emailNudges).toBe(1))
  })

  it('cancels a published event: it stays, marked Cancelled, and nothing is deleted', async () => {
    await open()
    // A published event has no Delete: families have seen it.
    expect(screen.queryByRole('button', { name: 'Delete vs Synthetic Rovers' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel vs Synthetic Rovers' }))
    const sheet = screen.getByRole('dialog', { name: 'Cancel event' })
    await userEvent.type(within(sheet).getByLabelText('Reason (optional)'), 'Pitch waterlogged')
    rows = [DRAFT, { ...LIVE, status: 'cancelled', cancel_reason: 'Pitch waterlogged' }]
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel event' }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({
      method: 'patch', query: '?id=eq.live-1&select=id', body: { status: 'cancelled', cancel_reason: 'Pitch waterlogged' },
    })
    expect(await within(card('vs Synthetic Rovers')).findByText('Cancelled')).toBeInTheDocument()
    expect(within(card('vs Synthetic Rovers')).getByText('Pitch waterlogged')).toBeInTheDocument()
    // A cancelled event can't be edited, published or cancelled again.
    expect(within(card('vs Synthetic Rovers')).queryAllByRole('button')).toEqual([])
    expect(writes.some(w => w.method === 'delete')).toBe(false)
    // TRAK-135: and the families' cancellation email is sent.
    expect(emailNudges).toBe(1)
  })

  it('deletes only a draft nobody has seen', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Finishing' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toMatchObject({ method: 'delete', query: '?id=eq.draft-1&select=id' })
    expect(emailNudges).toBe(0)
  })

  it('offers no AI import and never calls parse-schedule (G7)', async () => {
    await open()
    expect(screen.queryByRole('button', { name: /Read Schedule/i })).toBeNull()
    expect(screen.queryByText(/Import from text/i)).toBeNull()
    expect(requests.some(p => p.includes('parse-schedule'))).toBe(false)
  })

  it('reads past sessions with real coach_sessions columns only', async () => {
    // coach_sessions has no opponent column. Asking for one failed every load
    // with 42703, so the live screen said "Couldn't connect" (found 9 Oct).
    const types = readFileSync(`${process.cwd()}/src/integrations/supabase/types.ts`, 'utf8')
    const block = types.match(/\n {6}coach_sessions: \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/)![1]
    const real = new Set([...block.matchAll(/^\s+(\w+):/gm)].map(m => m[1]))
    let asked: string[] = []
    server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, ({ request }) => {
      asked = (new URL(request.url).searchParams.get('select') ?? '').split(',')
      const unknown = asked.filter(c => !real.has(c))
      if (unknown.length) {
        return HttpResponse.json({ code: '42703', message: `column coach_sessions.${unknown[0]} does not exist` }, { status: 400 })
      }
      return HttpResponse.json([{
        id: 's-1', coach_user_id: COACH.id, title: 'Recovery session', session_type: 'training',
        session_date: today, competition: null, venue: 'Gym', notes: null,
      }])
    }))
    await open()
    expect(await screen.findByText('Recovery session')).toBeInTheDocument()
    expect(screen.queryByText(/We couldn't load your calendar/)).toBeNull()
    expect(asked.length).toBeGreaterThan(0)
  })

  it('says the calendar failed to load instead of showing it empty', async () => {
    server.use(http.get(EVENTS, () => HttpResponse.json({ message: 'Synthetic failure' }, { status: 500 })))
    renderApp('/coach/schedule')
    expect(await screen.findByText(/We couldn't load your calendar/)).toBeInTheDocument()
  })
})
