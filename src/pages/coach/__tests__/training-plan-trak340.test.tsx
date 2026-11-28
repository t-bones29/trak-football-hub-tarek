/**
 * TRAK-340 (Training redo 2/5, spec TRAK-338, 2 Nov prototype): Plan session. A plan is parts: a new one starts from the
 * coach's last shape or Trak's five, each part with its usual drill picked. One step per part, then Review, and the plan
 * saves whole with each part's name, type, Trak drill and players, and the coach's note. Your session moves, removes and
 * adds parts; Write your own saves a drill to My drills under its part; Save as draft keeps it for later. Replaces
 * Write my own (TRAK-295) and the Add/Swap sheet (TRAK-296). Test people are named after footballers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderApp } from '../../../../tests/support/render-app'
import { signInAs } from '../../../../tests/support/session'
import { server } from '../../../../tests/msw/server'
import { table, rpc, SUPABASE_URL } from '../../../../tests/msw/supabase'
import { partsFromShape, standardShape, usageOf } from '@/lib/training/parts'
import { LIBRARY, START_LEVEL, step } from '@/lib/training/library'
import { localParts } from '@/lib/event-time'

/** A Library drill by name (TRAK-392: Plan session's drills are the Library's). */
const lib = (name: string) => LIBRARY.find(d => d.name === name)!

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const onTheMinute = (ms: number) => Math.ceil(ms / MINUTE) * MINUTE
// The local date and time, as the app reads event_date and start_time: a UTC slice is a day behind from Dubai's midnight
// until 04:00, so starts_at and event_date disagreed and the Upcoming row lost its Draft badge.
const ymd = (ms: number) => localParts(new Date(ms).toISOString()).date
const hm = (ms: number) => localParts(new Date(ms).toISOString()).time

let n = 0
let COACH = { id: 'coach-340' }
function training(id: string, start: number, over: Record<string, unknown> = {}) {
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `Training ${id}`, event_type: 'training', published: true, status: 'scheduled',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 90 * MINUTE).toISOString(),
    event_date: ymd(start), start_time: `${hm(start)}:00`, venue: 'Pitch 2', family_note: null, ...over,
  }
}
const practice = (position: number, name: string, over: Record<string, unknown> = {}) => ({
  position, name, minutes: 15, how: '', tell: '', area: '', numbers: '', direction: '', targets: '', conditions: '',
  source: 'own', drill_id: null, library_session: null, part: '', part_type: null, trak_drill: null, players_kind: null, group_size: null, ...over,
})
const trak = (position: number, id: string, name: string, part: string, part_type: string, minutes = 15) =>
  practice(position, name, { source: 'trak', trak_drill: id, part, part_type, minutes })

/** Trainings, plans, drafts and My drills as the database keeps them; saves, drafts and drills written are kept. */
function database(events: Record<string, unknown>[], start: Record<string, Record<string, unknown>[]> = {},
  { drafts = [] as Record<string, unknown>[], drills = [] as Record<string, unknown>[] } = {}) {
  const plans = new Map(Object.entries(start))
  const saves: Record<string, unknown>[] = []
  const draftsSent: Record<string, unknown>[] = []
  const drillsSent: Record<string, unknown>[] = []
  const eq = (url: URL, key: string) => url.searchParams.get(key)?.match(/^eq\.(.*)$/)?.[1]
  server.use(
    http.get(`${SUPABASE_URL}/rest/v1/coach_calendar_events`, ({ request }) => {
      const id = eq(new URL(request.url), 'id')
      return HttpResponse.json(id ? events.filter(e => e.id === id) : events)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plans`, ({ request }) => {
      const id = eq(new URL(request.url), 'event_id')
      const rows = [...plans.keys()].map(event_id => ({ event_id, updated_at: '2026-11-01T10:00:00Z', note: '' }))
      return HttpResponse.json(id ? rows.filter(r => r.event_id === id) : rows)
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_practices`, ({ request }) => {
      const id = eq(new URL(request.url), 'event_id')
      if (id) return HttpResponse.json(plans.get(id) ?? [])
      return HttpResponse.json([...plans].flatMap(([event_id, rows]) => rows.map(row => ({ event_id, ...row }))))
    }),
    http.get(`${SUPABASE_URL}/rest/v1/training_plan_drafts`, () => HttpResponse.json(drafts)),
    http.post(`${SUPABASE_URL}/rest/v1/training_plan_drafts`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      draftsSent.push(body)
      return HttpResponse.json({ event_id: body.event_id })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/coach_drills`, () => HttpResponse.json(drills)),
    http.post(`${SUPABASE_URL}/rest/v1/coach_drills`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      drillsSent.push(body)
      return HttpResponse.json({ id: `drill-new-${drillsSent.length}`, updated_at: '2026-11-03T10:00:00Z', tell: '', area: '', numbers: '',
        direction: '', targets: '', conditions: '', ...body })
    }),
    rpc('save_training_plan', args => {
      saves.push(args)
      plans.set(String(args.p_event_id), (args.p_practices as Record<string, unknown>[]).map((p, i) => ({ ...p, position: i + 1 })))
      return null
    }),
  )
  return { saves, draftsSent, drillsSent }
}

beforeEach(() => {
  COACH = { id: `coach-340-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Jürgen Klopp', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Mohamed Salah', age_group: 'U16', status: 'active' }]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('training_notes', []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const session = () => within(screen.getByRole('list', { name: 'Parts of the session' })).getAllByRole('listitem')
  .map(item => item.textContent?.replace(/\s+/g, ' ').trim())
const part = (name: string) => screen.findByRole('region', { name })
const next = (to: string) => userEvent.click(screen.getByRole('button', { name: new RegExp(`^Next: ${to}`) }))

describe('TRAK-340: a new plan', { timeout: 30_000 }, () => {
  it('starts from Trak’s five with each usual drill picked; Next through the parts, Review, and the plan saves whole', async () => {
    const user = userEvent.setup()
    const { saves } = database([training('soon', onTheMinute(Date.now() + DAY), { title: 'Pressing triggers' })])
    renderApp('/coach/training/soon/plan')
    const warmup = await part('Dry warm-up')
    // TRAK-456: the planner is the training page's Training plan tab, under the page's header (the training's name).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pressing triggers')
    expect(session()).toEqual([
      '1Dry warm-upMoving warm-up10 min', '2Passing & movementPass and follow15 min', '3RondoKeep the ball15 min',
      '4Functional drillsAttack down the side25 min', '5GamePass then score25 min',
    ].map(s => expect.stringContaining(s)))
    // TRAK-392: the starter drill from the Library is picked. TRAK-404 (Kostas, 10 Nov): the choices show names only
    // (and why they're offered); View drill has the rest.
    const picked = within(warmup).getByRole('button', { name: /^Moving warm-up/, pressed: true })
    expect(picked).toHaveTextContent('Starter drill')
    expect(picked.textContent).not.toContain(lib('Moving warm-up').why)
    expect(within(warmup).getAllByRole('button', { name: /^View drill:/ }).length).toBeGreaterThan(0)
    // TRAK-404: no logistics line, guide line or "We picked a drill" line (TRAK-456: in the planner; the page's header has them).
    expect(within(screen.getByRole('tabpanel')).queryByText(/Main Venue|Pitch 2|· 90 min/)).toBeNull()
    expect(screen.queryByText(/Get them moving before the ball comes out/)).toBeNull()
    expect(screen.queryByText(/We picked/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save as draft' })).toBeNull()
    expect(within(warmup).getByRole('button', { name: 'Remove Dry warm-up' })).toHaveTextContent('')
    // No coach-made drills (Kostas, 8 Nov).
    expect(screen.queryByRole('button', { name: 'Write your own' })).toBeNull()
    // TRAK-484 (Kostas, 19 Nov): the total beside Your session is the only time line; nothing under the bar.
    expect(screen.getByText('90 of 90 min')).toBeInTheDocument()
    expect(screen.queryByText(/Fits your|min over|min spare/)).toBeNull()

    // Pick another warm-up and give it 15 minutes.
    await user.click(within(warmup).getByRole('button', { name: /^Tag games/ }))
    expect(within(warmup).getByRole('button', { name: /^Tag games/, pressed: true })).toBeInTheDocument()
    await user.click(within(warmup).getByRole('button', { name: '15 min' }))
    expect(screen.getByText('95 of 90 min')).toBeInTheDocument()
    expect(screen.queryByText(/min over/)).toBeNull()

    await next('Passing & movement')
    await part('Passing & movement')
    await next('Rondo')
    await next('Functional drills')
    await next('Game')
    // Plan session one column (25 Nov): the last part has no Next; Your session's Review & share is the one way on.
    expect(screen.queryByRole('button', { name: /^Next: / })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Review & share' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Review & share' }))
    expect(await screen.findByRole('region', { name: 'Training plan review' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/A note for you/), 'Remind the back four to talk.')
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect(saves[0].p_event_id).toBe('soon')
    expect(saves[0].p_note).toBe('Remind the back four to talk.')
    expect((saves[0].p_practices as Record<string, unknown>[]).map(p => `${p.part}/${p.part_type}/${p.trak_drill}/${p.trak_level}/${p.minutes}`)).toEqual([
      `Dry warm-up/warmup/${lib('Tag games').id}/${START_LEVEL}/15`, `Passing & movement/passing/${lib('Pass and follow').id}/${START_LEVEL}/15`,
      `Rondo/rondo/${lib('Keep the ball').id}/${START_LEVEL}/15`, `Functional drills/functional/${lib('Attack down the side').id}/${START_LEVEL}/25`,
      `Game/game/${lib('Pass then score').id}/${START_LEVEL}/25`])
    await waitFor(() => expect(window.location.pathname).toBe('/coach/training'))
    expect(await screen.findByText(/^Plan saved for Pressing triggers,/)).toBeInTheDocument()
  })

  it('starts from the parts the coach saved last time, with their usual drills; Start from Trak’s 5 parts resets', async () => {
    const user = userEvent.setup()
    const now = Date.now()
    database([training('past', onTheMinute(now - 3 * DAY)), training('soon', onTheMinute(now + DAY))], {
      past: [trak(1, lib('Tag games').id, 'Tag games', 'Warm-up', 'warmup', 10), trak(2, lib('Four corners').id, 'Four corners', 'Rondo', 'rondo', 20),
        practice(3, 'Our press', { part: 'Pressing game', part_type: 'own', minutes: 30 })],
    })
    renderApp('/coach/training/soon/plan')
    await part('Warm-up')
    await waitFor(() => expect(session()).toHaveLength(3))
    expect(session()[0]).toContain('Tag games')
    expect(session()[1]).toContain('Four corners')
    expect(session()[2]).toContain('Pressing game')
    expect(session()[2]).toContain('No drill yet')
    expect(screen.getByText('Started from the parts you used last time.')).toBeInTheDocument()
    const warmup = await part('Warm-up')
    expect(within(warmup).getByRole('button', { name: /^Tag games/, pressed: true })).toHaveTextContent('Your usual · 1 of your last 1')
    await user.click(screen.getByRole('button', { name: 'Start from Trak’s 5 parts' }))
    await waitFor(() => expect(session()).toHaveLength(5))
    expect(screen.queryByRole('button', { name: 'Start from Trak’s 5 parts' })).toBeNull()
  })
})

describe('TRAK-340: Your session', { timeout: 30_000 }, () => {
  // Plan session one column (25 Nov): a card in Your session opens its part; the part itself moves and removes.
  it('a card opens its part, which moves earlier and is removed with Undo; and Add a part adds one', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + DAY))])
    renderApp('/coach/training/soon/plan')
    await part('Dry warm-up')
    const cards = () => within(screen.getByRole('list', { name: 'Parts of the session' }))
    expect(cards().queryByRole('button', { name: /^(Remove|Edit|Move) / })).toBeNull()
    await user.click(cards().getByRole('button', { name: /Rondo/ }))
    await part('Rondo')
    expect(cards().getByRole('button', { name: /Rondo/ })).toHaveAttribute('aria-current', 'step')
    await user.click(screen.getByRole('button', { name: 'Move Rondo earlier' }))
    expect(session()[1]).toContain('Rondo')
    expect(session()[2]).toContain('Passing & movement')
    expect(await part('Rondo')).toBeInTheDocument()

    await user.click(cards().getByRole('button', { name: /\bGame\b/ }))
    expect(screen.getByRole('button', { name: 'Move Game later' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Remove Game' }))
    await waitFor(() => expect(session()).toHaveLength(4))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(session()).toHaveLength(5))

    await user.click(screen.getAllByRole('button', { name: 'Add a part' })[0])
    const sheet = await screen.findByRole('dialog', { name: 'Add a part' })
    await user.click(within(sheet).getByRole('button', { name: /^Cool-down/ }))
    await user.click(within(sheet).getByRole('button', { name: 'Add part' }))
    await waitFor(() => expect(session()).toHaveLength(6))
    expect(session()[5]).toContain('Cool-down')
  })

  it('a part of the coach’s own needs a drill before the plan saves', async () => {
    const user = userEvent.setup()
    const { saves } = database([training('soon', onTheMinute(Date.now() + DAY))])
    renderApp('/coach/training/soon/plan')
    await part('Dry warm-up')
    await user.click(screen.getAllByRole('button', { name: 'Add a part' })[0])
    const sheet = await screen.findByRole('dialog', { name: 'Add a part' })
    await user.type(within(sheet).getByLabelText('Or name your own'), 'Pressing game')
    await user.click(within(sheet).getByRole('button', { name: 'Add part' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // Through every part to Review.
    for (let i = 0; i < 5; i++) await user.click(screen.getByRole('button', { name: /^Next: / }))
    await user.click(screen.getByRole('button', { name: 'Review & share' }))
    await screen.findByRole('region', { name: 'Training plan review' })
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Select a drill for Pressing game, or remove the part.')
    expect(saves).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Edit pressing game' }))
    expect(await part('Pressing game')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review & share' })).toBeInTheDocument()
  })
})

describe('TRAK-340: drills', { timeout: 30_000 }, () => {
  // TRAK-404 (Kostas, 10 Nov): a fourth choice, Find another drill, opens the whole Drill Library: the part's own drills
  // first, then the rest by kind.
  it('Find another drill lists the part’s drills by drill type, then the rest of the Library; one picked there shows in the choices', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + DAY))])
    renderApp('/coach/training/soon/plan')
    await part('Dry warm-up')
    await next('Passing & movement')
    const passing = await part('Passing & movement')
    await user.click(within(passing).getByRole('button', { name: /^Find another drill/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Find another drill for Passing & movement' })
    expect(within(sheet).getAllByRole('heading', { level: 3 }).map(h => h.textContent))
      .toEqual(['Passing', 'Pressing movement', 'Follow and copy', 'Repetition', 'Individual', 'Goalkeeping', 'Get ready', 'Skill practices', 'Game related practices'])
    // TRAK-520 (Imad, 20 Nov): a plain rule where the rest of the Library starts, no words.
    expect(within(sheet).queryByText('The rest of the Drill Library')).toBeNull()
    expect(within(sheet).getAllByRole('button', { name: /^Select / })).toHaveLength(LIBRARY.length - 1)
    expect(within(sheet).queryByRole('button', { name: 'My drills' })).toBeNull()
    await user.type(within(sheet).getByRole('searchbox', { name: 'Search drills' }), 'gate')
    await user.click(await within(sheet).findByRole('button', { name: 'Select Pass through the gate' }))
    expect(within(await part('Passing & movement')).getByRole('button', { name: /^Pass through the gate/, pressed: true })).toBeInTheDocument()
    // A drill of another kind can fill the part too.
    await user.click(within(await part('Passing & movement')).getByRole('button', { name: /^Find another drill/ }))
    const again = await screen.findByRole('dialog', { name: 'Find another drill for Passing & movement' })
    await user.type(within(again).getByRole('searchbox', { name: 'Search drills' }), 'four corners')
    await user.click(await within(again).findByRole('button', { name: 'Select Four corners' }))
    expect(within(await part('Passing & movement')).getByRole('button', { name: /^Four corners/, pressed: true })).toBeInTheDocument()
  })
})

/* TRAK-392 (Drill Library 7/11): View drill. */
describe('TRAK-392: View drill', { timeout: 30_000 }, () => {
  it('shows the drill with Easier / Harder; Use this drill picks it, and the level set there is saved with the plan', async () => {
    const user = userEvent.setup()
    const { saves } = database([training('soon', onTheMinute(Date.now() + DAY))])
    renderApp('/coach/training/soon/plan')
    await part('Dry warm-up')
    await next('Passing & movement')
    await next('Rondo')
    const rondo = await part('Rondo')
    await user.click(within(rondo).getByRole('button', { name: 'View drill: Four corners' }))
    const sheet = await screen.findByRole('dialog', { name: 'Four corners' })
    expect(within(sheet).getByRole('img', { name: /^Four corners set-up\./ })).toBeInTheDocument()
    expect(within(sheet).getByRole('heading', { name: 'How to play' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Harder' }))
    expect(within(sheet).getByText('Harder. Here’s what Trak changed:')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Use this drill' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(await part('Rondo')).getByRole('button', { name: /^Four corners/, pressed: true })).toBeInTheDocument()

    // The picked drill opens at its own level; Done keeps it.
    await user.click(within(await part('Rondo')).getByRole('button', { name: 'View drill: Four corners' }))
    const again = await screen.findByRole('dialog', { name: 'Four corners' })
    expect(within(again).queryByRole('button', { name: 'Use this drill' })).toBeNull()
    await user.click(within(again).getByRole('button', { name: 'Done' }))

    await next('Functional drills')
    await next('Game')
    await user.click(screen.getByRole('button', { name: 'Review & share' }))
    await user.click(await screen.findByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    const sent = (saves[0].p_practices as Record<string, unknown>[])[2]
    expect(sent).toMatchObject({ trak_drill: lib('Four corners').id, trak_level: step(lib('Four corners'), 8, START_LEVEL, 1)!.level })
  })
})

describe('TRAK-340: drafts and a saved plan', { timeout: 30_000 }, () => {
  // TRAK-404 (Kostas, 10 Nov): no Save as draft; every change saves the draft by itself, and leaving never asks.
  it('every change saves the draft by itself, with the parts and the step; just looking saves nothing', async () => {
    const user = userEvent.setup()
    const { draftsSent } = database([training('soon', onTheMinute(Date.now() + DAY))])
    renderApp('/coach/training/soon/plan')
    const warmup = await part('Dry warm-up')
    await next('Passing & movement')
    await new Promise(r => setTimeout(r, 1200))
    expect(draftsSent).toHaveLength(0)
    // The step bar jumps to any step, back or ahead (Kostas, 10 Nov).
    const steps = () => screen.getByRole('navigation', { name: 'Planning steps' })
    await user.click(within(steps()).getByRole('button', { name: /Dry warm-up/ }))
    await user.click(within(await part('Dry warm-up')).getByRole('button', { name: /^Tag games/ }))
    expect(warmup).toBeDefined()
    await user.click(within(steps()).getByRole('button', { name: /Rondo/ }))
    expect(await part('Rondo')).toBeInTheDocument()
    await waitFor(() => expect(draftsSent.at(-1)).toMatchObject({ event_id: 'soon', step: 2 }), { timeout: 3000 })
    expect((draftsSent.at(-1)!.body as { parts: { drill: { name: string } }[] }).parts[0].drill.name).toBe('Tag games')
    expect(await screen.findByText('Draft saved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as draft' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Back' }))
  })

  it('with no draft, there is no Open drafts box and no "No drafts open." (TRAK-589, Kostas, 25 Nov)', async () => {
    database([training('soon', onTheMinute(Date.now() + DAY), { title: 'Pressing triggers' })])
    renderApp('/coach/training')
    await screen.findByRole('region', { name: 'Next training' }, { timeout: 5000 })
    expect(screen.queryByRole('heading', { name: 'Open drafts' })).toBeNull()
    expect(screen.queryByText('No drafts open.')).toBeNull()
  })

  it('with a draft, the Next training card says Draft, and Continue plan carries on where the coach stopped', async () => {
    const user = userEvent.setup()
    const parts = partsFromShape(standardShape(), 15, usageOf([]))
    database([training('soon', onTheMinute(Date.now() + DAY), { title: 'Pressing triggers' })], {},
      { drafts: [{ event_id: 'soon', step: 2, body: { parts, note: '' }, updated_at: '2026-11-03T10:00:00Z' }] })
    renderApp('/coach/training')
    // TRAK-584: the card is "Next training", in Matches' words: Draft, and Continue plan. TRAK-589: no Open drafts box;
    // the Draft badge is amber on the card and on the training's Upcoming row.
    const card = await screen.findByRole('region', { name: 'Next training' }, { timeout: 5000 })
    await within(card).findByText('Pressing triggers')
    expect(within(card).getByText('Draft').className).toMatch(/\bborder-attention\b/)
    const row = within(screen.getByRole('region', { name: 'Upcoming trainings' })).getByRole('link', { name: /Pressing triggers/ })
    expect(within(row).getByText('Draft').className).toMatch(/\bborder-attention\b/)
    expect(screen.queryByRole('heading', { name: 'Open drafts' })).toBeNull()
    await user.click(within(card).getByRole('button', { name: 'Continue plan' }))
    expect(await part('Rondo')).toBeInTheDocument()
  })

  it('a saved plan opens at Review; Edit opens only that part, then Review & share', async () => {
    const user = userEvent.setup()
    const { saves } = database([training('soon', onTheMinute(Date.now() + DAY))], {
      soon: [trak(1, 'w1', 'Dynamic warm-up', 'Dry warm-up', 'warmup', 10), trak(2, 'r1', 'Rondo 4 v 2', 'Rondo', 'rondo')],
    })
    renderApp('/coach/training/soon/plan')
    expect(await screen.findByRole('region', { name: 'Training plan review' })).toBeInTheDocument()
    const plan = within(screen.getByRole('list', { name: 'The plan' })).getAllByRole('listitem')
    expect(plan.map(p => p.textContent)).toEqual([expect.stringContaining('Logistics'), expect.stringContaining('Dynamic warm-up'), expect.stringContaining('Rondo 4 v 2')])
    await user.click(screen.getByRole('button', { name: 'Edit rondo' }))
    const rondo = await part('Rondo')
    await user.click(within(rondo).getByRole('button', { name: '20 min' }))
    await user.click(screen.getByRole('button', { name: 'Review & share' }))
    await user.click(await screen.findByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(saves).toHaveLength(1))
    expect((saves[0].p_practices as Record<string, unknown>[]).map(p => `${p.name} ${p.minutes}`)).toEqual(['Dynamic warm-up 10', 'Rondo 4 v 2 20'])
  })

  it('a failed save keeps everything and says so; the database’s own refusal is said in its words', async () => {
    const user = userEvent.setup()
    database([training('soon', onTheMinute(Date.now() + DAY))], { soon: [trak(1, 'r1', 'Rondo 4 v 2', 'Rondo', 'rondo')] })
    server.use(rpc('save_training_plan', () => ({ status: 500, body: { message: 'down' } })))
    renderApp('/coach/training/soon/plan')
    await user.click(await screen.findByRole('button', { name: 'Save the plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn’t save.*Nothing you changed is lost/)
    expect(window.location.pathname + window.location.search).toBe('/coach/training/soon?tab=plan')
    server.use(rpc('save_training_plan', () => ({ status: 400, body: { code: 'P0001', message: 'This training was cancelled' } })))
    await user.click(screen.getByRole('button', { name: 'Save the plan' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This training was cancelled.'))
  })

  it('a cancelled training can’t be planned; one that isn’t the coach’s says so', async () => {
    database([training('off', onTheMinute(Date.now() + DAY), { status: 'cancelled' })])
    renderApp('/coach/training/off/plan')
    expect(await screen.findByText('This training was cancelled, so its plan can’t change.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save the plan' })).toBeNull()
    cleanup()
    database([])
    renderApp('/coach/training/someone-elses/plan')
    expect(await screen.findByText('This training isn’t in your events.')).toBeInTheDocument()
  })
})

// TRAK-387: Training › Drills is the Library now, with no coach-made drills; adding a Library drill to a training
// comes back with TRAK-391.
