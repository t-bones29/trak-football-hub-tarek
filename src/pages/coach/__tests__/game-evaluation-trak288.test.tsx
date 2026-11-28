/**
 * TRAK-288 (Games 6/8): the evaluation as a draft. It opens at full time and not before, on the event's instant, with no
 * reload. Its steps read against the plan as it locked at kick-off; every answer starts empty (TRAK-518). Save draft saves every
 * step in one go, never publishes, and the draft reloads on every step. TRAK-374 (Imad, 5 Nov): Result · Player
 * evaluation · Publish, "Did the plan work?" in Result, any step from the stepper, "How they scored" only when they
 * scored, each player's job, "Did the job?" No · Partly · Yes, and a Draft badge in place of the alert, the moon and
 * "sleep on it". Test people are named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, within } from '@testing-library/react'
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
let n = 0
let COACH = { id: 'coach-288' }

/** A match that kicked off `ago` ms before now and lasts 90 minutes, on the academy's clock (Dubai, UTC+4). */
function game(ago: number) {
  const kickOff = Date.now() - ago
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(),
    event_date: at.slice(0, 10), start_time: at.slice(11, 19), end_time: null, meet_time: null, competition: 'league',
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null,
  }
}
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })
const PLAN = {
  event_id: 'g1', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: '', format: 11, formation: '4-4-2',
  goals: [{ title: 'Win the second ball', looks_like: 'First to every loose ball.' }, { title: 'Press their 6', looks_like: '' }],
  created_at: '2026-10-28T09:00:00Z', updated_at: '2026-10-28T09:00:00Z',
}
// At kick-off: Zagorakis and Dellas started, Charisteas was on the bench (no row: the bench by default), Karagounis left out.
const LINE_UP = [
  { event_id: 'g1', squad_player_id: 'zagorakis', role: 'starter', slot: 4, job: 'Stay tight.', note: '', context: ['out_of_position'], expectation: 'stretch' },
  { event_id: 'g1', squad_player_id: 'dellas', role: 'starter', slot: 2, job: 'Win the header.', note: '', context: [], expectation: 'usual' },
  { event_id: 'g1', squad_player_id: 'karagounis', role: 'not_selected', slot: null, job: '', note: '', context: [], expectation: 'usual' },
]
const SAVED_AT = '2026-10-28T17:40:00Z' // 21:40 in Dubai

type Store = { evaluation: Record<string, unknown> | null; players: Record<string, unknown>[]; notes: Record<string, unknown>[] }
let store: Store
let sent: Record<string, unknown>[]

/** The evaluation tables answer with what the last save wrote, as save_game_evaluation would. */
function backend(ago: number, refuse?: string) {
  server.use(
    table('coach_calendar_events', [game(ago)]),
    table('game_plans', [PLAN]),
    table('game_plan_players', LINE_UP),
    http.get(`${SUPABASE_URL}/rest/v1/game_evaluations`, () => HttpResponse.json(store.evaluation ? [store.evaluation] : [])),
    http.get(`${SUPABASE_URL}/rest/v1/game_evaluation_players`, () => HttpResponse.json(store.players)),
    http.get(`${SUPABASE_URL}/rest/v1/game_evaluation_notes`, () => HttpResponse.json(store.notes)),
    rpc('save_game_evaluation', args => {
      sent.push(args)
      if (refuse) return { status: 400, body: { code: 'P0001', message: refuse } }
      const players = args.p_players as { id: string; played: boolean; did_job?: string; against_expectation?: string; note?: string }[]
      store = {
        evaluation: { our_score: args.p_our_score, their_score: args.p_their_score, goals: args.p_goals, how_they_scored: args.p_how_they_scored,
          plan_worked: args.p_plan_worked, saved_at: SAVED_AT, published_at: null },
        // TRAK-518: as save_game_evaluation keeps it, an answer not given stays empty.
        players: players.map(p => ({ squad_player_id: p.id, played: p.played, did_job: p.did_job ?? null, against_expectation: p.against_expectation ?? null })),
        notes: players.filter(p => p.note).map(p => ({ squad_player_id: p.id, note: p.note })),
      }
      return SAVED_AT
    }),
  )
}

beforeEach(() => {
  COACH = { id: `coach-288-${++n}` }
  store = { evaluation: null, players: [], notes: [] }
  sent = []
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('zagorakis', 'Theodoros Zagorakis', 7), child('dellas', 'Traianos Dellas', 5),
      child('charisteas', 'Angelos Charisteas', 9), child('karagounis', 'Giorgos Karagounis', 10)]),
    table('event_confirmations', []),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    table('training_plans', []),
    table('game_shares', [{ event_id: 'g1', shared_at: '2026-10-27T15:30:00Z' }]),
    rpc('game_plan_changes', () => []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => { vi.useRealTimers(); cleanup(); localStorage.clear() })

const next = (label: string) => userEvent.click(screen.getByRole('button', { name: label }))
/** A player's card. jsdom ignores `inert`, so a closed card's fields are still found: ask inside the open one. */
const cardOf = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) }).closest('article') as HTMLElement

describe('TRAK-288: the evaluation draft', { timeout: 30_000 }, () => {
  it('opens at full time and not before, with the page left open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    backend(89 * MINUTE) // full time in a minute
    renderApp('/coach/matches/g1?tab=evaluation')
    expect(await screen.findByRole('heading', { name: /^Opens at full time, \d\d:\d\d$/ })).toBeInTheDocument()
    // TRAK-516 (Imad, 20 Nov): no line under it explaining the evaluation.
    expect(screen.queryByText(/whether the plan worked, and each player/)).toBeNull()
    expect(screen.queryByRole('spinbutton', { name: 'Our score' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Save draft/ })).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })

    expect(await screen.findByRole('spinbutton', { name: 'Our score' })).toBeInTheDocument()
    expect(screen.getByText('Full time')).toBeInTheDocument()
  })

  it('lists who played from the plan as it locked: starters ticked, the bench unticked, nobody left out', async () => {
    backend(120 * MINUTE)
    renderApp('/coach/matches/g1?tab=evaluation')
    const played = await screen.findByRole('region', { name: 'Who played' })
    // TRAK-446: no helper line under the title.
    expect(within(played).queryByText(/Untick a starter|Tick everyone who played/)).toBeNull()
    expect(within(within(played).getByRole('group', { name: 'Started' })).getAllByRole('checkbox').map(box => box.getAttribute('aria-checked')))
      .toEqual(['true', 'true'])
    expect(within(played).getByRole('checkbox', { name: 'Traianos Dellas' })).toBeChecked()
    expect(within(within(played).getByRole('group', { name: 'Came on' })).getByRole('checkbox', { name: 'Angelos Charisteas' })).not.toBeChecked()
    expect(within(played).queryByRole('checkbox', { name: 'Giorgos Karagounis' })).toBeNull()
  })

  // TRAK-518 (Imad, 20 Nov): nothing is selected until the coach selects it.
  it('every answer starts empty, beside the context and expectation from the plan', async () => {
    const user = userEvent.setup()
    backend(120 * MINUTE)
    renderApp('/coach/matches/g1?tab=evaluation')
    await screen.findByRole('spinbutton', { name: 'Our score' })
    await next('Next: Player evaluation')
    expect(screen.queryByText(/Everyone starts at/)).toBeNull()
    const card = screen.getByRole('button', { name: /^Theodoros Zagorakis/ })
    expect(card).toHaveTextContent('Not answered')
    expect(card).toHaveTextContent('Out of position')
    expect(card).toHaveTextContent('Expected: Stretch')
    expect(screen.getByRole('button', { name: /^Traianos Dellas/ })).toHaveTextContent('Expected: Usual')
    // Charisteas didn't come on, so there's no card for him.
    expect(screen.queryByRole('button', { name: /^Angelos Charisteas/ })).toBeNull()
    await user.click(card)
    const open = cardOf('Theodoros Zagorakis')
    // TRAK-374: his job from the plan, to judge against; "Did the job?" reads No, Partly, Yes.
    expect(within(open).getByText('Stay tight.')).toBeInTheDocument()
    const didJob = within(open).getByRole('group', { name: 'Did the job?' })
    expect(within(didJob).getAllByRole('radio').map(radio => radio.getAttribute('aria-label') ?? radio.closest('label')?.textContent)).toEqual(['No', 'Partly', 'Yes'])
    for (const radio of within(didJob).getAllByRole('radio')) expect(radio).not.toBeChecked()
    for (const radio of within(within(open).getByRole('group', { name: 'Against expectation' })).getAllByRole('radio')) expect(radio).not.toBeChecked()
    expect(within(open).getByRole('textbox', { name: 'Note to Theodoros' }).getAttribute('placeholder')).toMatch(/^e\.g\. /)
  })

  it('saves every step in one draft that only the coach sees, and it reloads on every step', async () => {
    // The evening the draft is saved (21:40 in Dubai), so the alert reads its time alone (TRAK-290: another day's adds
    // the weekday).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T18:00:00Z'))
    const user = userEvent.setup()
    backend(120 * MINUTE)
    renderApp('/coach/matches/g1?tab=evaluation')
    // Result: 2–1, Zagorakis scored the first, Dellas didn't play, Charisteas came on.
    await user.click(await screen.findByRole('button', { name: 'Increase Our score' }))
    await user.click(screen.getByRole('button', { name: 'Increase Our score' }))
    await user.click(screen.getByRole('button', { name: 'Increase Their score' }))
    const goals = screen.getAllByRole('group', { name: /^Goal \d$/ })
    expect(goals).toHaveLength(2)
    await user.click(within(goals[0]).getByRole('combobox', { name: 'Scored by' }))
    await user.click(await screen.findByRole('option', { name: 'Theodoros Zagorakis' }))
    await user.click(screen.getByRole('checkbox', { name: 'Traianos Dellas' }))
    await user.click(screen.getByRole('checkbox', { name: 'Angelos Charisteas' }))
    await user.type(screen.getByRole('textbox', { name: 'How their goals came' }), 'A corner at the back post.')
    // TRAK-374: "Did the plan work?" is in Result: the first instruction worked.
    await user.click(within(screen.getByRole('group', { name: 'Win the second ball' })).getByRole('radio', { name: 'Worked' }))
    expect(screen.getByRole('group', { name: 'Press their 6' })).toBeInTheDocument()
    expect(screen.queryByText(/One answer for each instruction/)).toBeNull()
    // Player evaluation: Zagorakis did part of the job, above what was expected, with a note.
    await next('Next: Player evaluation')
    expect(screen.queryByRole('button', { name: /^Traianos Dellas/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Theodoros Zagorakis/ }))
    const open = cardOf('Theodoros Zagorakis')
    await user.click(within(within(open).getByRole('group', { name: 'Did the job?' })).getByRole('radio', { name: 'Partly' }))
    await user.click(within(within(open).getByRole('group', { name: 'Against expectation' })).getByRole('radio', { name: 'Above' }))
    await user.type(within(open).getByRole('textbox', { name: 'Note to Theodoros' }), 'Brave all game.')
    expect(screen.getByRole('button', { name: /^Theodoros Zagorakis/ })).toHaveTextContent('Did part of the job · Above')

    // TRAK-374: no moon, no "sleep on it", no "only you see it", and no "Draft saved" alert. TRAK-448: no Draft badge
    // at the bottom either; the match's state sits beside the title.
    expect(screen.queryByText('Draft', { exact: true })).toBeNull()
    expect(screen.queryByText(/only you see it|sleep on it/i)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(screen.getByText('Evaluation draft')).toBeInTheDocument()
    expect(screen.queryByText(/^Draft saved|Only you can see it\.|Good morning/)).toBeNull()
    expect(sent).toEqual([{
      p_event_id: 'g1', p_our_score: 2, p_their_score: 1, p_how_they_scored: 'A corner at the back post.', p_plan_worked: ['worked', null],
      p_goals: [{ scorer: 'zagorakis', assist: null }, { scorer: null, assist: null }],
      p_players: [
        { id: 'dellas', played: false },
        { id: 'zagorakis', played: true, did_job: 'partly', against_expectation: 'above', note: 'Brave all game.' },
        // TRAK-518: not answered yet, so nothing is sent as answered.
        { id: 'charisteas', played: true, did_job: null, against_expectation: null, note: '' },
      ],
    }])

    // A reload shows the draft on every step.
    cleanup()
    renderApp('/coach/matches/g1?tab=evaluation')
    expect(await screen.findByRole('spinbutton', { name: 'Our score' })).toHaveAttribute('aria-valuenow', '2')
    expect(screen.getByRole('spinbutton', { name: 'Their score' })).toHaveAttribute('aria-valuenow', '1')
    expect(within(screen.getAllByRole('group', { name: /^Goal \d$/ })[0]).getByRole('combobox', { name: 'Scored by' })).toHaveTextContent('Theodoros Zagorakis')
    expect(screen.getByRole('checkbox', { name: 'Traianos Dellas' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Angelos Charisteas' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: 'How their goals came' })).toHaveValue('A corner at the back post.')
    expect(within(screen.getByRole('group', { name: 'Win the second ball' })).getByRole('radio', { name: 'Worked' })).toBeChecked()
    await next('Next: Player evaluation')
    expect(screen.getByRole('button', { name: /^Theodoros Zagorakis/ })).toHaveTextContent('Did part of the job · Above')
    // TRAK-518: the draft keeps exactly what was answered: nothing yet for Charisteas.
    expect(screen.getByRole('button', { name: /^Angelos Charisteas/ })).toHaveTextContent('Not answered')
    await user.click(screen.getByRole('button', { name: /^Theodoros Zagorakis/ }))
    expect(screen.getByRole('textbox', { name: 'Note to Theodoros' })).toHaveValue('Brave all game.')
  })

  // TRAK-519 (Imad, 21 Nov): "Came on" stays for who came off the bench; a starter who didn't show is swapped for who
  // started in their place.
  it('puts who started in place of a no-show under Started, and saves who started for whom', async () => {
    const user = userEvent.setup()
    backend(120 * MINUTE)
    renderApp('/coach/matches/g1?tab=evaluation')
    const played = await screen.findByRole('region', { name: 'Who played' })
    expect(within(played).queryByRole('combobox', { name: /^Started instead of/ })).toBeNull()
    await user.click(within(played).getByRole('checkbox', { name: 'Traianos Dellas' }))
    await user.click(within(played).getByRole('combobox', { name: 'Started instead of Traianos' }))
    await user.click(await screen.findByRole('option', { name: 'Angelos Charisteas' }))
    expect(within(played).getByRole('combobox', { name: 'Started instead of Traianos' })).toHaveTextContent('Angelos Charisteas')
    // He started, so he isn't under Came on, which has nobody else here.
    expect(within(played).queryByRole('group', { name: 'Came on' })).toBeNull()
    await next('Next: Player evaluation')
    // He started, so his card comes first, in Dellas's place.
    expect(screen.getAllByRole('button', { name: /^(Traianos Dellas|Theodoros Zagorakis|Angelos Charisteas)/ })
      .map(button => button.textContent?.match(/^(Traianos Dellas|Theodoros Zagorakis|Angelos Charisteas)/)?.[0]))
      .toEqual(['Angelos Charisteas', 'Theodoros Zagorakis'])
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect((sent[0].p_players as { id: string }[]).find(p => p.id === 'charisteas')).toMatchObject({ played: true, started_for: 'dellas' })
  })

  it('TRAK-374: three steps, any of them from the stepper, ahead too', async () => {
    const user = userEvent.setup()
    backend(120 * MINUTE)
    renderApp('/coach/matches/g1?tab=evaluation')
    await screen.findByRole('spinbutton', { name: 'Our score' })
    const steps = screen.getByRole('navigation', { name: 'Evaluation' })
    expect(within(steps).getAllByRole('button').map(step => step.textContent?.replace(/, Not started$/, ''))).toEqual(['1Result', '2Player evaluation', '3Publish'])
    await user.click(within(steps).getByRole('button', { name: /Publish/ }))
    expect(within(await screen.findByRole('region', { name: 'Evaluation review' })).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
    await user.click(within(steps).getByRole('button', { name: /Player evaluation/ }))
    expect(screen.getByRole('button', { name: /^Theodoros Zagorakis/ })).toBeInTheDocument()
  })

  it('TRAK-374: "How they scored" only once they scored, with the lock; back to 0, what was typed isn\'t saved', async () => {
    const user = userEvent.setup()
    backend(120 * MINUTE)
    renderApp('/coach/matches/g1?tab=evaluation')
    await screen.findByRole('spinbutton', { name: 'Our score' })
    expect(screen.queryByRole('region', { name: 'How they scored' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Increase Their score' }))
    const how = screen.getByRole('region', { name: 'How they scored' })
    const lock = within(how).getByRole('button', { name: 'Who sees how they scored' })
    await user.pointer({ keys: '[TouchA]', target: lock })
    await screen.findByRole('tooltip')
    expect(lock).toHaveAccessibleDescription('Only you can see this')
    await user.pointer({ keys: '[TouchA]', target: lock })
    await user.type(within(how).getByRole('textbox', { name: 'How their goals came' }), 'A long throw.')
    await user.click(screen.getByRole('button', { name: 'Decrease Their score' }))
    expect(screen.queryByRole('region', { name: 'How they scored' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    await screen.findByRole('button', { name: 'Saved' })
    expect(sent[0]).toMatchObject({ p_their_score: 0, p_how_they_scored: '' })
  })

  it('TRAK-374: a plan with no instructions asks nothing about them', async () => {
    backend(120 * MINUTE)
    server.use(table('game_plans', [{ ...PLAN, goals: [] }]))
    renderApp('/coach/matches/g1?tab=evaluation')
    await screen.findByRole('spinbutton', { name: 'Our score' })
    expect(screen.queryByRole('region', { name: 'Did the plan work?' })).toBeNull()
  })

  it('a refused save keeps everything entered and says why', async () => {
    const user = userEvent.setup()
    backend(120 * MINUTE, 'This evaluation is published, so it can’t change')
    renderApp('/coach/matches/g1?tab=evaluation')
    await user.click(await screen.findByRole('button', { name: 'Increase Our score' }))
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This evaluation is published, so it can’t change')
    expect(screen.getByRole('spinbutton', { name: 'Our score' })).toHaveAttribute('aria-valuenow', '1')
  })
})
