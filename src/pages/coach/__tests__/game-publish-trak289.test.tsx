/**
 * TRAK-289 (Games 7/8): publishing the evaluation. "Publish" (TRAK-446; "Publish to N players and families" before) waits for every "Did the plan
 * work?" answer, and asks the competition and home or away when the match has none (Imad, 29 Oct). It saves what's on
 * screen, then publishes. The loop closes: the success alert, the game's History, and nothing left to edit. The preview
 * shows what each player and parent will read. TRAK-375 (Imad, 5 Nov): the Publish step is one Evaluation review card,
 * Game plan review's kind, with no preview or "Who sees what"; the published page keeps the preview. Test people are
 * named after footballers.
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
let n = 0
let COACH = { id: 'coach-289' }

/** A Dubai match that kicked off two hours ago and lasted 90 minutes. */
function game(over: Record<string, unknown> = {}) {
  const kickOff = Date.now() - 120 * MINUTE
  const at = new Date(kickOff + 4 * 60 * MINUTE).toISOString()
  return {
    id: 'g1', coach_user_id: COACH.id, squad: 'U16', title: 'vs Parkview Athletic', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(kickOff).toISOString(), ends_at: new Date(kickOff + 90 * MINUTE).toISOString(), created_at: '2026-10-20T08:00:00Z',
    event_date: at.slice(0, 10), start_time: at.slice(11, 19), end_time: null, meet_time: null, competition: 'league',
    opponent: 'Parkview Athletic', home_away: 'home', venue: 'Rehearsal Park', kit: null, kit_snapshot: null,
    family_note: null, notes: null, series_id: null, training_themes: [], cancel_reason: null, ...over,
  }
}
const child = (id: string, name: string, shirt: number) =>
  ({ id, coach_user_id: COACH.id, player_name: name, age_group: 'U16', status: 'active', shirt_number: shirt, position: 'Midfielder', created_at: '2026-10-01T08:00:00Z' })
const PLAN = {
  event_id: 'g1', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: 'Their 9 is quick.', format: 11, formation: '4-4-2',
  goals: [{ title: 'Win the second ball', looks_like: '' }, { title: 'Press their 6', looks_like: '' }],
  created_at: '2026-10-27T09:00:00Z', updated_at: '2026-10-27T09:00:00Z',
}
const LINE_UP = [
  { event_id: 'g1', squad_player_id: 'zagorakis', role: 'starter', slot: 4, job: 'Stay tight to their winger.', note: '', context: ['out_of_position'], expectation: 'stretch' },
  { event_id: 'g1', squad_player_id: 'dellas', role: 'starter', slot: 2, job: 'Win the header.', note: '', context: [], expectation: 'usual' },
]
// Saved at 21:40 in Dubai: 2–1, both starters played, Zagorakis did part of his job above what was asked, with a note.
const DRAFT = { our_score: 2, their_score: 1, goals: [{ scorer: 'zagorakis', assist: null }, { scorer: null, assist: null }],
  how_they_scored: 'A corner.', plan_worked: ['worked', null], saved_at: '2026-10-28T17:40:00Z', published_at: null as string | null }
const PLAYERS = [
  { squad_player_id: 'zagorakis', played: true, did_job: 'partly', against_expectation: 'above' },
  { squad_player_id: 'dellas', played: true, did_job: 'yes', against_expectation: 'met' },
]

let evaluation: typeof DRAFT
let calls: { name: string; args: Record<string, unknown> }[]
function backend(over: Record<string, unknown> = {}, planWorked: (string | null)[] = ['worked', null]) {
  evaluation = { ...DRAFT, plan_worked: planWorked }
  calls = []
  server.use(
    table('coach_calendar_events', [game(over)]),
    table('game_plans', [PLAN]),
    table('game_plan_players', LINE_UP),
    table('game_shares', [{ id: 1, event_id: 'g1', shared_at: '2026-10-27T15:30:00Z', changed: 2 }]),
    http.get(`${SUPABASE_URL}/rest/v1/game_evaluations`, () => HttpResponse.json([evaluation])),
    table('game_evaluation_players', PLAYERS),
    table('game_evaluation_notes', [{ squad_player_id: 'zagorakis', note: 'Brave all game.' }]),
    rpc('save_game_evaluation', args => { calls.push({ name: 'save', args }); evaluation = { ...evaluation, plan_worked: args.p_plan_worked as (string | null)[] }; return evaluation.saved_at }),
    rpc('publish_game_evaluation', args => {
      calls.push({ name: 'publish', args })
      evaluation = { ...evaluation, published_at: new Date().toISOString() }
      return { reviews: 2, logged: 2, skipped: [] }
    }),
  )
}

beforeEach(() => {
  COACH = { id: `coach-289-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [child('zagorakis', 'Theodoros Zagorakis', 7), child('dellas', 'Traianos Dellas', 5)]),
    table('event_confirmations', []),
    table('event_absences', []),
    rpc('coach_squad_player_consent_required', () => false),
    table('coach_assessments', []),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('notification_settings', []),
    table('training_plans', []),
    rpc('game_plan_changes', () => []),
    rpc('feature_on', () => true),
  )
})
afterEach(() => cleanup())

const publishButton = () => within(screen.getByRole('region', { name: 'Evaluation review' })).getByRole('button', { name: 'Publish' })

describe('TRAK-289: publishing the evaluation', { timeout: 30_000 }, () => {
  it('waits for every "Did the plan work?" answer before it publishes', async () => {
    const user = userEvent.setup()
    backend()
    renderApp('/coach/matches/g1?tab=evaluation')
    // TRAK-374 (Imad, 5 Nov): "Did the plan work?" is in Result, with no helper line.
    expect(await screen.findByRole('group', { name: 'Press their 6' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next: Player evaluation' }))
    await user.click(screen.getByRole('button', { name: 'Next: Publish' }))
    // TRAK-375: one review card, each part with its own Edit; no preview and no "Who sees what".
    const card = screen.getByRole('region', { name: 'Evaluation review' })
    const parts = within(within(card).getByRole('list', { name: 'The plan' })).getAllByRole('listitem')
    expect(parts.map(part => part.textContent)).toEqual([
      'ResultWon 2–1 · 1 goal without a scorer',
      'Who played2 played',
      'Did the plan work?1 of 2 answered',
      // TRAK-518: every answer starts empty, so there is no Yes · Met to count changes from; both players are answered.
      'Player evaluation1 note',
    ])
    expect(parts.map(part => within(part).getByRole('img').getAttribute('aria-label'))).toEqual(['Incomplete', 'Ready', 'Needed', 'Ready'])
    expect(within(card).getByRole('img', { name: '2 of 4 parts ready, 2 incomplete' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Who sees what' })).toBeNull()
    expect(publishButton()).toBeDisabled()
    expect(screen.getByText('Answer “Did the plan work?” for every instruction first.')).toBeInTheDocument()

    // Its Edit opens Result, where the question is.
    await user.click(within(card).getByRole('button', { name: 'Edit did the plan work?' }))
    await user.click(within(screen.getByRole('group', { name: 'Press their 6' })).getByRole('radio', { name: 'Partly' }))
    await user.click(screen.getByRole('button', { name: 'Next: Player evaluation' }))
    await user.click(screen.getByRole('button', { name: 'Next: Publish' }))
    expect(within(screen.getByRole('region', { name: 'Evaluation review' })).getByText('2 of 2 answered')).toBeInTheDocument()
    expect(publishButton()).toBeEnabled()
    // Never asked here: the match has its competition and home or away.
    expect(screen.queryByRole('group', { name: 'Competition' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Home or away' })).toBeNull()
  })

  // TRAK-518 (Imad, 20 Nov): every answer starts empty, so Publish waits for each player who played.
  it('waits until every player who played has their answers, and says how many are left', async () => {
    const user = userEvent.setup()
    backend({}, ['worked', 'partly'])
    server.use(table('game_evaluation_players', [PLAYERS[0], { squad_player_id: 'dellas', played: true, did_job: null, against_expectation: null }]))
    renderApp('/coach/matches/g1?tab=evaluation')
    await user.click(await screen.findByRole('button', { name: 'Next: Player evaluation' }))
    expect(screen.getByRole('button', { name: /^Traianos Dellas/ })).toHaveTextContent('Not answered')
    await user.click(screen.getByRole('button', { name: 'Next: Publish' }))
    const card = screen.getByRole('region', { name: 'Evaluation review' })
    const players = within(within(card).getByRole('list', { name: 'The plan' })).getAllByRole('listitem')[3]
    expect(players).toHaveTextContent('Player evaluation1 of 2 answered')
    expect(within(players).getByRole('img').getAttribute('aria-label')).toBe('Needed')
    expect(screen.getByText('1 player still to evaluate.')).toBeInTheDocument()
    expect(publishButton()).toBeDisabled()

    // Dellas had a job, so one answer isn't enough; both are.
    await user.click(within(card).getByRole('button', { name: 'Edit player evaluation' }))
    await user.click(screen.getByRole('button', { name: /^Traianos Dellas/ }))
    const open = screen.getByRole('button', { name: /^Traianos Dellas/ }).closest('article') as HTMLElement
    await user.click(within(within(open).getByRole('group', { name: 'Against expectation' })).getByRole('radio', { name: 'Met' }))
    expect(screen.getByRole('button', { name: /^Traianos Dellas/ })).toHaveTextContent('Not answered')
    await user.click(within(within(open).getByRole('group', { name: 'Did the job?' })).getByRole('radio', { name: 'Yes' }))
    expect(screen.getByRole('button', { name: /^Traianos Dellas/ })).toHaveTextContent('Did the job · Met')
    await user.click(screen.getByRole('button', { name: 'Next: Publish' }))
    expect(screen.queryByText(/still to evaluate/)).toBeNull()
    expect(publishButton()).toBeEnabled()
  })

  it('asks the competition and home or away of a match made without them, and publishes them', async () => {
    const user = userEvent.setup()
    backend({ competition: null, home_away: null }, ['worked', 'partly'])
    renderApp('/coach/matches/g1?tab=evaluation')
    await screen.findByRole('spinbutton', { name: 'Our score' })
    await user.click(screen.getByRole('button', { name: 'Next: Player evaluation' }))
    await user.click(screen.getByRole('button', { name: 'Next: Publish' }))
    expect(publishButton()).toBeDisabled()
    expect(screen.getByText('Select the competition first.')).toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: 'Competition' })).getByRole('radio', { name: 'Friendly' }))
    expect(screen.getByText('Say whether it was home or away first.')).toBeInTheDocument()
    await user.click(within(screen.getByRole('group', { name: 'Home or away' })).getByRole('radio', { name: 'Away' }))
    await user.click(publishButton())
    expect(await screen.findByText('Published to 2 players and their families. The loop is closed.')).toBeInTheDocument()
    expect(calls.map(c => c.name)).toEqual(['save', 'publish'])
    expect(calls[1].args).toEqual({ p_event_id: 'g1', p_competition: 'friendly', p_home_away: 'away' })
  })

  it('once published, the loop is closed: the History, the preview, and nothing left to edit', async () => {
    const user = userEvent.setup()
    backend({}, ['worked', 'partly'])
    renderApp('/coach/matches/g1?tab=evaluation')
    await screen.findByRole('spinbutton', { name: 'Our score' })
    await user.click(screen.getByRole('button', { name: 'Next: Player evaluation' }))
    await user.click(screen.getByRole('button', { name: 'Next: Publish' }))
    await user.click(publishButton())
    expect(await screen.findByText('Published to 2 players and their families. The loop is closed.')).toBeInTheDocument()
    expect(calls[1].args).toEqual({ p_event_id: 'g1', p_competition: null, p_home_away: null })
    expect(screen.getByText('Published')).toBeInTheDocument()
    const history = screen.getByRole('region', { name: 'History' })
    for (const step of ['Match created', 'Plan drafted', 'Plan shared with 2 players', 'Locked at kick-off', 'Evaluation draft saved',
      'Evaluation published. The loop is closed.']) expect(within(history).getByText(step)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save draft/ })).toBeNull()
    expect(screen.queryByRole('spinbutton', { name: 'Our score' })).toBeNull()

    // A reload still shows it closed.
    cleanup()
    renderApp('/coach/matches/g1?tab=evaluation')
    expect(await screen.findByText('Published to 2 players and their families. The loop is closed.')).toBeInTheDocument()
  })

  it('once published, the preview shows each player what they\'ll read, and their parent the score and how it went, never the job or the note (TRAK-319)', async () => {
    const user = userEvent.setup()
    backend({}, ['worked', 'partly'])
    renderApp('/coach/matches/g1?tab=evaluation')
    await screen.findByRole('spinbutton', { name: 'Our score' })
    await user.click(screen.getByRole('button', { name: 'Next: Player evaluation' }))
    await user.click(screen.getByRole('button', { name: 'Next: Publish' }))
    await user.click(publishButton())
    const preview = await screen.findByRole('region', { name: 'Preview' })
    // It opens on the first player in line-up order, Dellas.
    expect(within(preview).getByRole('region', { name: 'After the match' })).toHaveTextContent('You did your job')
    await user.click(within(preview).getByRole('combobox', { name: 'Player' }))
    await user.click(await screen.findByRole('option', { name: 'Theodoros Zagorakis' }))
    const after = within(preview).getByRole('region', { name: 'After the match' })
    expect(after).toHaveTextContent('Final score 2–1')
    expect(after).toHaveTextContent('Your job')
    expect(after).toHaveTextContent('You did part of your job')
    expect(after).toHaveTextContent('What we asked: A big ask today. A solid job is a good game. (out of position)')
    expect(after).toHaveTextContent('Went beyond what we asked.')
    expect(within(after).getByRole('heading', { name: 'From Coach Otto Rehhagel · just for you' })).toBeInTheDocument()
    expect(after).toHaveTextContent('Brave all game.')

    await user.click(within(preview).getByRole('button', { name: 'As the parent' }))
    const parent = within(preview).getByRole('region', { name: 'After the match' })
    expect(parent).toHaveTextContent('Final score 2–1')
    expect(parent).toHaveTextContent('Went beyond what we asked.')
    expect(parent).not.toHaveTextContent(/’s job|Your job|You did|note is just for|Brave all game/)
  })
})
