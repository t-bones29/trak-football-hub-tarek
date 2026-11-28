import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expectSquadPicked, pickSquad, squadsOffered } from '../../../../tests/support/squad-switcher'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { forgetScreens } from '@/lib/screen-memory'
import { pickTime } from '../../../../tests/support/arc-pickers'
import { saveLog, trainingAt } from '../../../../tests/support/log-steps'
import { TakeRegister } from '@/components/coach/TakeRegister'
import { EventSheetCoach } from '@/components/coach/EventSheetCoach'
import type { StripEvent } from '@/components/trak/WeekStrip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { localTodayISO, toInstant } from '@/lib/event-time'
import { listOptions } from '@/test/arc-select'

// TRAK-426: the event sheet asks whether the old log has retired; rendered on its own here, without the signed-in frame.
vi.mock('@/components/coach/old-log', () => ({ useOldLogRetired: () => ({ retired: false, known: true }) }))

/**
 * TRAK-176 (Imad, 14 Oct): the pilot coach runs U14 and U16 with one login.
 * With two squads the coach picks one in the Home header, the way a parent
 * picks a child; Squad shows that squad only, and a new event is saved for it
 * (part 1 makes the database send it to that squad's families only). A coach
 * with one squad sees their name, as before.
 */
const COACH = { id: 'coach-176' }
const TWO = [
  { id: 'sp-1', coach_user_id: COACH.id, player_name: 'Ade Okafor', position: 'Midfielder', age_group: 'U14', status: 'active', created_at: '2026-09-01T00:00:00Z' },
  { id: 'sp-2', coach_user_id: COACH.id, player_name: 'Bo Lind', position: 'Defender', age_group: 'U16', status: 'active', created_at: '2026-09-01T00:00:00Z' },
]
const EVENTS = `${SUPABASE_URL}/rest/v1/coach_calendar_events`
let inserted: Record<string, unknown>[]
let sessionsInserted: Record<string, unknown>[]

function coachReads(players: typeof TWO) {
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    // TRAK-361: under All, Home's card reads each squad's plan.
    table('season_plans', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Angelos Basinas', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, team: 'U16s', coach_role: 'Head Coach' }]),
    table('coach_assessments', []),
    table('session_attendance', []),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    // TRAK-426: Training off, so the old log (Sessions, Full session) is still there for these checks.
    rpc('feature_on', ({ p_feature }) => p_feature !== 'training'),
    // TRAK-286: no game plan, shared or not.
    table('game_plans', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, () => HttpResponse.json([], { headers: { 'Content-Range': '*/0' } })),
    http.get(`${SUPABASE_URL}/rest/v1/squad_players`, () => HttpResponse.json(players)),
    http.get(EVENTS, () => HttpResponse.json([])),
    http.post(`${SUPABASE_URL}/rest/v1/coach_sessions`, async ({ request }) => {
      const raw = await request.json() as Record<string, unknown>
      sessionsInserted.push(raw)
      return HttpResponse.json({ id: 'session-176', ...raw }, { status: 201 })
    }),
    http.post(`${SUPABASE_URL}/rest/v1/session_attendance`, () => new HttpResponse(null, { status: 201 })),
    http.post(EVENTS, async ({ request }) => {
      inserted.push(...await request.json() as Record<string, unknown>[])
      return HttpResponse.json([{ id: 'new-1' }], { status: 201 })
    }),
  )
}

beforeEach(() => { inserted = []; sessionsInserted = []; signInAs(COACH) })
afterEach(() => { cleanup(); forgetScreens(); localStorage.clear() })

describe('TRAK-176: one coach, two squads', { timeout: 20_000 }, () => {
  it('Home offers the squads, and remembers the one picked', async () => {
    coachReads(TWO)
    renderApp('/coach/home')
    // TRAK-266: pills, All first and picked; a squad tapped is remembered for what's made next.
    // TRAK-305, TRAK-324: one switcher in the frame; the pick, All included, is what every page shows.
    expect(await squadsOffered()).toEqual(['All squads', 'U14', 'U16'])
    await expectSquadPicked('All')
    await pickSquad('U16')
    // Remembered on this device, which is what the Squad page reads (TRAK-250 tests it there).
    await waitFor(() => expect(localStorage.getItem(`trak:coach-squad:${COACH.id}`)).toBe('U16'))
    expect(localStorage.getItem(`trak:coach-squad-all:${COACH.id}`)).toBe('0')
  })

  it('a coach with one squad sees their name and no squad picker', async () => {
    // Another coach: the app's query cache outlives a test, and would hold the first one's squads.
    signInAs({ id: 'coach-176-one' })
    coachReads(TWO.map(p => ({ ...p, coach_user_id: 'coach-176-one', age_group: 'U14' })))
    // TRAK-211: Home lists no players now. The Feedback page's list shows the squads have answered
    // (TRAK-259: it left the nav, so it opens by its address).
    renderApp('/coach/feedback')
    expect(await screen.findByText('Ade Okafor', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Squad: / })).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: 'Home' }))
    // TRAK-616: Home's heading is the greeting, with the first name.
    expect(await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Angelos$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Squad: / })).toBeNull()
  })

  it('a new event from quick add is saved for the squad picked', async () => {
    coachReads(TWO)
    localStorage.setItem(`trak:coach-squad:${COACH.id}`, 'U16')
    renderApp('/coach/schedule')
    await userEvent.click(await screen.findByRole('button', { name: 'Quick add' }))
    const menu = await screen.findByRole('menu', { name: 'Quick add' })
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'New event' }))
    const form = await screen.findByRole('dialog', { name: 'New event' })
    await pickTime(userEvent, 'Start', '17:30')
    await userEvent.type(within(form).getByLabelText('Title'), 'Training')
    await userEvent.click(within(form).getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(inserted).toHaveLength(1))
    expect(inserted[0]).toMatchObject({ coach_user_id: COACH.id, squad: 'U16', published: false })
  })

  it('a logged training lists the squad picked and is saved for it', async () => {
    signInAs({ id: 'coach-176-log' })
    coachReads(TWO.map(p => ({ ...p, coach_user_id: 'coach-176-log' })))
    localStorage.setItem('trak:coach-squad:coach-176-log', 'U16')
    renderApp('/coach/sessions/add')
    await trainingAt('Attendance')
    expect(await screen.findByRole('button', { name: /Bo Lind/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ade Okafor/ })).toBeNull()
    await saveLog('Save session')
    await waitFor(() => expect(sessionsInserted).toHaveLength(1))
    expect(sessionsInserted[0]).toMatchObject({ coach_user_id: 'coach-176-log', squad: 'U16' })
  })

  it("a failed squads read is a failed roster with a retry, never the whole roster", async () => {
    signInAs({ id: 'coach-176-fail' })
    coachReads(TWO.map(p => ({ ...p, coach_user_id: 'coach-176-fail' })))
    let squadsFail = true
    server.use(http.get(`${SUPABASE_URL}/rest/v1/squad_players`, ({ request }) =>
      squadsFail && new URL(request.url).searchParams.get('select') === 'age_group,status'
        ? HttpResponse.json({ message: 'unavailable' }, { status: 500 })
        : HttpResponse.json(TWO.map(p => ({ ...p, coach_user_id: 'coach-176-fail' })))))
    renderApp('/coach/sessions/add')
    await trainingAt('Attendance')
    expect(await screen.findByText(/Couldn't load your squad/, undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ade Okafor/ })).toBeNull()
    squadsFail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: /Ade Okafor/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bo Lind/ })).toBeNull()
  })

  it("an event's register lists that squad only", async () => {
    coachReads(TWO)
    render(<TakeRegister eventId="ev-u14" coachId={COACH.id} sessionId={null} squad="U14" onSaved={() => {}} />)
    expect(await screen.findByText('Ade Okafor')).toBeInTheDocument()
    expect(screen.queryByText('Bo Lind')).toBeNull()
  })

  it("an event's Attending lists that squad only", async () => {
    coachReads(TWO)
    server.use(http.get(EVENTS, () => HttpResponse.json({
      id: 'ev-u14', coach_user_id: COACH.id, title: 'U14 training', event_type: 'training', event_date: '2026-10-20',
      start_time: '18:00', published: true, status: 'scheduled', squad: 'U14',
    })))
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>
      <EventSheetCoach event={{ id: 'ev-u14' } as StripEvent} coachId={COACH.id} onChanged={() => {}} />
    </MemoryRouter></QueryClientProvider>)
    await userEvent.click(await screen.findByRole('button', { name: 'Show names: Attending' }))
    expect(within(screen.getByRole('list', { name: 'Attending' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['Ade Okafor'])
  })

  it('Sessions lists the squad picked and whole-roster sessions', async () => {
    coachReads(TWO)
    server.use(http.get(`${SUPABASE_URL}/rest/v1/coach_sessions`, () => HttpResponse.json([
      { id: 's1', coach_user_id: COACH.id, title: 'U14 session', session_type: 'training', session_date: '2026-10-10', squad: 'U14' },
      { id: 's2', coach_user_id: COACH.id, title: 'U16 session', session_type: 'training', session_date: '2026-10-11', squad: 'U16' },
      { id: 's3', coach_user_id: COACH.id, title: 'Whole roster session', session_type: 'training', session_date: '2026-10-12', squad: null },
    ])))
    localStorage.setItem(`trak:coach-squad:${COACH.id}`, 'U16')
    localStorage.setItem(`trak:coach-squad-all:${COACH.id}`, '0')
    renderApp('/coach/sessions/list')
    expect(await screen.findByText('U16 session')).toBeInTheDocument()
    expect(screen.getByText('Whole roster session')).toBeInTheDocument()
    expect(screen.queryByText('U14 session')).toBeNull()
  })

  it('Assess offers the squad picked', async () => {
    coachReads(TWO)
    localStorage.setItem(`trak:coach-squad:${COACH.id}`, 'U16')
    localStorage.setItem(`trak:coach-squad-all:${COACH.id}`, '0')
    renderApp('/coach/assess')
    await screen.findByRole('combobox', { name: 'Player' })
    await waitFor(async () => expect(await listOptions('Player')).toEqual(['Bo Lind']))
  })

  it('Schedule opens on All, naming each squad; a squad tapped lists its events and whole-roster ones (Imad, 24 Oct)', async () => {
    // Another coach: the app's query cache outlives a test, and holds the pick an earlier test made.
    const coach = 'coach-176-schedule'
    signInAs({ id: coach })
    coachReads(TWO.map(p => ({ ...p, coach_user_id: coach })))
    const event = (id: string, title: string, squad: string | null) => ({
      id, coach_user_id: coach, title, event_type: 'training', event_date: localTodayISO(), start_time: '18:00:00',
      starts_at: toInstant(localTodayISO(), '18:00'), ends_at: null, published: true, status: 'scheduled', series_id: null, squad,
    })
    server.use(http.get(EVENTS, () => HttpResponse.json([event('e1', 'U14 training', 'U14'), event('e2', 'U16 training', 'U16'), event('e3', 'Whole roster training', null)])))
    localStorage.setItem(`trak:coach-squad:${coach}`, 'U16')
    renderApp('/coach/schedule')
    expect(await screen.findByText('U14 training', { selector: 'p' })).toBeInTheDocument()
    await expectSquadPicked('All')
    expect(screen.getByText(/· U14/)).toBeInTheDocument()
    expect(screen.getByText(/· All squads/)).toBeInTheDocument()
    await pickSquad('U16')
    expect(await screen.findByText('U16 training', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Whole roster training', { selector: 'p' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('U14 training', { selector: 'p' })).toBeNull())
  })
})
