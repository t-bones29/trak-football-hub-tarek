/**
 * TRAK-358 (Season plan 10/18, spec TRAK-348): the match line-up on Formations' pitch, with Bench and Not selected as
 * tabs beside it. Players are placed by drag and by tap, and move between the pitch, Bench and Not selected. Every
 * face's markers follow the job (a note, when not selected), the context and the expectation, in words too. Out of
 * position ticks and unticks itself, but a tick the coach set himself stays. At kick-off the pitch and the tabs only
 * show. jsdom can't hit-test, so a drag here names its target (elementFromPoint); the real pointer drag is in
 * e2e/lineup-pitch.spec.ts. Synthetic people.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'

const phoneTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'Asia/Dubai' })
afterAll(() => { process.env.TZ = phoneTZ })

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
let n = 0
let COACH = { id: 'coach-358' }
let also: { squad_player_id: string; position: string }[] = []

/** A match `ms` from now (negative: it has kicked off), on the academy's clock (Dubai, UTC+4). */
function game(ms = 5 * DAY) {
  const kickOff = Math.ceil((Date.now() + ms) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Synthetic Rovers', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 19)}`, end_time: null, meet_time: null,
    opponent: 'Synthetic Rovers', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number, position: string) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position, created_at: '2026-10-01T08:00:00Z' })
const row = (id: string, over: Record<string, unknown>) =>
  ({ event_id: 'g1', squad_player_id: id, role: 'bench', slot: null, job: '', note: '', context: [], expectation: 'usual', ...over })
const PLAN = { event_id: 'g1', strength: 'similar', their_formation: null, key_players: [], scouting: '', format: 11, formation: '4-4-2',
  goals: [], created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z' }

/** The plan and its line-up as the database keeps them, written by the app's upserts. */
function store({ lineUp = [] as ReturnType<typeof row>[], kickOffIn = 5 * DAY } = {}) {
  const saved = new Map<string, Record<string, unknown>>(lineUp.map(line => [line.squad_player_id, line]))
  const saves: Record<string, unknown>[][] = []
  server.use(
    table('coach_calendar_events', [game(kickOffIn)]),
    table('game_plans', lineUp.length ? [PLAN] : []),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, () => {
      if (kickOffIn < 0) throw new Error('a locked plan was written')
      return new HttpResponse(null, { status: 201 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/game_plan_players`, () => HttpResponse.json([...saved.values()])),
    http.post(`${SUPABASE_URL}/rest/v1/game_plan_players`, async ({ request }) => {
      const rows = await request.json() as Record<string, unknown>[]
      saves.push(rows)
      for (const line of rows) saved.set(line.squad_player_id as string, line)
      return new HttpResponse(null, { status: 201 })
    }),
  )
  return { saves }
}

// jsdom has no PointerEvent, so fireEvent would drop clientX, button and isPrimary.
class TestPointerEvent extends MouseEvent {
  pointerId: number; pointerType: string; isPrimary: boolean
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; this.isPrimary = init.isPrimary ?? true
  }
}

beforeEach(() => {
  COACH = { id: `coach-358-${++n}` }
  also = []
  signInAs(COACH)
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Synthetic Coach', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      child('p-gk', 'Synthetic Goalkeeper 01', 1, 'Goalkeeper'), child('p-def', 'Synthetic Defender 02', 2, 'Defender'),
      child('p-mid', 'Synthetic Midfielder 03', 3, 'Midfielder'), child('p-att', 'Synthetic Attacker 04', 4, 'Attacker'),
      child('p-mid2', 'Synthetic Midfielder 05', 5, 'Midfielder'),
    ]),
    table('event_confirmations', ['p-gk', 'p-def', 'p-mid', 'p-att', 'p-mid2'].map(squad_player_id => ({ squad_player_id }))),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    http.get(`${SUPABASE_URL}/rest/v1/squad_player_also_plays`, () => HttpResponse.json(also)),
    table('squad_player_roles', []),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    rpc('feature_on', () => true),
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

async function openLineUp(user: ReturnType<typeof userEvent.setup>) {
  renderApp('/coach/matches/g1?tab=plan')
  await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
  await screen.findByRole('group', { name: '4-4-2, starting players. Attacking upwards.' })
}
const slot = (number: number) => screen.getByRole('button', { name: new RegExp(`slot ${number}(,|$)`, 'i') })
const bench = () => screen.getByRole('tabpanel', { name: /^Bench/ })
const benchFace = (name: string) => within(bench()).getByRole('button', { name: new RegExp(`^${name}, bench`) })
const tab = (name: 'Bench' | 'Not selected') => screen.getByRole('tab', { name: new RegExp(`^${name} · `) })
const sheet = () => screen.getByRole('complementary')
async function pick(user: ReturnType<typeof userEvent.setup>, slotNumber: number, name: RegExp) {
  await user.click(slot(slotNumber))
  await user.click(screen.getByRole('combobox', { name: 'Who plays here?' }))
  await user.click(await screen.findByRole('option', { name }))
}
/** A pointer drag from one face to a target: press, move past the drag threshold, release over the target. */
function drag(from: HTMLElement, to: HTMLElement) {
  const hit = document.elementFromPoint
  document.elementFromPoint = () => to
  const at = (x: number, y: number) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y })
  fireEvent.pointerDown(from, at(100, 300))
  fireEvent.pointerMove(from, at(130, 340))
  fireEvent.pointerUp(from, at(130, 340))
  document.elementFromPoint = hit
}
/** What a face draws: its ✓, its i and its ring, which must be the ring's colour (jsdom has no styles, so the token). */
const marks = (face: HTMLElement) => {
  const ring = face.getAttribute('data-ring')
  const colour = face.querySelector('[class*="--t-attention"]') ? 'stretch' : face.querySelector('[class*="--t-success"]') ? 'lead' : null
  expect(colour, 'the ring drawn matches the ring said').toBe(ring)
  return { done: !!face.querySelector('[data-mark="done"]'), context: !!face.querySelector('[data-mark="context"]'), ring }
}

describe('TRAK-358: the match line-up on Formations\' pitch', { timeout: 30_000 }, () => {
  it('places players by drag and by tap, and moves them between the pitch, Bench and Not selected', async () => {
    const user = userEvent.setup()
    const { saves } = store()
    await openLineUp(user)
    expect(tab('Bench')).toHaveAccessibleName('Bench · 5')

    // A drag from the bench into goal; beside the pitch, the sheet follows him.
    drag(benchFace('Synthetic Goalkeeper 01'), slot(1))
    expect(slot(1)).toHaveAccessibleName('Synthetic Goalkeeper 01, slot 1')
    expect(within(bench()).queryByRole('button', { name: /^Synthetic Goalkeeper 01/ })).toBeNull()
    expect(tab('Bench')).toHaveAccessibleName('Bench · 4')
    expect(screen.getByRole('complementary', { name: 'Synthetic Goalkeeper 01' })).toBeInTheDocument()

    // A tap on a place, then who plays there.
    await pick(user, 2, /^Synthetic Defender 02/)
    expect(slot(2)).toHaveAccessibleName('Synthetic Defender 02, slot 2')
    // A starter onto an empty place moves there.
    drag(slot(2), slot(3))
    expect(slot(2)).toHaveAccessibleName('Slot 2, empty')
    expect(slot(3)).toHaveAccessibleName('Synthetic Defender 02, slot 3')

    // A bench player onto a starter: the starter goes to the bench. A starter onto a bench face: they swap back.
    drag(benchFace('Synthetic Midfielder 03'), slot(6))
    drag(benchFace('Synthetic Midfielder 05'), slot(6))
    expect(slot(6)).toHaveAccessibleName('Synthetic Midfielder 05, slot 6')
    expect(benchFace('Synthetic Midfielder 03')).toBeInTheDocument()
    drag(slot(6), benchFace('Synthetic Midfielder 03'))
    expect(slot(6)).toHaveAccessibleName('Synthetic Midfielder 03, slot 6')
    expect(benchFace('Synthetic Midfielder 05')).toBeInTheDocument()

    // A starter onto the Not selected tab is left out, and back onto Bench is on the bench.
    drag(slot(3), tab('Not selected'))
    expect(slot(3)).toHaveAccessibleName('Slot 3, empty')
    expect(tab('Not selected')).toHaveAccessibleName('Not selected · 1')
    await user.click(tab('Not selected'))
    const leftOut = screen.getByRole('tabpanel', { name: /^Not selected/ })
    drag(within(leftOut).getByRole('button', { name: 'Synthetic Defender 02, not selected' }), tab('Bench'))
    expect(tab('Not selected')).toHaveAccessibleName('Not selected · 0')
    // A bench player onto the Not selected panel itself.
    await user.click(tab('Bench'))
    drag(benchFace('Synthetic Midfielder 05'), tab('Not selected'))
    expect(tab('Not selected')).toHaveAccessibleName('Not selected · 1')

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    const lines = Object.fromEntries(saves.at(-1)!.map(line => [line.squad_player_id, [line.role, line.slot]]))
    expect(lines).toEqual({ 'p-gk': ['starter', 1], 'p-def': ['bench', null], 'p-mid': ['starter', 6], 'p-mid2': ['not_selected', null] })
  })

  it('the markers follow job, note, context and expectation, on the pitch, the bench and Not selected, in words too', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await pick(user, 6, /^Synthetic Midfielder 03/)
    expect(slot(6)).toHaveAccessibleName('Synthetic Midfielder 03, slot 6')
    expect(marks(slot(6))).toEqual({ done: false, context: false, ring: null })

    await user.type(within(sheet()).getByLabelText('Job · only Synthetic sees it'), 'Win the second balls.')
    expect(slot(6)).toHaveAccessibleName('Synthetic Midfielder 03, slot 6, has a job')
    expect(marks(slot(6))).toEqual({ done: true, context: false, ring: null })
    await user.click(within(sheet()).getByRole('button', { name: 'First start' }))
    expect(slot(6)).toHaveAccessibleName('Synthetic Midfielder 03, slot 6, has a job, context: first start')
    expect(marks(slot(6))).toEqual({ done: true, context: true, ring: null })
    await user.click(within(sheet()).getByRole('radio', { name: /^Lead/ }))
    expect(slot(6)).toHaveAccessibleName('Synthetic Midfielder 03, slot 6, lead, has a job, context: first start')
    expect(marks(slot(6))).toEqual({ done: true, context: true, ring: 'lead' })
    await user.click(within(sheet()).getByRole('radio', { name: /^Stretch/ }))
    expect(marks(slot(6)).ring).toBe('stretch')
    await user.click(within(sheet()).getByRole('radio', { name: /^Usual/ }))
    await user.click(within(sheet()).getByRole('button', { name: 'First start' }))
    await user.clear(within(sheet()).getByLabelText('Job · only Synthetic sees it'))
    expect(slot(6)).toHaveAccessibleName('Synthetic Midfielder 03, slot 6')
    expect(marks(slot(6))).toEqual({ done: false, context: false, ring: null })

    // On the bench.
    await user.click(benchFace('Synthetic Midfielder 05'))
    await user.type(within(sheet()).getByLabelText('Job · only Synthetic sees it'), 'Ready at half-time.')
    await user.click(within(sheet()).getByRole('radio', { name: /^Stretch/ }))
    expect(benchFace('Synthetic Midfielder 05')).toHaveAccessibleName('Synthetic Midfielder 05, bench, stretch, has a job')
    expect(marks(benchFace('Synthetic Midfielder 05'))).toEqual({ done: true, context: false, ring: 'stretch' })

    // Not selected: the ✓ is for the note.
    await user.click(benchFace('Synthetic Attacker 04'))
    await user.click(within(sheet()).getByRole('radio', { name: 'Not selected' }))
    await user.click(tab('Not selected'))
    const leftOut = () => within(screen.getByRole('tabpanel', { name: /^Not selected/ })).getByRole('button', { name: /^Synthetic Attacker 04/ })
    expect(leftOut()).toHaveAccessibleName('Synthetic Attacker 04, not selected')
    expect(marks(leftOut()).done).toBe(false)
    await user.type(within(sheet()).getByLabelText('Note to Synthetic · only Synthetic sees it'), 'Your chance comes Tuesday.')
    expect(leftOut()).toHaveAccessibleName('Synthetic Attacker 04, not selected, has a note')
    expect(marks(leftOut())).toEqual({ done: true, context: false, ring: null })
  })

  it('Out of position ticks and unticks itself; Can also play never ticks it; a tick the coach set himself stays', async () => {
    const user = userEvent.setup()
    also = [{ squad_player_id: 'p-att', position: 'Midfielder' }]
    const { saves } = store()
    await openLineUp(user)
    const outOfPosition = () => within(sheet()).getByRole('button', { name: 'Out of position' })

    // A midfielder at the back: Trak ticks it, and the i shows. Back in midfield, it goes.
    await pick(user, 2, /^Synthetic Midfielder 03/)
    expect(slot(2)).toHaveAccessibleName('Synthetic Midfielder 03, slot 2, context: out of position')
    expect(marks(slot(2)).context).toBe(true)
    expect(outOfPosition()).toHaveAttribute('aria-pressed', 'true')
    drag(slot(2), slot(6))
    expect(slot(6)).toHaveAccessibleName('Synthetic Midfielder 03, slot 6')
    expect(outOfPosition()).toHaveAttribute('aria-pressed', 'false')

    // The attacker can also play midfield: no tick there, but at the back there is.
    drag(benchFace('Synthetic Attacker 04'), slot(7))
    expect(slot(7)).toHaveAccessibleName('Synthetic Attacker 04, slot 7')
    drag(slot(7), slot(3))
    expect(slot(3)).toHaveAccessibleName('Synthetic Attacker 04, slot 3, context: out of position')
    // The coach unticks it; it stays off while he stays out of position.
    await user.click(outOfPosition())
    expect(slot(3)).toHaveAccessibleName('Synthetic Attacker 04, slot 3')
    drag(slot(3), slot(4))
    expect(slot(4)).toHaveAccessibleName('Synthetic Attacker 04, slot 4')

    // The coach ticks it himself for a midfielder in midfield: a move to the back and back again leaves it.
    drag(benchFace('Synthetic Midfielder 05'), slot(8))
    await user.click(outOfPosition())
    expect(slot(8)).toHaveAccessibleName('Synthetic Midfielder 05, slot 8, context: out of position')
    drag(slot(8), slot(5))
    drag(slot(5), slot(8))
    expect(slot(8)).toHaveAccessibleName('Synthetic Midfielder 05, slot 8, context: out of position')

    // Off the pitch, Trak's tick goes too: the keeper in midfield, then onto the bench.
    await pick(user, 9, /^Synthetic Goalkeeper 01/)
    expect(slot(9)).toHaveAccessibleName('Synthetic Goalkeeper 01, slot 9, context: out of position')
    drag(slot(9), tab('Bench'))
    expect(benchFace('Synthetic Goalkeeper 01')).toHaveAccessibleName('Synthetic Goalkeeper 01, bench')

    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    const context = Object.fromEntries(saves.at(-1)!.map(line => [line.squad_player_id, line.context]))
    expect(context).toEqual({ 'p-mid': [], 'p-att': [], 'p-mid2': ['out_of_position'], 'p-gk': [] })
  })

  it('a smaller format moves the lines: Trak\'s tick follows the new shape', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    // Slot 5 is the back line in 4-4-2, and midfield in 3-3-2.
    await pick(user, 5, /^Synthetic Midfielder 03/)
    expect(slot(5)).toHaveAccessibleName('Synthetic Midfielder 03, slot 5, context: out of position')
    await user.click(screen.getByRole('combobox', { name: 'Format and shape' }))
    const list = await screen.findByRole('listbox', { name: 'Format and shape' })
    await user.click(within(within(list).getByRole('group', { name: '9 a side' })).getByRole('option', { name: '3-3-2' }))
    await screen.findByRole('group', { name: '3-3-2, starting players. Attacking upwards.' })
    expect(slot(5)).toHaveAccessibleName('Synthetic Midfielder 03, slot 5')
  })

  it('a tick saved on a player standing out of position reads as Trak\'s, so moving them back unticks it', async () => {
    const user = userEvent.setup()
    store({ lineUp: [row('p-mid', { role: 'starter', slot: 2, context: ['out_of_position'] }), row('p-mid2', { context: ['out_of_position'] })] })
    await openLineUp(user)
    expect(slot(2)).toHaveAccessibleName('Synthetic Midfielder 03, slot 2, context: out of position')
    drag(slot(2), slot(6))
    expect(slot(6)).toHaveAccessibleName('Synthetic Midfielder 03, slot 6')
    // Saved on the bench, it was the coach's: on the pitch and off again, it stays.
    drag(benchFace('Synthetic Midfielder 05'), slot(2))
    drag(slot(2), tab('Bench'))
    expect(benchFace('Synthetic Midfielder 05')).toHaveAccessibleName('Synthetic Midfielder 05, bench, context: out of position')
  })

  it('locked at kick-off: the pitch and the tabs only show; nothing drags, and a face opens the sheet read-only', async () => {
    const user = userEvent.setup()
    store({ kickOffIn: -MINUTE, lineUp: [
      row('p-gk', { role: 'starter', slot: 1, job: 'Talk to the back four.', expectation: 'lead' }),
      row('p-mid2', { job: 'Ready at half-time.' }),
      row('p-att', { role: 'not_selected', note: 'Your chance comes Tuesday.' }),
    ] })
    await openLineUp(user)
    expect(screen.getByRole('heading', { name: '4-4-2' })).toBeVisible()
    expect(screen.queryByRole('combobox', { name: 'Format and shape' })).toBeNull()
    expect(screen.queryByText('Tap a player to see their job.')).toBeNull() // TRAK-513: no helper line
    expect(screen.queryByText(/^Drag a player/)).toBeNull()
    expect(document.querySelectorAll('[data-spot]')).toHaveLength(0)
    expect(slot(1)).toHaveAccessibleName('Synthetic Goalkeeper 01, slot 1, lead, has a job')

    drag(benchFace('Synthetic Midfielder 05'), slot(2))
    drag(slot(1), tab('Not selected'))
    expect(slot(2)).toHaveAccessibleName('Slot 2, empty')
    expect(slot(1)).toHaveAccessibleName('Synthetic Goalkeeper 01, slot 1, lead, has a job')

    await user.click(benchFace('Synthetic Midfielder 05'))
    const open = screen.getByRole('complementary', { name: 'Synthetic Midfielder 05' })
    expect(within(open).getByText('Ready at half-time.')).toBeInTheDocument()
    expect(within(open).queryAllByRole('textbox')).toEqual([])
    expect(within(open).queryByRole('radiogroup')).toBeNull()

    // The tabs still switch, to read who was left out.
    await user.click(tab('Not selected'))
    await user.click(within(screen.getByRole('tabpanel', { name: /^Not selected/ }))
      .getByRole('button', { name: 'Synthetic Attacker 04, not selected, has a note' }))
    expect(within(screen.getByRole('complementary', { name: 'Synthetic Attacker 04' })).getByText('Your chance comes Tuesday.')).toBeInTheDocument()
  })
})

/* TRAK-513 (Imad, 20 Nov): Line-up and jobs looks and works like Squad › Formations, plus each player's job, context and
   expectation: Formations' "Format and shape" picker, the key under the pitch (one word each), the count and Undo
   under it, no helper lines, and the selected player's sheet over the lists, which stay to drop on. */
describe('TRAK-513: Line-up and jobs as Squad › Formations', { timeout: 30_000 }, () => {
  it('has Formations\' picker, a one-word key, the count and no helper lines', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    expect(screen.getByRole('combobox', { name: 'Format and shape' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Key' })).getAllByRole('listitem').map(item => [...item.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim())).toEqual(['Job', 'Stretch', 'Lead', 'Context'])
    expect(screen.getByText(/ on the bench$/)).toBeInTheDocument()
    for (const line of [/^Drag a player onto/, /^Select a slot or a player/, /^Tap a player to see/, /formation itself stays/, /^Attacking/]) {
      expect(screen.queryByText(line)).toBeNull()
    }
  })

  it('Undo puts a move back', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    const undo = screen.getByRole('button', { name: 'Undo last change' })
    expect(undo).toBeDisabled()
    drag(benchFace('Synthetic Midfielder 05'), slot(2))
    expect(slot(2)).toHaveAccessibleName(/^Synthetic Midfielder 05, slot 2/)
    await user.click(undo)
    expect(slot(2)).toHaveAccessibleName('Slot 2, empty')
    expect(benchFace('Synthetic Midfielder 05')).toBeInTheDocument()
    expect(undo).toBeDisabled()
  })

  it('a selected player\'s sheet sits over the lists, which stay to drop on, and closes', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await user.click(benchFace('Synthetic Midfielder 05'))
    expect(sheet()).toHaveAccessibleName('Synthetic Midfielder 05')
    expect(tab('Not selected')).toBeInTheDocument()
    expect(bench()).toBeInTheDocument()
    await user.click(within(sheet()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})
