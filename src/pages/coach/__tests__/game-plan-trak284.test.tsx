/**
 * TRAK-284 (Games 2/8): plan step 1, saved as a draft only the coach sees. The draft saves and reloads; a fourth
 * instruction can't be added; a failed save keeps the form. TRAK-328 (Imad, 2 Nov): the step is Tactics & analysis, the
 * goals are Instructions, their line-up is gone, and a lock says who sees how strong they are. Switching tabs keeps
 * what was typed: e2e/games.spec.ts checks that in a browser, where the panel's exit animation runs. Test people are
 * named after footballers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
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
let COACH = { id: 'coach-284' }

/** A Dubai academy's match five days out (UTC+4 all year). */
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

/** game_plans as the database keeps it for this coach: one row per match, written by the app's upsert. */
function plans({ failSaves = false } = {}) {
  const store = new Map<string, Record<string, unknown>>()
  const saves: Record<string, unknown>[] = []
  const state = { failSaves }
  server.use(
    // TRAK-363: the plan's Instructions offer the squad's season objectives.
    table('season_plans', []),
    http.get(`${SUPABASE_URL}/rest/v1/game_plans`, ({ request }) => {
      const id = new URL(request.url).searchParams.get('event_id')?.replace('eq.', '')
      return HttpResponse.json([...store.values()].filter(row => !id || row.event_id === id))
    }),
    http.post(`${SUPABASE_URL}/rest/v1/game_plans`, async ({ request }) => {
      if (state.failSaves) return HttpResponse.json({ message: 'Failed to fetch' }, { status: 503 })
      const body = await request.json() as Record<string, unknown>
      saves.push(body)
      store.set(body.event_id as string, { ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return new HttpResponse(null, { status: 201 })
    }),
  )
  return { saves, state }
}

beforeEach(() => {
  COACH = { id: `coach-284-${++n}` }
  signInAs(COACH)
  server.use(
    table('profiles', [{ id: 'p', user_id: COACH.id, role: 'coach', full_name: 'Otto Rehhagel', invite_code: 'ABCD' }]),
    table('coach_details', [{ user_id: COACH.id, coach_role: 'Head Coach', team: 'U16', organization_id: 'org-1' }]),
    table('organizations', [{ id: 'org-1', name: 'Rehearsal FC', logo_url: null }]),
    table('squad_players', [{ id: 'sp-1', coach_user_id: COACH.id, player_name: 'Angelos Charisteas', age_group: 'U16', status: 'active' }]),
    table('coach_sessions', []),
    table('session_attendance', []),
    table('event_absences', []),
    table('coach_calendar_events', [game()]),
    table('game_plan_players', []),
    table('event_confirmations', []),
    table('coach_assessments', []),
    rpc('coach_squad_player_consent_required', () => false),
    rpc('feature_on', () => true),
    // TRAK-288: no evaluation yet.
    table('game_evaluations', []),
    table('game_evaluation_players', []),
    table('game_evaluation_notes', []),
    table('game_shares', []),
    rpc('game_plan_changes', () => []),
  )
})
afterEach(() => { cleanup(); localStorage.clear() })

const instruction = (number: number) => screen.getByRole('group', { name: `Instruction ${number}` })
/** The match header's status, beside its title. */
const status = () => screen.getByRole('heading', { level: 1 }).parentElement!

describe('TRAK-284, TRAK-328: plan step 1, Tactics & analysis', { timeout: 30_000 }, () => {
  it('saves a draft only the coach sees, and it comes back when the page opens again', async () => {
    const user = userEvent.setup()
    const { saves } = plans()
    renderApp('/coach/matches/g1?tab=plan')
    expect(await screen.findByRole('heading', { name: 'Instructions' })).toBeInTheDocument()
    expect(screen.getByText('Plan not written')).toBeInTheDocument()
    const steps = screen.getByRole('navigation', { name: 'Game plan' })
    expect(steps).toHaveTextContent(/Tactics & analysis.*Line-up and jobs.*Review & share/)
    expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent('Tactics & analysis')
    // TRAK-448: no Draft badge beside Next; the match's state sits beside the title. No "only you see it".
    expect(within(screen.getByRole('button', { name: 'Next: Line-up and jobs' }).parentElement!).queryByText('Draft')).toBeNull()
    expect(screen.queryByText(/only you see it/)).toBeNull()
    // TRAK-328 (Imad, 2 Nov): no empty instruction until the coach adds one, and their line-up is gone.
    expect(screen.queryByRole('group', { name: /^Instruction \d$/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Their likely line-up' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Their formation' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Add instruction' }))
    await user.type(within(instruction(1)).getByLabelText('Instruction'), 'Win it back in their half')
    await user.type(within(instruction(1)).getByLabelText('What it looks like'), 'Press when their keeper plays short.')
    await user.click(screen.getByRole('radio', { name: /Stronger/ }))
    await user.type(screen.getByLabelText('What you know about them'), 'Their keeper plays short.')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    // Their line-up is never written, so what an earlier plan saved there stays as it was.
    expect(saves).toEqual([{
      event_id: 'g1', strength: 'stronger', scouting: 'Their keeper plays short.',
      goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }],
      format: 11, formation: null,
    }])
    expect(await within(status()).findByText('Draft')).toBeInTheDocument()

    await user.type(screen.getByLabelText('What you know about them'), ' Their 7 drifts inside.')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()

    cleanup()
    renderApp('/coach/matches/g1?tab=plan')
    expect(await screen.findByDisplayValue('Win it back in their half')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Stronger/ })).toBeChecked()
    expect(screen.getByLabelText('What you know about them')).toHaveValue('Their keeper plays short.')
    expect(within(status()).getByText('Draft')).toBeInTheDocument()
  })

  it('takes up to three instructions: a fourth can\'t be added, and any can be removed, the last one too', async () => {
    const user = userEvent.setup()
    plans()
    renderApp('/coach/matches/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Add instruction' }))
    await user.click(screen.getByRole('button', { name: 'Add instruction' }))
    await user.click(screen.getByRole('button', { name: 'Add instruction' }))
    expect(screen.getAllByRole('group', { name: /^Instruction \d$/ })).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Add instruction' })).toBeNull()

    await user.type(within(instruction(3)).getByLabelText('Instruction'), 'Keeper owns the box')
    await user.click(screen.getByRole('button', { name: 'Remove instruction 2' }))
    expect(screen.getAllByRole('group', { name: /^Instruction \d$/ })).toHaveLength(2)
    expect(within(instruction(2)).getByLabelText('Instruction')).toHaveValue('Keeper owns the box')
    expect(screen.getByRole('button', { name: 'Add instruction' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove instruction 2' }))
    await user.click(screen.getByRole('button', { name: 'Remove instruction 1' }))
    expect(screen.queryByRole('group', { name: /^Instruction \d$/ })).toBeNull()
  })

  it('a failed save keeps everything typed and says so; saving again works', async () => {
    const user = userEvent.setup()
    const { saves, state } = plans({ failSaves: true })
    renderApp('/coach/matches/g1?tab=plan')
    await user.click(await screen.findByRole('button', { name: 'Add instruction' }))
    await user.type(within(instruction(1)).getByLabelText('Instruction'), 'Switch play to the free side')
    await user.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the plan. Check your connection and try again; everything you typed is still here.")
    expect(within(instruction(1)).getByLabelText('Instruction')).toHaveValue('Switch play to the free side')
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument()
    expect(screen.getByText('Plan not written')).toBeInTheDocument()

    state.failSaves = false
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(saves).toHaveLength(1)
  })

  it('how strong they are has no extra words; a lock says only the coach sees it, on focus and on a tap (TRAK-328)', async () => {
    const user = userEvent.setup()
    plans()
    renderApp('/coach/matches/g1?tab=plan')
    const card = await screen.findByRole('region', { name: 'How strong are Parkview Athletic?' })
    expect(card).not.toHaveTextContent('Only you see this')
    expect(within(card).queryByText('Strength')).toBeNull()
    expect(within(card).getByRole('group', { name: 'How strong are Parkview Athletic?' })).toBeInTheDocument()
    const lock = within(card).getByRole('button', { name: 'Who sees how strong they are' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => lock.focus())
    await screen.findByRole('tooltip')
    expect(lock).toHaveAccessibleDescription('Only you can see this')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())

    // A phone has no hover: a tap opens it, and another tap closes it.
    await user.pointer({ keys: '[TouchA]', target: lock })
    await screen.findByRole('tooltip')
    expect(lock).toHaveAccessibleDescription('Only you can see this')
    await user.pointer({ keys: '[TouchA]', target: lock })
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('TRAK-337: Scouting has the same lock, in place of its "Only you" badge', async () => {
    const user = userEvent.setup()
    plans()
    renderApp('/coach/matches/g1?tab=plan')
    const card = await screen.findByRole('region', { name: 'Scouting' })
    expect(within(card).queryByText('Only you')).toBeNull()
    const lock = within(card).getByRole('button', { name: 'Who sees scouting' })
    await user.pointer({ keys: '[TouchA]', target: lock })
    await screen.findByRole('tooltip')
    expect(lock).toHaveAccessibleDescription('Only you can see this')
  })
})
