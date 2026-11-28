/**
 * TRAK-286 (Games 4/8): the plan's Share step, Review & share since TRAK-332 (Imad, 2 Nov): one card (Arc Account
 * health, adapted) reviews each part with its own Edit, and Share plan in it waits only for the logistics and the
 * face-to-face tick; it saves what's typed, then shares. Once shared, edits wait for "Share changes with N", which names
 * who changed. Needs you and Games home follow: "Plan not shared" goes once shared, "Changes not shared · N players"
 * comes while edits wait. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
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
// Thu 29 Oct 2026, 19:30 in Dubai.
const SHARED_AT = '2026-10-29T15:30:00Z'
let n = 0
let COACH = { id: 'coach-286' }

function game(id: string, opponent: string, days: number) {
  const kickOff = Math.ceil((Date.now() + days * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id, coach_user_id: COACH.id, squad: 'U16', title: `vs ${opponent}`, event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent, home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })
const plan = (event_id: string) => ({
  event_id, strength: 'stronger', their_formation: null, key_players: [], scouting: 'Their 9 is quick.', format: 11, formation: '4-4-2',
  goals: [{ title: 'Win the second ball', looks_like: 'First to every loose ball in midfield.' }],
  created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z',
})
const row = (id: string, over: Record<string, unknown>) =>
  ({ event_id: 'g1', squad_player_id: id, role: 'bench', slot: null, job: '', note: '', context: [], expectation: 'usual', ...over })
// Theodoros Zagorakis starts at right-back with a job and a note; Angelos Charisteas is left out with a note.
const LINE_UP = [
  row('zagorakis', { role: 'starter', slot: 4, job: 'Stay tight to their winger.', note: 'Second game at right-back. Proud of you.',
    context: ['out_of_position'], expectation: 'stretch' }),
  row('charisteas', { role: 'not_selected', note: 'Not this week. Your chance comes on Tuesday.' }),
]

/** The plan, its line-up, the share log and who changed, as the database answers; Share appends to the log. */
function store({ shared = false, changes = [] as string[], lineUp = LINE_UP } = {}) {
  const shares = shared ? [{ event_id: 'g1', shared_at: SHARED_AT }] : []
  const calls: { fn: string; body: unknown }[] = []
  server.use(
    table('game_plans', [plan('g1')]),
    table('game_plan_players', lineUp),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => {
      calls.push({ fn: 'save plan', body: await request.json() })
      return new HttpResponse(null, { status: 201 })
    }),
    http.post(`${SUPABASE_URL}/rest/v1/game_plan_players`, async ({ request }) => {
      calls.push({ fn: 'save line-up', body: await request.json() })
      return new HttpResponse(null, { status: 201 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/game_shares`, () => HttpResponse.json(shares)),
    rpc('game_plan_changes', () => changes.map(squad_player_id => ({ event_id: 'g1', squad_player_id }))),
    http.post(`${SUPABASE_URL}/rest/v1/rpc/share_game_plan`, async ({ request }) => {
      const body = await request.json()
      calls.push({ fn: 'share', body })
      shares.push({ event_id: 'g1', shared_at: SHARED_AT })
      changes.splice(0)
      return HttpResponse.json(3)
    }),
  )
  return calls
}

beforeEach(() => {
  COACH = { id: `coach-286-${++n}` }
  signInAs(COACH)
  server.use(
    // TRAK-355: who the coach is watching; no one.
    table('player_watches', []),
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      child('zagorakis', 'Theodoros Zagorakis', 7), child('charisteas', 'Angelos Charisteas', 9),
      child('basinas', 'Angelos Basinas', 6), child('nikopolidis', 'Antonios Nikopolidis', 1), child('karagounis', 'Giorgos Karagounis', 10),
    ]),
    // Antonios Nikopolidis can't make it; Giorgos Karagounis waits for consent.
    table('event_confirmations', [{ squad_player_id: 'zagorakis' }]),
    table('event_absences', [{ squad_player_id: 'nikopolidis' }]),
    rpc('coach_squad_player_consent_required', ({ p_squad_player_id }) => p_squad_player_id === 'karagounis'),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    table('coach_calendar_events', [game('g1', 'Parkview Athletic', 5)]),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    // TRAK-358: Can also play, for Out of position on the line-up; nobody has one.
    table('squad_player_also_plays', []),
    table('squad_player_roles', []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

const shareStep = () => renderApp('/coach/matches/g1?tab=plan&step=share')

describe('TRAK-286, TRAK-332: Review & share', { timeout: 30_000 }, () => {
  it('reviews every part at a glance; Share plan waits for the face-to-face tick, saves what is typed, then shares', async () => {
    const user = userEvent.setup()
    const calls = store()
    shareStep()
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    expect(within(card).getByRole('img', { name: '4 of 5 parts ready, 1 incomplete' })).toBeInTheDocument()
    const parts = within(card).getByRole('list', { name: 'The plan' })
    expect(within(parts).getAllByRole('listitem').map(item => item.querySelector('[class*="rowLabel"]')?.textContent))
      .toEqual(['Logistics', 'Tactics & analysis', 'Instructions', 'Line-up', 'Jobs'])
    expect(within(parts).getByText('1 instruction')).toBeInTheDocument()
    expect(within(parts).getByText('1 of 11 placed · 1 on the bench')).toBeInTheDocument()
    expect(within(parts).getByText('1 of 1 starters have one')).toBeInTheDocument()
    const share = within(card).getByRole('button', { name: 'Share plan' })
    expect(share).toBeDisabled()

    await user.click(within(card).getByRole('checkbox', { name: 'I’ve talked selection through with the players' }))
    await user.click(share)

    await waitFor(() => expect(calls.map(call => call.fn)).toEqual(['save plan', 'save line-up', 'share']))
    expect(calls[2].body).toEqual({ p_event_id: 'g1', p_talked: true })
    // Imad, 6 Nov: the heading says when, and nothing repeats it: no badge, no line on who reads it (readers() has its own test).
    const shared = await screen.findByRole('region', { name: 'Shared at Thu 19:30' })
    expect(within(shared).queryByText(/^Shared Thu|read it in the app|Edits stay with you/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share plan' })).toBeNull()
  })

  it('each part\'s Edit opens its step; the bottom bar keeps Back and Save draft; Who sees what and Preview are gone', async () => {
    const user = userEvent.setup()
    const calls = store()
    shareStep()
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    expect(screen.queryByRole('region', { name: 'Who sees what' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull()
    // Share sits in the card, not in the bar.
    const saveDraft = screen.getByRole('button', { name: 'Save draft' })
    expect(card).not.toContainElement(saveDraft)
    expect(card).toContainElement(within(card).getByRole('button', { name: 'Share plan' }))
    await user.click(saveDraft)
    await waitFor(() => expect(calls.map(call => call.fn)).toEqual(['save plan', 'save line-up']))

    await user.click(within(card).getByRole('button', { name: 'Edit instructions' }))
    expect(await screen.findByRole('heading', { name: 'Instructions' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next: Line-up and jobs' }))
    await user.click(screen.getByRole('button', { name: 'Next: Review & share' }))
    await user.click(within(await screen.findByRole('region', { name: 'Game plan review' })).getByRole('button', { name: 'Edit line-up' }))
    expect(await screen.findByRole('heading', { name: '4-4-2' })).toBeInTheDocument()
  })

  it('edits after sharing wait: the alert names who changed, and Share changes goes to them without a new tick', async () => {
    const user = userEvent.setup()
    const calls = store({ shared: true, changes: ['charisteas', 'basinas'] })
    shareStep()
    const shared = await screen.findByRole('region', { name: /^Shared at / })
    expect(await within(shared).findByText('Changes not shared')).toBeInTheDocument()
    expect(within(shared).getByText(/Angelos Charisteas and Angelos Basinas\. Only they and their families get the update\./)).toBeInTheDocument()
    expect(screen.getAllByText('Changes not shared').length).toBeGreaterThanOrEqual(2) // the header's badge too

    await user.click(within(shared).getByRole('button', { name: 'Share changes with 2' }))
    await waitFor(() => expect(calls.map(call => call.fn)).toEqual(['save plan', 'save line-up', 'share']))
    expect(calls[2].body).toEqual({ p_event_id: 'g1', p_talked: false })
    // Nothing left to share: the header says so (the alert's exit animation never finishes in jsdom).
    expect(await screen.findByText('Plan shared')).toBeInTheDocument()
  })

  it('a shared plan opens on Review & share, not on its first step', async () => {
    store({ shared: true })
    renderApp('/coach/matches/g1?tab=plan')
    expect(await screen.findByRole('region', { name: 'Game plan review' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Game plan' }).querySelector('[aria-current="step"]')).toHaveTextContent('Review & share')
  })

  it('a refusal says why, and keeps everything typed', async () => {
    const user = userEvent.setup()
    store()
    server.use(http.post(`${SUPABASE_URL}/rest/v1/rpc/share_game_plan`, () =>
      HttpResponse.json({ code: 'P0001', message: 'This match has kicked off, so its plan can\'t be shared' }, { status: 400 })))
    shareStep()
    const card = await screen.findByRole('region', { name: 'Game plan review' })
    await user.click(within(card).getByRole('checkbox', { name: /talked selection through/ }))
    await user.click(within(card).getByRole('button', { name: 'Share plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This match has kicked off, so its plan can\'t be shared')
    expect(screen.getByRole('checkbox', { name: /talked selection through/ })).toBeChecked()
  })

  it('a starter whose family says they can\'t make it is flagged on the pitch, and still reads the plan', async () => {
    const user = userEvent.setup()
    store({ lineUp: [...LINE_UP, row('nikopolidis', { role: 'starter', slot: 1, job: 'Command the box on crosses.' })] })
    renderApp('/coach/matches/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
    // TRAK-358: Everyone's job went; the keeper's face says it, as the pitch always has.
    const keeper = await screen.findByRole('button', { name: /^Antonios Nikopolidis, slot 1/ })
    expect(keeper).toHaveAccessibleName("Antonios Nikopolidis, slot 1, has a job, can't make it")
    expect(keeper.querySelector('[data-mark="absent"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Next: Review & share' }))
    await user.click(await screen.findByRole('checkbox', { name: /talked selection through/ }))
    await user.click(screen.getByRole('button', { name: 'Share plan' }))
    expect(await screen.findByRole('region', { name: /^Shared at / })).toBeInTheDocument()
  })
})

describe('TRAK-286: Needs you and Games home follow the share', { timeout: 30_000 }, () => {
  function games(changes: Record<string, string[]>) {
    server.use(
      table('coach_calendar_events', [game('g1', 'Parkview Athletic', 3), game('g2', 'Riverside Rovers', 4),
        game('g3', 'Harbour Town', 5), game('g4', 'Northgate United', 6)]),
      // g1 and g2 are shared; g3 is a draft; g4 has no plan.
      table('game_plans', [plan('g1'), plan('g2'), plan('g3')]),
      table('game_plan_players', []),
      table('game_shares', [{ event_id: 'g1', shared_at: SHARED_AT }, { event_id: 'g2', shared_at: SHARED_AT }]),
      rpc('game_plan_changes', ({ p_event_ids }) => (p_event_ids as string[])
        .flatMap(event_id => (changes[event_id] ?? []).map(squad_player_id => ({ event_id, squad_player_id })))),
    )
  }

  // TRAK-608: the To-do takes the next match's next step on a day with no events (the others wait in Upcoming, TRAK-611).
  it('To-do: changes not shared for a shared plan with edits; nothing for one without', async () => {
    const user = userEvent.setup()
    games({ g1: ['charisteas', 'basinas'] })
    renderApp('/coach/home')
    const todo = await screen.findByRole('region', { name: 'To-do' }, { timeout: 5000 })
    const card = (await within(todo).findByText('Share the plan for Parkview Athletic', {}, { timeout: 5000 })).closest('li')!
    // TRAK-333 (Imad, 2 Nov): split buttons; the match's other pages sit behind the chevron.
    await user.click(within(card).getByRole('button', { name: 'Share changes more actions' }))
    expect((await screen.findAllByRole('menuitem')).map(item => item.textContent)).toEqual(['View plan', 'Logistics'])
    await user.keyboard('{Escape}')
    await user.click(within(card).getByRole('button', { name: 'Share changes' }))
    await waitFor(() => expect(window.location.pathname + window.location.search).toBe('/coach/matches/g1?tab=plan&step=share'))
  })

  it('Games home: a shared plan is no longer a draft; the next game offers Share changes', async () => {
    const user = userEvent.setup()
    games({ g1: ['charisteas'] })
    renderApp('/coach/matches')
    const next = await screen.findByRole('region', { name: 'Next match' })
    // TRAK-588: no Open drafts box; the draft left (Harbour Town's) says so on its row.
    expect(screen.queryByRole('heading', { name: 'Open drafts' })).toBeNull()
    expect(await within(next).findByText('Changes not shared')).toBeInTheDocument()
    const strip = screen.getByRole('region', { name: 'Upcoming matches' })
    expect(within(within(strip).getByRole('link', { name: /Riverside Rovers/ })).getByText('Plan shared')).toBeInTheDocument()
    expect(within(within(strip).getByRole('link', { name: /Harbour Town/ })).getByText('Draft')).toBeInTheDocument()
    await user.click(within(next).getByRole('button', { name: 'Share changes' }))
    expect(window.location.pathname + window.location.search).toBe('/coach/matches/g1?tab=plan&step=share')
  })
})
