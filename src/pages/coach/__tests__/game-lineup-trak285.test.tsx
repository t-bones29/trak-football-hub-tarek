/**
 * TRAK-285 (Games 3/8): plan step 2, line-up and jobs. "Can't make it" players can't be placed; a slot holds one player
 * and a player one slot; bench and not selected come back after a reload; the progress counts starters with a job. A
 * child waiting for consent is nowhere. TRAK-329: the formation is one dropdown on the pitch, grouped by format.
 * TRAK-358: Formations' pitch, with Bench and Not selected as tabs; Everyone's job and its count went, and Review &
 * share counts the starters with a job. Every child here is a midfielder, so one placed in goal or at the back gets
 * Out of position ticked. Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
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
let COACH = { id: 'coach-285' }

function game() {
  const kickOff = Math.ceil((Date.now() + 5 * DAY) / MINUTE) * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: `${at.slice(11, 16)}:00`, end_time: null, meet_time: null,
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number, age_group = 'U16') =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group, status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })

/** The plan and its line-up as the database keeps them, written by the app's upserts. */
function store() {
  const plans = new Map<string, Record<string, unknown>>()
  const lineUp = new Map<string, Record<string, unknown>>()
  const saves: Record<string, unknown>[][] = []
  server.use(
    // TRAK-363: the plan's Instructions offer the squad's season objectives.
    table('season_plans', []),
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, () => HttpResponse.json([...plans.values()])),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      plans.set(body.event_id as string, { ...body, created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z' })
      return new HttpResponse(null, { status: 201 })
    }),
    http.get(`${SUPABASE_URL}/rest/v1/game_plan_players`, () => HttpResponse.json([...lineUp.values()])),
    http.post(`${SUPABASE_URL}/rest/v1/game_plan_players`, async ({ request }) => {
      const rows = await request.json() as Record<string, unknown>[]
      saves.push(rows)
      for (const row of rows) lineUp.set(row.squad_player_id as string, row)
      return new HttpResponse(null, { status: 201 })
    }),
  )
  return { saves, plans }
}

beforeEach(() => {
  COACH = { id: `coach-285-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [
      child('zagorakis', 'Theodoros Zagorakis', 7), child('charisteas', 'Angelos Charisteas', 9),
      child('karagounis', 'Giorgos Karagounis', 10), child('nikopolidis', 'Antonios Nikopolidis', 1),
      child('basinas', 'Angelos Basinas', 6), child('katsouranis', 'Kostas Katsouranis', 8, 'U14'),
    ]),
    // Nikopolidis's family said he can't make it; Karagounis waits for consent. Every switch answers on, so the season
    // plan is on and the coach's confirmations aren't read (TRAK-359): zagorakis' confirmation changes nothing.
    table('event_confirmations', [{ squad_player_id: 'zagorakis' }]),
    table('event_absences', [{ squad_player_id: 'nikopolidis' }]),
    rpc('coach_squad_player_consent_required', ({ p_squad_player_id }) => p_squad_player_id === 'karagounis'),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('coach_calendar_events', [game()]),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
    // TRAK-358: Can also play, for Out of position; nobody has one.
    table('squad_player_also_plays', []),
    table('squad_player_roles', []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

async function openLineUp(user: ReturnType<typeof userEvent.setup>) {
  renderApp('/coach/matches/g1?tab=plan')
  await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
  return screen.findByRole('heading', { name: '4-4-2' })
}
const slot = (number: number) => screen.getByRole('button', { name: new RegExp(`slot ${number}(,|$)`, 'i') })
async function pick(user: ReturnType<typeof userEvent.setup>, slotNumber: number, name: RegExp) {
  await user.click(slot(slotNumber))
  await user.click(screen.getByRole('combobox', { name: 'Who plays here?' }))
  await user.click(await screen.findByRole('option', { name }))
}
const bench = () => screen.getByRole('tabpanel', { name: /^Bench/ })

describe('TRAK-285: plan step 2, line-up and jobs', { timeout: 30_000 }, () => {
  it('lists who can come, Confirmed first; "Can\'t make it" can\'t be placed, and a child waiting for consent is nowhere', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await user.click(slot(1))
    await user.click(screen.getByRole('combobox', { name: 'Who plays here?' }))
    const options = await screen.findAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      'Angelos Basinas', 'Angelos Charisteas', 'Theodoros Zagorakis', "Antonios Nikopolidis · can't make it",
    ])
    expect(options[3]).toHaveAttribute('aria-disabled', 'true')
    await user.click(options[3])
    expect(slot(1)).toHaveAccessibleName('Slot 1, empty')
    expect(screen.queryByText(/Karagounis/)).toBeNull()
    expect(screen.queryByText(/Katsouranis/)).toBeNull()
    // TRAK-359: his family's report puts him in Not attending, flagged.
    await user.click(screen.getByRole('tab', { name: 'Not attending · 1' }))
    expect(within(screen.getByRole('tabpanel', { name: 'Not attending · 1' })).getByRole('button', { name: "Antonios Nikopolidis, not attending, can't make it" })).toBeInTheDocument()
  })

  it('a slot holds one player and a player one slot', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await pick(user, 1, /^Theodoros Zagorakis/)
    expect(slot(1)).toHaveAccessibleName('Theodoros Zagorakis, slot 1, context: out of position')

    // A filled slot opens its player's sheet: nobody can be dropped on top of them.
    await user.click(slot(1))
    expect(screen.queryByRole('combobox', { name: 'Who plays here?' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Theodoros Zagorakis' })).toBeInTheDocument()

    // Picking a player already on the pitch for another slot moves them.
    await pick(user, 2, /^Theodoros Zagorakis · on the pitch/)
    expect(slot(1)).toHaveAccessibleName('Slot 1, empty')
    expect(slot(2)).toHaveAccessibleName('Theodoros Zagorakis, slot 2, context: out of position')

    await user.click(screen.getByRole('button', { name: 'Move to bench' }))
    expect(slot(2)).toHaveAccessibleName('Slot 2, empty')
    // TRAK-358: off the pitch, Trak's Out of position goes.
    expect(within(bench()).getByRole('button', { name: 'Theodoros Zagorakis, bench' })).toBeInTheDocument()
  })

  it('bench and not selected come back after a reload; a player left out keeps only a note', async () => {
    const user = userEvent.setup()
    const { saves } = store()
    await openLineUp(user)
    await user.click(within(bench()).getByRole('button', { name: /^Angelos Charisteas, bench/ }))
    await user.click(screen.getByRole('radio', { name: 'Not selected' }))
    expect(screen.queryByLabelText(/^Job/)).toBeNull()
    await user.type(screen.getByLabelText('Note to Angelos · only Angelos sees it'), 'Not this week. Your chance comes Tuesday.')
    await user.click(within(bench()).getByRole('button', { name: /^Angelos Basinas, bench/ }))
    await user.type(screen.getByLabelText('Job · only Angelos sees it'), 'Be ready to come on at half-time.')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(saves.at(-1)).toEqual([
      { event_id: 'g1', squad_player_id: 'nikopolidis', role: 'not_attending', slot: null, job: '', note: '', context: [], expectation: 'usual' },
      { event_id: 'g1', squad_player_id: 'charisteas', role: 'not_selected', slot: null, job: '', note: 'Not this week. Your chance comes Tuesday.', context: [], expectation: 'usual' },
      { event_id: 'g1', squad_player_id: 'basinas', role: 'bench', slot: null, job: 'Be ready to come on at half-time.', note: '', context: [], expectation: 'usual' },
    ])

    cleanup()
    await openLineUp(user)
    await user.click(screen.getByRole('tab', { name: 'Not selected · 1' }))
    const leftOut = screen.getByRole('tabpanel', { name: 'Not selected · 1' })
    await user.click(within(leftOut).getByRole('button', { name: 'Angelos Charisteas, not selected, has a note' }))
    expect(screen.getByRole('radio', { name: 'Not selected' })).toBeChecked()
    expect(screen.getByLabelText('Note to Angelos · only Angelos sees it')).toHaveValue('Not this week. Your chance comes Tuesday.')
    await user.click(screen.getByRole('tab', { name: /^Bench/ }))
    await user.click(within(bench()).getByRole('button', { name: 'Angelos Basinas, bench, has a job' }))
    expect(screen.getByLabelText('Job · only Angelos sees it')).toHaveValue('Be ready to come on at half-time.')
  })

  it('TRAK-359: the coach moves a player to Not attending and back; a family-reported child stays; the counts follow', async () => {
    const user = userEvent.setup()
    const { saves } = store()
    await openLineUp(user)
    // Everyone is coming: three on the bench, and Nikopolidis, whose family said so, is already in Not attending.
    expect(screen.getByRole('tab', { name: 'Bench · 3' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Not attending · 1' })).toBeInTheDocument()
    await user.click(within(bench()).getByRole('button', { name: /^Angelos Charisteas, bench/ }))
    await user.click(screen.getByRole('radio', { name: 'Not attending' }))
    expect(screen.queryByLabelText(/^Job/)).toBeNull()
    expect(screen.queryByLabelText(/^Note/)).toBeNull()
    expect(screen.getByRole('tab', { name: 'Bench · 2' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Not attending · 2' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Not attending · 2' }))
    const panel = screen.getByRole('tabpanel', { name: 'Not attending · 2' })
    // The family-reported child can't be moved out: no choice, and why.
    await user.click(within(panel).getByRole('button', { name: "Antonios Nikopolidis, not attending, can't make it" }))
    expect(screen.queryByRole('radio', { name: 'Bench' })).toBeNull()
    expect(screen.getByText(/stays in Not attending until Antonios's family undoes it/)).toBeInTheDocument()
    // The coach's own mark moves back out.
    await user.click(within(panel).getByRole('button', { name: 'Angelos Charisteas, not attending' }))
    await user.click(screen.getByRole('radio', { name: 'Bench' }))
    expect(screen.getByRole('tab', { name: 'Not attending · 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Not attending · 1' }))
    await user.click(within(screen.getByRole('tabpanel', { name: 'Not attending · 1' })).getByRole('button', { name: "Antonios Nikopolidis, not attending, can't make it" }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(saves.at(-1)).toContainEqual({ event_id: 'g1', squad_player_id: 'nikopolidis', role: 'not_attending', slot: null, job: '', note: '', context: [], expectation: 'usual' })
  })

  it('TRAK-360: opening the line-up of a match with none loads the default once, and the step says who isn\'t coming', async () => {
    const user = userEvent.setup()
    store()
    let loads = 0
    server.use(
      http.post(`${SUPABASE_URL}/rest/v1/rpc/load_default_formation`, () => { loads += 1; return HttpResponse.json({ event_id: 'g1', placed: 1, not_coming: 1, skipped: 1, formation: 'Balanced' }) }),
      http.get(`${SUPABASE_URL}/rest/v1/game_plans`, () => HttpResponse.json(loads ? [{ event_id: 'g1', strength: null, scouting: '', goals: [], format: 11, formation: '4-3-3', created_at: '2026-11-07T09:00:00Z', updated_at: '2026-11-07T09:00:00Z' }] : [])),
      http.get(`${SUPABASE_URL}/rest/v1/game_plan_players`, () => HttpResponse.json(loads ? [
        { event_id: 'g1', squad_player_id: 'zagorakis', role: 'starter', slot: 2, job: '', note: '', context: [], expectation: 'usual' },
        { event_id: 'g1', squad_player_id: 'nikopolidis', role: 'not_attending', slot: null, job: '', note: '', context: [], expectation: 'usual' },
      ] : [])),
      table('formation_copies', [{ copied_at: '2026-11-07T09:00:00Z', not_coming: 1, skipped: 1, by_default: true, formations: { name: 'Balanced', format: 11 } }]),
    )
    renderApp('/coach/matches/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
    expect(await screen.findByRole('heading', { name: '4-3-3' })).toBeInTheDocument()
    expect(slot(2)).toHaveAccessibleName(/^Theodoros Zagorakis, slot 2/)
    expect(await screen.findByText('Balanced loaded: your default for 11 a side.')).toBeInTheDocument()
    expect(screen.getByText(/1 player in this formation isn’t coming, so is in Not attending\. 1 player was skipped/)).toBeInTheDocument()
    expect(loads).toBe(1)
    // Back to the first step and in again: it doesn't load a second time.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(await screen.findByRole('button', { name: 'Next: Line-up and jobs' }))
    await screen.findByRole('heading', { name: '4-3-3' })
    expect(loads).toBe(1)
  })

  it('TRAK-358: Everyone\'s job and its count are gone; Review & share counts the starters with a job', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    await pick(user, 1, /^Theodoros Zagorakis/)
    await user.type(screen.getByLabelText('Job · only Theodoros sees it'), 'Command the box on crosses.')
    await pick(user, 2, /^Angelos Basinas/)
    expect(screen.queryByRole('region', { name: 'Everyone’s job' })).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Next: Review & share' }))
    expect(await screen.findByText('1 of 2 starters have one')).toBeInTheDocument()
  })

  it('TRAK-317, TRAK-358: a starter expected to stretch has a yellow ring on the pitch, with a key and "stretch" in the slot\'s name', async () => {
    const user = userEvent.setup()
    store()
    await openLineUp(user)
    // Slot 6 is midfield, where he plays.
    await pick(user, 6, /Zagorakis/)
    expect(slot(6)).toHaveAccessibleName('Theodoros Zagorakis, slot 6')
    expect(slot(6)).not.toHaveAttribute('data-ring')
    await user.click(screen.getByRole('radio', { name: /^Stretch/ }))
    expect(slot(6)).toHaveAccessibleName('Theodoros Zagorakis, slot 6, stretch')
    expect(slot(6)).toHaveAttribute('data-ring', 'stretch')
    expect(within(screen.getByRole('list', { name: 'Key' })).getByText('Stretch')).toBeVisible()
  })

  it('TRAK-329: one formation dropdown on the pitch, a header per format; a shape in a smaller format benches the starters it has no slot for', async () => {
    const user = userEvent.setup()
    const { saves, plans } = store()
    await openLineUp(user)
    expect(screen.queryByRole('region', { name: 'Format and formation' })).toBeNull()
    await pick(user, 10, /^Theodoros Zagorakis/)
    await pick(user, 11, /^Angelos Basinas/)

    const formation = screen.getByRole('combobox', { name: 'Format and shape' })
    expect(formation).toHaveTextContent('4-4-2')
    await user.click(formation)
    const list = await screen.findByRole('listbox', { name: 'Format and shape' })
    expect(within(list).getAllByRole('group').map(group => within(group).getAllByRole('option')[0].textContent)).toEqual(['4-4-2', '3-3-2', '2-3-1', '2-2'])
    for (const name of ['11 a side', '9 a side', '7 a side', '5 a side']) expect(within(list).getByRole('group', { name })).toBeInTheDocument()
    await user.click(within(within(list).getByRole('group', { name: '9 a side' })).getByRole('option', { name: '3-3-2' }))

    expect(await screen.findByRole('heading', { name: '3-3-2' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Format and shape' })).toHaveTextContent('3-3-2')
    // Nine a side has no slots 10 and 11, so those two starters are on the bench.
    expect(screen.queryByRole('button', { name: /slot 10(,|$)/i })).toBeNull()
    expect(within(bench()).getByRole('button', { name: 'Theodoros Zagorakis, bench' })).toBeInTheDocument()
    expect(within(bench()).getByRole('button', { name: 'Angelos Basinas, bench' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(plans.get('g1')).toMatchObject({ format: 9, formation: '3-3-2' })
    expect(saves.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ squad_player_id: 'zagorakis', role: 'bench', slot: null }),
      expect.objectContaining({ squad_player_id: 'basinas', role: 'bench', slot: null }),
    ]))
  })
})
