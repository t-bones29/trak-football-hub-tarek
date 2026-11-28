import { test, expect, devices, type BrowserContext, type Locator, type Page } from '@playwright/test'

// TRAK-283 (Games 1/8): Games home and a game's page with the academy's games switch on, at a phone's and a
// laptop's width: no sideways scroll, and the keyboard reaches every control. TRAK-284: plan step 1, opponent and
// goals, saved as a draft; what was typed survives a look at another tab. Production build, synthetic intercepted
// backend; test people are named after footballers.
test.use({ timezoneId: 'Asia/Dubai' })

const COACH = '97283000-0000-4000-8000-000000000001'
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** A Dubai academy's match (UTC+4 all year): the wall clock typed and its instant. */
function match(id: string, squad: string | null, days: number, hhmm: string, over: Record<string, unknown> = {}) {
  const date = new Date(Date.now() + 4 * 60 * MINUTE + days * DAY).toISOString().slice(0, 10)
  const starts = Date.parse(`${date}T${hhmm}:00+04:00`)
  return {
    id, coach_user_id: COACH, squad, title: 'Match', event_type: 'match', published: true, status: 'scheduled',
    starts_at: new Date(starts).toISOString(), ends_at: new Date(starts + 90 * MINUTE).toISOString(), event_date: date,
    start_time: `${hhmm}:00`, end_time: null, meet_time: null, opponent: 'Synthetic Rovers U16', home_away: 'home',
    venue: 'Rehearsal Park', kit: 'Blue shirts', kit_snapshot: null, family_note: 'Bring water', notes: null, series_id: null,
    training_themes: [], cancel_reason: null, source: 'manual', organization_id: 'org-283', ...over,
  }
}
const MATCHES = [
  match('m-next', 'U16', 3, '11:00', { opponent: 'Parkview Athletic U16' }),
  match('m-draft', 'U14', 6, '17:30', { opponent: 'Synthetic United U14', published: false, home_away: 'away', venue: 'United Ground' }),
  match('m-past', 'U16', -5, '10:00', { opponent: 'Lakeside FC U16' }),
  match('m-old', null, -12, '18:00', { opponent: 'Riverside Academy' }),
]
// TRAK-285: Greece's Euro 2004 squad as the U16 roster; Karagounis is U14. Zagorakis to Basinas are confirmed, and
// Nikopolidis's family said he can't make it.
const players = [['Theodoros Zagorakis', 'U16'], ['Angelos Charisteas', 'U16'], ['Giorgos Karagounis', 'U14'], ['Traianos Dellas', 'U16'],
  ['Giourkas Seitaridis', 'U16'], ['Michalis Kapsis', 'U16'], ['Takis Fyssas', 'U16'], ['Angelos Basinas', 'U16'],
  ['Antonios Nikopolidis', 'U16'], ['Kostas Katsouranis', 'U16'], ['Stelios Giannakopoulos', 'U16'], ['Zisis Vryzas', 'U16'],
  ['Vasilios Tsiartas', 'U16'], ['Demis Nikolaidis', 'U16']].map(([name, squad], i) => ({
  id: `sq-${i + 1}`, coach_user_id: COACH, player_name: name, position: 'Midfielder', age_group: squad, shirt_number: i + 1,
  status: 'active', linked_player_id: null, created_at: '2026-10-01T08:00:00Z',
}))
const CONFIRMED = ['sq-1', 'sq-2', 'sq-4', 'sq-5', 'sq-6', 'sq-7', 'sq-8'].map(squad_player_id => ({ squad_player_id }))
const ABSENT = [{ squad_player_id: 'sq-9' }]

/** game_plans as the database keeps them: one row per match, written by the app's upsert. TRAK-285: the line-up rows
 *  go under `line-up:<match>:<squad row>`. TRAK-286: a share under `share:<match>`, as share_game_plan logs it. */
type Plans = Map<string, Record<string, unknown>>
// TRAK-286: Theodoros Zagorakis (sq-1) signs in as a player to read the shared plan.
const PLAYER = '97283000-0000-4000-8000-000000000002'

async function backend(context: BrowserContext, unexpected: string[], plans: Plans, me = COACH) {
  const user = { id: me, email: 'coach@games283.test', email_confirmed_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: me, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-games283-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const json = (rows: unknown) => route.fulfill({ contentType: 'application/json', headers: { 'content-range': '0-0/1' },
      body: JSON.stringify(single && Array.isArray(rows) ? rows[0] ?? null : rows) })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles') {
      const asked = url.searchParams.get('user_id') ?? ''
      // A player reads only their own profile, never their coach's (TRAK-300): the note's name comes with the copy.
      return json([{ user_id: COACH, id: COACH, role: 'coach', full_name: 'Fernando Santos' },
        { user_id: PLAYER, id: PLAYER, role: 'player', full_name: 'Theodoros Zagorakis' }]
        .filter(profile => asked.includes(profile.user_id) && (me === COACH || profile.user_id === me)))
    }
    // TRAK-286: what Share wrote for Theodoros, and the share itself.
    if (path === '/rest/v1/rpc/child_events') {
      const id = url.searchParams.get('id')?.replace(/^eq\./, '')
      return json(MATCHES.filter(m => m.published && (!id || m.id === id)))
    }
    // TRAK-319: the family's copy holds the role only; the job is in the child's own copy, and a starter gets no note.
    if (path === '/rest/v1/game_for_family') return json(plans.has('share:m-next') ? [{ event_id: 'm-next', squad_player_id: 'sq-1',
      role: 'starter', job: '', has_note: false, changed_at: null, coach_name: 'Fernando Santos' }] : [])
    if (path === '/rest/v1/game_for_player') return json(plans.has('share:m-next') ? [{ event_id: 'm-next', squad_player_id: 'sq-1',
      goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }],
      job: 'Stay tight to their winger.', note: '', changed_at: null }] : [])
    // TRAK-441: the line-up the squad's players read: names and places only. sq-1 is the player himself.
    if (path === '/rest/v1/game_lineup_for_players') return json(plans.has('share:m-next') ? [
      ...['Antonios Nikopolidis', 'Takis Fyssas', 'Traianos Dellas', 'Michalis Kapsis', 'Giourkas Seitaridis', 'Stelios Giannakopoulos',
        'Theodoros Zagorakis', 'Kostas Katsouranis', 'Giorgos Karagounis', 'Angelos Charisteas', 'Zisis Vryzas'].map((name, i) => (
        { event_id: 'm-next', squad_player_id: i === 4 ? 'sq-1' : `sq-xi-${i}`, role: 'starter', slot: i + 1, name, formation: '4-4-2' })),
      ...['Angelos Basinas', 'Vassilios Tsiartas', 'Dimitrios Papadopoulos'].map((name, i) => (
        { event_id: 'm-next', squad_player_id: `sq-bench-${i}`, role: 'bench', slot: null, name, formation: '4-4-2' })),
    ] : [])
    // TRAK-288: the evaluation draft as save_game_evaluation keeps it, under `evaluation:<match>`.
    if (path === '/rest/v1/rpc/save_game_evaluation') {
      const body = req.postDataJSON() as Record<string, unknown>
      const saved_at = new Date().toISOString()
      plans.set(`evaluation:${body.p_event_id}`, { ...body, saved_at })
      return json(saved_at)
    }
    // TRAK-289: publishing marks the draft published and writes Theodoros's review (sq-1), as publish_game_evaluation does.
    if (path === '/rest/v1/rpc/publish_game_evaluation') {
      const body = req.postDataJSON() as { p_event_id: string }
      const draft = plans.get(`evaluation:${body.p_event_id}`)!
      plans.set(`evaluation:${body.p_event_id}`, { ...draft, published_at: new Date().toISOString() })
      const played = (draft.p_players as { played: boolean }[]).filter(p => p.played).length
      return json({ reviews: played, logged: 0, skipped: [] })
    }
    if (path === '/rest/v1/game_review_for_family' || path === '/rest/v1/game_review_for_player') {
      const draft = [...plans.entries()].find(([key, value]) => key.startsWith('evaluation:') && value.published_at)?.[1]
      const own = (draft?.p_players as { id: string; played: boolean; did_job?: string; against_expectation?: string; note?: string }[] | undefined)
        ?.find(p => p.id === 'sq-1' && p.played)
      if (!draft || !own) return json([])
      const line = (plans.get(`line-up:${draft.p_event_id}:sq-1`) ?? {}) as { job?: string; context?: string[]; expectation?: string }
      // TRAK-319: the job, did the job and the note are in the child's own row; the family's has neither.
      return json(path.endsWith('for_player') ? [{ event_id: draft.p_event_id, squad_player_id: 'sq-1', note: own.note ?? '',
          job: line.job ?? '', did_job: own.did_job ?? 'yes' }]
        : [{ event_id: draft.p_event_id, session_id: 'session-1', squad_player_id: 'sq-1', our_score: draft.p_our_score, their_score: draft.p_their_score,
          job: '', did_job: null, expectation: line.expectation ?? 'usual', context: line.context ?? [],
          against_expectation: own.against_expectation ?? 'met', has_note: false, coach_name: 'Fernando Santos', published_at: draft.published_at }])
    }
    if (path.startsWith('/rest/v1/game_evaluation')) {
      const drafts = [...plans.entries()].filter(([key]) => key.startsWith('evaluation:')).map(([, draft]) => draft)
      const one = url.searchParams.get('event_id')?.replace(/^eq\./, '')
      const mine = drafts.filter(draft => !one || draft.p_event_id === one)
      const listed = mine.flatMap(draft => draft.p_players as { id: string; played: boolean; did_job?: string; against_expectation?: string; note?: string }[])
      if (path === '/rest/v1/game_evaluations') return json(mine.map(draft => ({ event_id: draft.p_event_id, our_score: draft.p_our_score,
        their_score: draft.p_their_score, goals: draft.p_goals, how_they_scored: draft.p_how_they_scored, plan_worked: draft.p_plan_worked,
        saved_at: draft.saved_at, published_at: draft.published_at ?? null })))
      // TRAK-518: as save_game_evaluation keeps it, an answer not given stays empty.
      if (path === '/rest/v1/game_evaluation_players') return json(listed.map(p => ({ squad_player_id: p.id, played: p.played,
        did_job: p.did_job ?? null, against_expectation: p.against_expectation ?? null })))
      if (path === '/rest/v1/game_evaluation_notes') return json(listed.filter(p => p.note).map(p => ({ squad_player_id: p.id, note: p.note })))
    }
    if (path === '/rest/v1/game_shares') return json([...plans.entries()].filter(([key]) => key.startsWith('share:')).map(([, share]) => share))
    if (path === '/rest/v1/rpc/share_game_plan') {
      const body = req.postDataJSON() as { p_event_id: string; p_talked: boolean }
      plans.set(`share:${body.p_event_id}`, { event_id: body.p_event_id, shared_at: new Date().toISOString(), talked: body.p_talked })
      return json(1)
    }
    if (path === '/rest/v1/squad_players' && me === PLAYER) return json([{ id: 'sq-1', coach_user_id: COACH }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: COACH, organization_id: 'org-283', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/organizations') return json([{ id: 'org-283', name: 'Rehearsal FC', logo_url: null }])
    if (path === '/rest/v1/squad_players') return json(players)
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, granted: true, invited_parent: null })
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    // TRAK-312: the whole roster in one check; the ids still waiting.
    if (path === '/rest/v1/rpc/coach_squad_players_consent_pending') return json([])
    if (path === '/rest/v1/event_confirmations') return json(CONFIRMED)
    if (path === '/rest/v1/event_absences') return json(ABSENT)
    if (path === '/rest/v1/game_plan_players' && req.method() === 'POST') {
      for (const row of req.postDataJSON() as Record<string, unknown>[]) plans.set(`line-up:${row.event_id}:${row.squad_player_id}`, row)
      return route.fulfill({ status: 201, body: '' })
    }
    if (path === '/rest/v1/game_plan_players') {
      const one = url.searchParams.get('event_id')?.replace(/^eq\./, '')
      return json([...plans.entries()].filter(([key]) => key.startsWith(`line-up:${one}:`)).map(([, row]) => row))
    }
    if (path === '/rest/v1/rpc/my_session_is_live' || path === '/rest/v1/rpc/feature_on') return json(true)
    // TRAK-441: the family's look (family_look) is off unless a test sets 'look'; on a laptop its frame reads the academy.
    if (path === '/rest/v1/rpc/family_feature_on') return json(plans.has('look'))
    if (path === '/rest/v1/rpc/family_academy') return json({ name: 'Rehearsal FC', logo_url: null })
    // TRAK-350: the season plan's switch is on here, so Home asks for the squad's plan; there is none.
    if (path === '/rest/v1/season_plans') return json([])
    if (path === '/rest/v1/coach_calendar_events') {
      const one = url.searchParams.get('id')?.replace(/^eq\./, '')
      return json(one ? MATCHES.filter(m => m.id === one) : MATCHES)
    }
    if (path === '/rest/v1/game_plans' && req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>
      plans.set(body.event_id as string, { ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      return route.fulfill({ status: 201, body: '' })
    }
    if (path === '/rest/v1/game_plans') {
      const one = url.searchParams.get('event_id')?.replace(/^eq\./, '')
      return json([...plans.entries()].filter(([key, plan]) => !key.includes(':') && (!one || plan.event_id === one)).map(([, plan]) => plan))
    }
    // Every other read is empty.
    if (path.startsWith('/rest/v1/')) return json(req.method() === 'GET' || path.startsWith('/rest/v1/rpc/') ? [] : null)
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

async function open(page: Page, context: BrowserContext, path: string, width: number, height: number, plans: Plans = new Map(), me = COACH) {
  const unexpected: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width, height })
  await backend(context, unexpected, plans, me)
  await page.goto(path)
  return { unexpected, errors }
}
/** Match header (Imad, 6 Nov): the match's state beside its title. Once the page scrolls, the compact row repeats it. */
const matchStatus = (page: Page) => page.getByRole('heading', { level: 1 }).locator('..')
/** Save draft is in the match header. On a phone it folds into the header's "…" menu, and a toast says it's saved. */
async function saveDraft(page: Page) {
  if (page.viewportSize()!.width > 560) {
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
    return
  }
  await page.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Save draft' }).click()
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible()
}
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

/** Tab from the top of the page; every control in `scope` must take focus at least once. A tab list is one stop
 *  (roving focus): its other tabs are reached with the arrow keys, which the tests check separately. So is a radio
 *  group, when `fields` adds a form's inputs. A closed card's fields are inert (TRAK-288), so they're left out. */
async function everyControlByKeyboard(page: Page, scope: string, fields = false) {
  const kinds = `a[href], button:not([disabled]), [tabindex="0"]${fields ? ', input:not([type="radio"]), textarea' : ''}`
  const controls = await page.locator(`${scope} :is(${kinds}):not([tabindex="-1"], [role="tablist"])`).evaluateAll(els =>
    els.filter(el => (el as HTMLElement).offsetParent !== null && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[inert]'))
      .map((el, i) => { (el as HTMLElement).dataset.kb = String(i); return String(i) }))
  const reached = new Set<string>()
  await page.locator('body').focus()
  for (let i = 0; i < 120 && reached.size < controls.length; i++) {
    await page.keyboard.press('Tab')
    const kb = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.kb)
    if (kb) reached.add(kb)
  }
  const missed = controls.filter(kb => !reached.has(kb))
  const names = await Promise.all(missed.map(kb => page.locator(`[data-kb="${kb}"]`).first().evaluate(el => el.outerHTML.slice(0, 120))))
  return { count: controls.length, missed: names }
}

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`Games home at ${width} px: the next game, its draft and the squad's matches`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map([['m-next', { event_id: 'm-next', strength: null, their_formation: null, key_players: [], scouting: '',
      goals: [{ title: 'Win it back in their half', looks_like: '' }], created_at: '2026-10-27T17:00:00Z', updated_at: '2026-10-27T17:40:00Z' }]])
    const { unexpected, errors } = await open(page, context, '/coach/matches', width, height, plans)
    await expect(page.getByRole('heading', { level: 1, name: 'Matches' })).toBeVisible()
    const next = page.getByRole('region', { name: 'Next match' })
    await expect(next.getByText('vs Parkview Athletic U16')).toBeVisible()
    await expect(next.getByText('Draft', { exact: true })).toBeVisible()
    // TRAK-286: with a draft, sharing it is next. TRAK-333: on a split button, with the match's other pages behind it.
    await expect(next.getByRole('button', { name: 'Share plan', exact: true })).toBeVisible()
    await expect(next.getByRole('button', { name: 'Share plan more actions' })).toBeVisible()
    // TRAK-588: no Open drafts box; the draft is on its badge. TRAK-590: no month strip.
    await expect(page.getByRole('heading', { name: 'Open drafts' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Match calendar' })).toHaveCount(0)
    // TRAK-592: only the matches to come; the two played are behind Past matches.
    await expect(page.getByRole('region', { name: 'Upcoming matches' }).getByRole('link')).toHaveCount(2)
    await expect(page.getByRole('button', { name: /^Past matches/ })).toContainText('2')
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`games-home-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    // TRAK-592: split button (2), the 2 matches to come, Past matches: 5.
    expect(keyboard.count).toBeGreaterThanOrEqual(5)
    expect(keyboard.missed).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`a game's page at ${width} px: Logistics, then Game plan and Evaluation`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-draft', width, height)
    await expect(page.getByRole('heading', { level: 1, name: 'vs Synthetic United U14' })).toBeVisible()
    await expect(page.getByText('Logistics not shared')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`game-logistics-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.max-w-\\[960px\\]')
    expect(keyboard.missed).toEqual([])

    // The keyboard moves between the panels (Arc tabs).
    await page.getByRole('tab', { name: 'Logistics' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    // TRAK-288: until full time it says when it opens.
    await expect(page.getByRole('heading', { name: /^Opens at full time, \d\d:\d\d$/ })).toBeVisible()
    expect(page.url()).toContain('?tab=evaluation')
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-331 (Imad, 2 Nov): Edit pulls up Schedule's own edit sheet on the match page; the coach never leaves the match.
  test(`a game's logistics at ${width} px: Edit pulls up the event's sheet on the match page`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-next', width, height)
    await expect(page.getByText('Shared', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Edit event', exact: true }).click()
    const sheet = page.getByRole('dialog', { name: 'Edit event' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('navigation', { name: 'Event steps' })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`logistics-edit-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()
    expect(new URL(page.url()).pathname).toBe('/coach/matches/m-next')
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  test(`a game's plan at ${width} px: tactics and analysis, kept across tabs and saved as a draft`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map()
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-next?tab=plan', width, height, plans)
    await expect(page.getByRole('heading', { name: 'Instructions' })).toBeVisible()
    await expect(page.getByText('Plan not written')).toBeVisible()
    // TRAK-328: no empty instruction until one is added.
    await expect(page.getByRole('group', { name: /^Instruction \d$/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Add instruction' }).click()
    const goal = page.getByRole('group', { name: 'Instruction 1' })
    await goal.getByLabel('Instruction', { exact: true }).fill('Win it back in their half')
    await goal.getByLabel('What it looks like').fill('Press when their keeper plays short.')
    await page.getByText('Stronger', { exact: true }).click()
    await page.getByLabel('What you know about them').fill('Their keeper plays short to the left centre-back.')
    // TRAK-328: the lock says who sees how strong they are. Arc's tooltip also holds a hidden copy it measures, so the
    // check is what a screen reader hears: the lock's description.
    const lock = page.getByRole('button', { name: 'Who sees how strong they are' })
    await lock.click()
    await expect(page.getByRole('tooltip')).toBeAttached()
    await expect(lock).toHaveAccessibleDescription('Only you can see this')
    await lock.click()
    await expect(page.getByRole('tooltip')).toHaveCount(0)

    // A look at Logistics, with the panel's exit animation, keeps every field.
    await page.getByRole('tab', { name: 'Logistics' }).click()
    await expect(page.getByText('Shared', { exact: true })).toBeVisible()
    await page.waitForTimeout(600)
    await page.getByRole('tab', { name: 'Game plan' }).click()
    await expect(goal.getByLabel('Instruction', { exact: true })).toHaveValue('Win it back in their half')

    await saveDraft(page)
    await expect(matchStatus(page).getByText('Draft', { exact: true })).toBeVisible()
    expect(plans.get('m-next')).toMatchObject({ strength: 'stronger',
      goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }] })
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`game-plan-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    // TRAK-328: their line-up's formation select and Add a key player went with the card.
    expect(keyboard.count).toBeGreaterThanOrEqual(8)
    expect(keyboard.missed).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-285: on a phone the player's sheet is a bottom sheet: it opens, scrolls, and closes with Esc and with a swipe.
test("a game's line-up at 390 px: the player's sheet opens, scrolls and closes with Esc and with a swipe", async ({ page, context }, testInfo) => {
  const { unexpected, errors } = await open(page, context, '/coach/matches/m-next?tab=plan', 390, 844)
  await page.getByRole('button', { name: 'Next: Line-up and jobs' }).click()
  await expect(page.getByRole('heading', { name: '4-4-2' })).toBeVisible()
  await page.getByRole('button', { name: 'Slot 1, empty' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('combobox', { name: 'Who plays here?' }).click()
  await page.getByRole('option', { name: /^Theodoros Zagorakis/ }).click()
  await expect(sheet.getByLabel('Job · only Theodoros sees it')).toBeVisible()
  await sheet.getByLabel('Job · only Theodoros sees it').fill('Command the box on crosses.')
  await page.waitForTimeout(400)
  await page.screenshot({ path: testInfo.outputPath('line-up-sheet-390.png') })

  // Expanded with its grabber, it scrolls to the last field.
  await sheet.getByRole('button', { name: 'Expand sheet' }).click()
  await page.waitForTimeout(500)
  const box = (await sheet.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75)
  await page.mouse.wheel(0, 1200)
  await expect(sheet.getByRole('group', { name: 'Expectation · only you' })).toBeInViewport()

  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('button', { name: 'Theodoros Zagorakis, slot 1' })).toBeVisible()

  // A swipe down on the sheet's header closes it too.
  await page.getByRole('button', { name: 'Theodoros Zagorakis, slot 1' }).click()
  await expect(sheet).toBeVisible()
  await page.waitForTimeout(500)
  const title = (await sheet.getByRole('heading', { name: 'Theodoros Zagorakis' }).boundingBox())!
  await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2)
  await page.mouse.down()
  await page.mouse.move(title.x + title.width / 2, title.y + 520, { steps: 12 })
  await page.mouse.up()
  await expect(sheet).toBeHidden()
  expect(await sideways(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// Imad, 26 Nov: on an iPhone, picking who plays in a slot zoomed the page in and it stayed zoomed. The sheet's boxes
// are Arc's, at 14 px, which TRAK-178's 16 px rule for touch screens missed.
test.describe('on an iPhone', () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 15']
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch })

  test("a game's line-up sheet: no box small enough for iPhone to zoom in on it", async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-next?tab=plan', viewport.width, viewport.height)
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'a touch screen').toBe(true)
    const px = (box: Locator) => box.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    await page.getByRole('button', { name: 'Next: Line-up and jobs' }).click()
    await page.getByRole('button', { name: 'Slot 1, empty' }).click()
    const sheet = page.getByRole('dialog')
    const search = sheet.getByRole('combobox', { name: 'Who plays here?' })
    expect(await px(search), 'Who plays here?').toBeGreaterThanOrEqual(16)
    await search.click()
    await page.getByRole('option', { name: /^Theodoros Zagorakis/ }).click()
    const job = sheet.getByLabel('Job · only Theodoros sees it')
    expect(await px(job), 'Job').toBeGreaterThanOrEqual(16)
    await job.fill('Command the box on crosses.')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('line-up-sheet-iphone.png') })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
})

// TRAK-285: on a laptop the sheet is a panel beside the pitch, so the pitch stays in view while the coach edits.
test("a game's line-up at 1440 px: the pitch stays in view while the panel beside it is edited", async ({ page, context }, testInfo) => {
  const plans: Plans = new Map()
  const { unexpected, errors } = await open(page, context, '/coach/matches/m-next?tab=plan', 1440, 900, plans)
  await page.getByRole('button', { name: 'Next: Line-up and jobs' }).click()
  // TRAK-513: one card holds the picker, the pitch and the lists; the pitch itself is what stays in view.
  const pitch = page.getByRole('group', { name: '4-4-2, starting players. Attacking upwards.' })
  await expect(pitch).toBeVisible()
  await page.waitForTimeout(400)
  // TRAK-329: the formations are one dropdown on the pitch, a header per format.
  await page.getByRole('combobox', { name: 'Format and shape' }).click()
  await expect(page.getByRole('group', { name: '9 a side' })).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: testInfo.outputPath('formations-1440.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox', { name: 'Format and shape' })).toBeHidden()
  await page.getByRole('button', { name: 'Slot 2, empty' }).click()
  await page.getByRole('combobox', { name: 'Who plays here?' }).click()
  await page.getByRole('option', { name: /^Traianos Dellas/ }).click()
  const job = page.getByLabel('Job · only Traianos sees it')
  await job.fill('Stay tight to their number 9. Win the first header.')
  await expect(pitch).toBeInViewport()
  await expect(job).toBeInViewport()
  // TRAK-358: Everyone's job and its count went; the face says it (a midfielder at the back is out of position).
  await expect(page.getByRole('button', { name: 'Traianos Dellas, slot 2, has a job, context: out of position', exact: true })).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  // Match header (Imad, 6 Nov): scrolled, the pitch pins under the header's tabs, never behind them.
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(400)
  const tabs = (await page.getByRole('tablist', { name: 'This match' }).boundingBox())!
  expect((await pitch.boundingBox())!.y).toBeGreaterThanOrEqual(tabs.y + tabs.height)
  await expect(pitch).toBeInViewport()
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
  expect(plans.get('line-up:m-next:sq-4')).toMatchObject({ role: 'starter', slot: 2, job: 'Stay tight to their number 9. Win the first header.' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: testInfo.outputPath('line-up-1440.png'), fullPage: true })
  expect(await sideways(page)).toBeLessThanOrEqual(0)
  const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
  expect(keyboard.missed).toEqual([])
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-286, TRAK-332: Review & share. One card reads every part of the plan; its Share plan waits for the face-to-face
// tick, which the keyboard ticks before it shares.
const DRAFT = (): Plans => new Map([
  ['m-next', { event_id: 'm-next', strength: 'stronger', their_formation: null, key_players: [], scouting: 'Their 9 is quick.', format: 11,
    formation: '4-4-2', goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }],
    created_at: '2026-10-27T17:00:00Z', updated_at: '2026-10-27T17:40:00Z' }],
  ['line-up:m-next:sq-1', { event_id: 'm-next', squad_player_id: 'sq-1', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
    note: 'Second game at right-back. Proud of you.', context: ['out_of_position'], expectation: 'stretch' }],
])
/** A Trak colour token as the browser resolves it, and an Arc badge's tone and shape (TRAK-370). */
const trak = (page: Page, token: string) => page.evaluate(name => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(', ')})`, token)
const badge = (page: Page, text: string) => page.getByText(text, { exact: true }).first().locator('xpath=ancestor::span[contains(@class, "badge")][1]')
const tone = (page: Page, text: string) => badge(page, text).evaluate(el => getComputedStyle(el).getPropertyValue('--badge-tone').replace(/\s+/g, ' ').trim()
  .replace(/^rgb\((\d+) (\d+) (\d+)\)$/, 'rgb($1, $2, $3)'))

// TRAK-317: a starter expected to stretch stands out on the pitch, with a key under it. TRAK-358 (Season plan 10/18;
// Tarek, 6 Nov): on Formations' pitch every face has its markers: a yellow ring for Stretch, a green one for Lead, a ✓
// for a job and an i for context, each said in the face's name too. TRAK-370's orange and blue stay on the badges,
// which left the line-up with Everyone's job (the evaluation test checks them).
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`stretch and lead starters at ${width} px: yellow and green rings on the pitch, a ✓ and an i, and the key`, async ({ page, context }, testInfo) => {
    const plans = DRAFT()
    plans.set('line-up:m-next:sq-2', { event_id: 'm-next', squad_player_id: 'sq-2', role: 'starter', slot: 2, job: 'Organise the back four.',
      note: '', context: [], expectation: 'lead' })
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-next?tab=plan', width, height, plans)
    await page.getByRole('button', { name: 'Next: Line-up and jobs' }).click()
    const stretch = page.getByRole('button', { name: 'Theodoros Zagorakis, slot 4, stretch, has a job, context: out of position', exact: true })
    const lead = page.getByRole('button', { name: 'Angelos Charisteas, slot 2, lead, has a job', exact: true })
    await expect(stretch).toBeVisible()
    await expect(lead).toBeVisible()
    const ring = (face: ReturnType<Page['getByRole']>) => face.locator('[class*="shadow-"]').first().evaluate(el => getComputedStyle(el).boxShadow)
    const yellow = await trak(page, '--t-attention'), green = await trak(page, '--t-success')
    expect(yellow).toBe('rgb(234, 179, 8)')
    expect(await ring(stretch)).toContain(yellow)
    expect(await ring(lead)).toContain(green)
    await expect(stretch.locator('[data-mark="done"]')).toBeVisible()
    await expect(stretch.locator('[data-mark="context"]')).toBeVisible()
    await expect(lead.locator('[data-mark="context"]')).toHaveCount(0)
    const key = page.getByRole('list', { name: 'Key' })
    await expect(key.getByText('Stretch', { exact: true })).toBeVisible()
    await expect(key.getByText('Lead', { exact: true })).toBeVisible()
    await page.waitForTimeout(400)
    await page.getByRole('region', { name: '4-4-2' }).screenshot({ path: testInfo.outputPath(`rings-pitch-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`a game's Review & share at ${width} px: every part at a glance, then tick and share by keyboard`, async ({ page, context }, testInfo) => {
    const plans = DRAFT()
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-next?tab=plan&step=share', width, height, plans)
    const card = page.getByRole('region', { name: 'Game plan review' })
    await expect(card).toBeVisible()
    await expect(card.getByRole('list', { name: 'The plan' }).getByRole('listitem')).toHaveCount(5)
    // TRAK-347 (Imad, 3 Nov): a laptop's top bar is the trail, with no trail on the page; a phone keeps the page's own.
    if (width >= 1024) {
      await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toHaveText(/^Matches\s*\/?\s*vs Parkview Athletic U16$/)
      await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Matches' })).toHaveAttribute('href', '/coach/matches')
      await expect(page.getByRole('navigation', { name: 'Breadcrumb trail' })).toHaveCount(0)
    } else {
      await expect(page.getByRole('navigation', { name: 'Breadcrumb trail' })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toHaveCount(0)
    }
    // TRAK-369 (Imad, 4 Nov): two equal halves, the gauge with what's left under it and the countdown, nothing between
    // them; on a phone the countdown goes under the gauge.
    const box = async (locator: ReturnType<typeof page.getByRole>) => (await locator.boundingBox())!
    const [whole, gauge, left, label, clock] = await Promise.all([box(card), box(card.getByRole('img', { name: /parts ready/ })),
      // What's left is its icon and its words, centred together.
      box(card.getByText('1 incomplete', { exact: true }).locator('..')), box(card.getByText('Kick-off in', { exact: true })),
      box(card.getByRole('timer', { name: 'Kick-off in' }))])
    const middleY = (top: number, bottom: number) => (top + bottom) / 2
    const centreX = (b: { x: number; width: number }) => b.x + b.width / 2
    expect(left.y).toBeGreaterThanOrEqual(gauge.y + gauge.height)
    expect(Math.abs(centreX(left) - centreX(gauge))).toBeLessThanOrEqual(2)
    if (width >= 1024) {
      expect(Math.abs(middleY(gauge.y, left.y + left.height) - middleY(label.y, clock.y + clock.height))).toBeLessThanOrEqual(2)
      expect(Math.abs((centreX(gauge) + centreX(clock)) / 2 - centreX(whole))).toBeLessThanOrEqual(2)
      expect(centreX(gauge)).toBeLessThan(centreX(whole))
    } else {
      expect(label.y).toBeGreaterThan(left.y + left.height)
    }
    // Arc's countdown digits are the gauge count's size.
    expect(await card.getByRole('timer').evaluate(el => getComputedStyle(el.querySelector('[class*="units"]')!).fontSize)).toBe('28px')
    const share = card.getByRole('button', { name: 'Share plan', exact: true })
    await expect(share).toBeDisabled()
    // TRAK-369: no line for who gets it and none for the tick before sharing.
    await expect(card.getByText(/and their families|^Tick /)).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Preview' })).toHaveCount(0)
    await page.waitForTimeout(600)
    await page.screenshot({ path: testInfo.outputPath(`review-share-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)

    const tick = card.getByRole('checkbox', { name: /talked selection through/ })
    await tick.focus()
    await page.keyboard.press('Space')
    await expect(tick).toBeChecked()
    await expect(share).toBeEnabled()
    // Every control, Share plan included once it's enabled, takes focus from the keyboard.
    const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.count).toBeGreaterThan(5)
    expect(keyboard.missed).toEqual([])
    await share.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('region', { name: /^Shared at / })).toBeVisible()
    expect(plans.get('share:m-next')).toMatchObject({ talked: true })
    expect(plans.get('m-next')).toMatchObject({ goals: [{ title: 'Win it back in their half' }] })
    await expect(matchStatus(page).getByText('Plan shared')).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`shared-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-290: Schedule (Share at… until TRAK-345) sits behind Share plan's chevron and opens by keyboard; its day and
// time pickers fit the step, side by side under the button (TRAK-345), and Share plan is the app's green. A
// scheduled plan waits with "Shares …", Change time opens the pickers on the time it has, and every control takes focus
// from the keyboard. What's sent is the unit tests' (game-share-at-trak290).
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`Schedule at ${width} px: the chevron by keyboard, then a scheduled plan waits`, async ({ page, context }, testInfo) => {
    const plans = DRAFT()
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-next?tab=plan&step=share', width, height, plans)
    await expect(page.getByRole('region', { name: 'Game plan review' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Share plan more actions' })).toBeDisabled()
    await page.getByRole('checkbox', { name: /talked selection through/ }).focus()
    await page.keyboard.press('Space')
    await page.getByRole('button', { name: 'Share plan more actions' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Schedule' })).toBeFocused()
    await page.keyboard.press('Enter')
    const day = page.getByRole('button', { name: /^Day\b/ }), time = page.getByRole('button', { name: /^Time\b/ })
    await expect(day).toBeVisible()
    await expect(time).toBeVisible()
    // Under Share plan, side by side.
    const [shareBox, dayBox, timeBox] = await Promise.all([page.getByRole('button', { name: 'Share plan', exact: true }).boundingBox(), day.boundingBox(), time.boundingBox()])
    expect(dayBox!.y).toBeGreaterThan(shareBox!.y + shareBox!.height)
    expect(Math.abs(dayBox!.y - timeBox!.y)).toBeLessThanOrEqual(1)
    expect(timeBox!.x).toBeGreaterThan(dayBox!.x + dayBox!.width)
    // Share plan is Arc's accent, the app's green, as its primary buttons are.
    const green = await page.getByRole('button', { name: 'Share plan', exact: true }).evaluate(button => {
      const probe = document.createElement('span')
      probe.style.background = 'var(--accent)'
      button.parentElement!.appendChild(probe)
      const accent = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { button: getComputedStyle(button).backgroundColor, accent }
    })
    expect(green.button).toBe(green.accent)
    expect(green.accent).not.toBe('rgba(0, 0, 0, 0)')
    await expect(page.locator('[role="tabpanel"]:not([hidden])').getByRole('button', { name: 'Schedule', exact: true })).toBeDisabled()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`share-at-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)

    // Scheduled for 19:30 the day before kick-off, Dubai time.
    const matchDay = MATCHES.find(m => m.id === 'm-next')!.event_date.slice(0, 10)
    const at = new Date(Date.parse(`${matchDay}T19:30:00+04:00`) - 24 * 60 * MINUTE).toISOString()
    plans.set('share:m-next', { event_id: 'm-next', shared_at: at, talked: true })
    await page.reload()
    const scheduled = page.getByRole('region', { name: 'Scheduled' })
    await expect(scheduled.getByText(/^Shares \w{3} 19:30$/)).toBeVisible()
    // TRAK-448: beside the title it reads "Plan scheduled"; the time is in this card only.
    await expect(page.getByText(/^Shares \w{3} 19:30$/)).toHaveCount(1)
    await expect(matchStatus(page).getByText('Plan scheduled', { exact: true })).toBeVisible()
    const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.missed).toEqual([])
    await scheduled.getByRole('button', { name: 'Change time' }).focus()
    await page.keyboard.press('Enter')
    await expect(scheduled.getByRole('button', { name: /^Move to \w{3} 19:30$/ })).toBeEnabled()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`scheduled-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-286: what Theodoros reads on his phone once it's shared: the goals, his job and the note just for him.
test("the player's event page at 390 px: the shared game plan", async ({ page, context }, testInfo) => {
  const plans = DRAFT()
  plans.set('share:m-next', { event_id: 'm-next', shared_at: new Date().toISOString() })
  const { unexpected, errors } = await open(page, context, '/player/event/m-next', 390, 844, plans, PLAYER)
  const section = page.getByRole('region', { name: 'Game plan' })
  await expect(section).toBeVisible()
  await expect(section.getByText('1 · Win it back in their half')).toBeVisible()
  await expect(section.getByText('Your job')).toBeVisible()
  await expect(section.getByText('Stay tight to their winger.')).toBeVisible()
  // TRAK-441: the whole line-up on the coach's pitch, his own place marked, and the bench.
  const lineUp = page.getByRole('region', { name: 'Line-up' })
  const pitch = lineUp.getByRole('group', { name: 'The starting line-up, 4-4-2' })
  await expect(pitch.getByText('You', { exact: true })).toBeVisible()
  await expect(pitch.getByText('Antonios', { exact: true })).toBeVisible()
  await expect(lineUp.getByRole('list', { name: 'Bench' }).getByRole('listitem')).toHaveText(['Angelos', 'Dimitrios', 'Vassilios'])
  await page.waitForTimeout(500)
  await page.screenshot({ path: testInfo.outputPath('player-game-plan-390.png'), fullPage: true })
  expect(await sideways(page)).toBeLessThanOrEqual(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(pitch.getByText('You', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('player-game-plan-1440.png'), fullPage: true })
  expect(await sideways(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-441 slice 3.3: with the academy's family_look on, the same match is the coach's match header with tabs.
test("the player's match page in the coach's look: header, tabs, game plan and logistics at 390 and 1440 px", async ({ page, context }, testInfo) => {
  const plans = DRAFT()
  plans.set('share:m-next', { event_id: 'm-next', shared_at: new Date().toISOString() })
  plans.set('look', {})
  const { unexpected, errors } = await open(page, context, '/player/event/m-next', 390, 844, plans, PLAYER)
  await expect(page.getByRole('heading', { level: 1, name: /^vs / })).toBeVisible()
  const tabs = page.getByRole('tablist', { name: /^vs / })
  await expect(tabs.getByRole('tab')).toHaveText([/Logistics/, /Game plan/, /Evaluation/])
  await expect(tabs.getByRole('tab', { name: /Game plan/ })).toHaveAttribute('aria-selected', 'true')
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await tabs.getByRole('tab', { name: /Game plan/ }).click()
    await expect(page.getByRole('heading', { name: 'Your job' })).toBeVisible()
    await expect(page.getByText('Stay tight to their winger.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Team instructions' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Line-up' }).getByText('You', { exact: true })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`family-match-plan-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await tabs.getByRole('tab', { name: 'Logistics' }).click()
    await expect(page.getByRole('tabpanel')).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: testInfo.outputPath(`family-match-logistics-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
  }
  // On a laptop the top bar is the trail, as the coach's.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Matches')
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-373 (Imad, 5 Nov): while the match is on, Review & share's top right is the minute over a green bar, "HT" at
// half-time (15 minutes in the middle of the 90-minute slot), then "Locked" with the lock. The page's clock is set to
// 14 minutes after Lakeside's kick-off, then moved on.
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`the match clock at ${width} px: the minute (as on TV) over a green bar, HT, then Locked`, async ({ page, context }, testInfo) => {
    const lakeside = MATCHES.find(m => m.id === 'm-past')!
    await page.clock.install({ time: new Date(Date.parse(lakeside.starts_at) + 14 * MINUTE + 10_000) })
    const plans: Plans = new Map([['m-past', { event_id: 'm-past', strength: 'similar', their_formation: null, key_players: [], scouting: '',
      format: 11, formation: '4-4-2', goals: [], created_at: '2026-10-20T17:00:00Z', updated_at: '2026-10-20T17:40:00Z' }]])
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-past?tab=plan&step=share', width, height, plans)
    const card = page.getByRole('region', { name: 'Game plan review' })
    const clock = card.getByRole('progressbar', { name: 'Match clock' })
    // Counted as on TV: 14 minutes played is 15'.
    await expect(clock).toHaveAttribute('aria-valuetext', 'Minute 15')
    await expect(card.getByText('15\'', { exact: true })).toBeVisible()
    await expect(card.getByRole('timer')).toHaveCount(0)
    // Trak's green, a fifth of the way along (14 of 75 minutes of play).
    const fill = clock.locator('span')
    expect(await fill.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await page.evaluate(() =>
      `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--t-brand').trim().split(/\s+/).join(', ')})`))
    await page.waitForTimeout(600)
    const share = await fill.evaluate(el => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width)
    expect(share).toBeCloseTo(14 / 75, 1)
    await card.screenshot({ path: testInfo.outputPath(`match-clock-${width}.png`) })
    await page.clock.fastForward('24:00')
    await expect(card.getByText('HT', { exact: true })).toBeVisible()
    await expect(clock).toHaveAttribute('aria-valuetext', 'Half-time')
    await page.clock.fastForward('01:00:00')
    await expect(card.getByText('Locked', { exact: true })).toBeVisible()
    await expect(clock).toHaveCount(0)
    await card.screenshot({ path: testInfo.outputPath(`match-locked-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-287: a match that has kicked off shows its plan locked, with no Save or Share. TRAK-372 (Imad, 5 Nov): no lock
// alert, and what was written reads as written, with no boxes.
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`a locked plan at ${width} px: written, not boxes, with no lock alert`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map([
      ['m-past', { event_id: 'm-past', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: 'Their 9 is quick.', format: 11,
        formation: '4-4-2', goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }],
        created_at: '2026-10-20T17:00:00Z', updated_at: '2026-10-20T17:40:00Z' }],
      ['line-up:m-past:sq-1', { event_id: 'm-past', squad_player_id: 'sq-1', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
        note: '', context: [], expectation: 'usual' }],
    ])
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-past?tab=plan', width, height, plans)
    await expect(page.getByText('Win it back in their half', { exact: true })).toBeVisible()
    await expect(page.getByText('Press when their keeper plays short.', { exact: true })).toBeVisible()
    await expect(page.getByText('Their 9 is quick.', { exact: true })).toBeVisible()
    await expect(page.getByText(/^Locked at kick-off, \d\d:\d\d$/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
    await expect(page.locator('[role="tabpanel"]:not([hidden])').getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Add instruction/ })).toHaveCount(0)
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`locked-plan-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.count).toBeGreaterThan(3)
    expect(keyboard.missed).toEqual([])
    await page.getByRole('button', { name: 'Next: Line-up and jobs' }).click()
    await expect(page.getByText('Tap a player to see their job.')).toHaveCount(0) // TRAK-513: no helper line
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`locked-line-up-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-288: after full time, the evaluation as one draft, read against the plan as it locked, saved and reloaded. Every
// field is reachable by keyboard, and nothing scrolls sideways. TRAK-374 (Imad, 5 Nov): Result (with "Did the plan
// work?") and Player evaluation, each player's job shown, "Did the job?", and a Draft badge in place of the alert.
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`an evaluation at ${width} px: every step by keyboard, saved as a draft and reloaded`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map([
      ['m-past', { event_id: 'm-past', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: '', format: 11, formation: '4-4-2',
        goals: [{ title: 'Win it back in their half', looks_like: 'Press when their keeper plays short.' }, { title: 'Switch play early', looks_like: '' }],
        created_at: '2026-10-20T17:00:00Z', updated_at: '2026-10-20T17:40:00Z' }],
      ['line-up:m-past:sq-1', { event_id: 'm-past', squad_player_id: 'sq-1', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
        note: '', context: ['out_of_position'], expectation: 'stretch' }],
      ['line-up:m-past:sq-4', { event_id: 'm-past', squad_player_id: 'sq-4', role: 'starter', slot: 2, job: 'Win the first header.',
        note: '', context: [], expectation: 'lead' }],
    ])
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-past?tab=evaluation', width, height, plans)
    // Result: 2–1, Zagorakis scored the first, Charisteas came on.
    await page.getByRole('button', { name: 'Increase Our score' }).click()
    await page.getByRole('button', { name: 'Increase Our score' }).click()
    await page.getByRole('button', { name: 'Increase Their score' }).click()
    await page.getByRole('combobox', { name: 'Scored by' }).first().click()
    await page.getByRole('option', { name: 'Theodoros Zagorakis' }).click()
    await page.getByRole('checkbox', { name: 'Angelos Charisteas' }).click()
    await page.getByRole('textbox', { name: 'How their goals came' }).fill('A corner at the back post.')
    await page.getByRole('group', { name: 'Win it back in their half' }).getByText('Worked').click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`evaluation-result-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    let keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.count).toBeGreaterThan(10)
    expect(keyboard.missed).toEqual([])

    // Player evaluation: every answer starts empty (TRAK-518); Zagorakis did part of his job, above what was expected.
    await page.getByRole('button', { name: 'Next: Player evaluation' }).click()
    const card = page.getByRole('button', { name: /^Theodoros Zagorakis/ })
    await expect(card).toContainText('Not answered')
    await expect(card).toContainText('Expected: Stretch')
    // TRAK-370 (Imad, 5 Nov), here since TRAK-358 took Everyone's job off the line-up: stretch and context are Trak's
    // orange, lead Trak's blue, on Arc's current badge (soft corners, no border).
    const orange = await trak(page, '--t-orange')
    expect(orange).toBe('rgb(156, 69, 22)')
    expect(await tone(page, 'Expected: Stretch')).toBe(orange)
    expect(await tone(page, 'Out of position')).toBe(orange)
    expect(await tone(page, 'Expected: Lead')).toBe(await trak(page, '--t-info'))
    const shape = await badge(page, 'Expected: Stretch').evaluate(el => ({ radius: getComputedStyle(el).borderTopLeftRadius, edge: getComputedStyle(el).borderTopColor }))
    expect(shape).toEqual({ radius: '5px', edge: 'rgba(0, 0, 0, 0)' })
    await card.click()
    const expanded = page.locator('article').filter({ has: card })
    await expect(expanded.getByText('Stay tight to their winger.', { exact: true })).toBeVisible()
    await expanded.getByRole('group', { name: 'Did the job?' }).getByText('Partly').click()
    await expanded.getByRole('group', { name: 'Against expectation' }).getByText('Above').click()
    await expanded.getByRole('textbox', { name: /^Note to Theodoros/ }).fill('Brave all game.')
    await expect(card).toContainText('Did part of the job · Above')
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`evaluation-players-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])', true)
    expect(keyboard.missed).toEqual([])

    await expect(page.getByText('Draft', { exact: true })).toHaveCount(0)  // TRAK-448: no badge at the bottom
    await saveDraft(page)
    await expect(page.getByText(/^Draft saved /)).toHaveCount(0)
    await expect(matchStatus(page).getByText('Evaluation draft')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`evaluation-saved-${width}.png`) })

    // A reload shows the draft.
    await page.reload()
    await expect(page.getByRole('spinbutton', { name: 'Our score' })).toHaveAttribute('aria-valuenow', '2')
    await expect(page.getByRole('checkbox', { name: 'Angelos Charisteas' })).toBeChecked()
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-289: publishing closes the loop. The coach publishes a complete draft from the Publish step, sees the closed
// loop with its History, and the player reads After the match on their event page. By keyboard, with no sideways scroll.
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`publishing at ${width} px: the Publish step, the closed loop, and the player's After the match`, async ({ page, context }, testInfo) => {
    const plans: Plans = new Map([
      ['m-past', { event_id: 'm-past', strength: 'similar', their_formation: '4-3-3', key_players: [], scouting: '', format: 11, formation: '4-4-2',
        goals: [{ title: 'Win it back in their half', looks_like: '' }, { title: 'Switch play early', looks_like: '' }],
        created_at: '2026-10-20T17:00:00Z', updated_at: '2026-10-20T17:40:00Z' }],
      ['line-up:m-past:sq-1', { event_id: 'm-past', squad_player_id: 'sq-1', role: 'starter', slot: 4, job: 'Stay tight to their winger.',
        note: '', context: ['out_of_position'], expectation: 'stretch' }],
      ['line-up:m-past:sq-4', { event_id: 'm-past', squad_player_id: 'sq-4', role: 'starter', slot: 2, job: 'Win the first header.',
        note: '', context: [], expectation: 'usual' }],
      ['evaluation:m-past', { p_event_id: 'm-past', p_our_score: 2, p_their_score: 1, p_goals: [{ scorer: 'sq-1', assist: null }, { scorer: null, assist: null }],
        p_how_they_scored: 'A corner.', p_plan_worked: ['worked', 'partly'], saved_at: '2026-10-24T17:40:00Z',
        p_players: [{ id: 'sq-1', played: true, did_job: 'partly', against_expectation: 'above', note: 'Brave all game.' },
          { id: 'sq-4', played: true, did_job: 'yes', against_expectation: 'met' }] }],
    ])
    const coach = await open(page, context, '/coach/matches/m-past?tab=evaluation', width, height, plans)
    await page.getByRole('button', { name: 'Next: Player evaluation' }).click()
    await page.getByRole('button', { name: 'Next: Publish' }).click()
    // TRAK-375 (Imad, 5 Nov): one Evaluation review card, with no preview or "Who sees what".
    const review = page.getByRole('region', { name: 'Evaluation review' })
    await expect(review.getByRole('list', { name: 'The plan' }).getByRole('listitem')).toHaveCount(4)
    await expect(review.getByText('Won 2–1 · 1 goal without a scorer', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Preview' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Who sees what' })).toHaveCount(0)
    // This match was made before New event asked the competition (Imad, 29 Oct): the Publish step asks it.
    await expect(page.getByText('Select the competition first.')).toBeVisible()
    await page.getByRole('group', { name: 'Competition' }).getByText('League').click()
    await expect(review.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`publish-step-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '[role="tabpanel"]:not([hidden])')
    expect(keyboard.missed).toEqual([])

    await review.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByText('Published to 2 players and their families. The loop is closed.')).toBeVisible()
    await expect(page.getByRole('region', { name: 'History' }).getByText('Evaluation published. The loop is closed.')).toBeVisible()
    await expect(matchStatus(page).getByText('Published')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`published-${width}.png`), fullPage: true })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(coach.unexpected).toEqual([])
    expect(coach.errors).toEqual([])

    // Theodoros reads After the match on his event page.
    const player = await page.context().browser()!.newContext({ timezoneId: 'Asia/Dubai' })
    const phone = await player.newPage()
    const kid = await open(phone, player, '/player/event/m-past', width, height, plans, PLAYER)
    const after = phone.getByRole('region', { name: 'After the match' })
    await expect(after.getByText('You did part of your job')).toBeVisible()
    await expect(after.getByText('From Coach Fernando Santos · just for you')).toBeVisible()
    await phone.waitForTimeout(500)
    await phone.screenshot({ path: testInfo.outputPath(`player-after-the-game-${width}.png`), fullPage: true })
    expect(await sideways(phone)).toBeLessThanOrEqual(0)
    expect(kid.unexpected).toEqual([])
    expect(kid.errors).toEqual([])
    await player.close()
  })
}

// Match header (Imad, 6 Nov, Concept A): Arc's Page header over the three tabs, with each match's own details. Two
// matches, one before kick-off (Evaluation after the match) and one after full time (Evaluation open). The tabs switch
// by pointer and keyboard; scrolled, the title and details go under a pinned compact row and the tabs, in the window's
// one scroll, and the compact title goes back to the top.
for (const [width, height] of [[390, 844], [1440, 900]] as const) {
  test(`the match header at ${width} px: two matches, the tabs, scrolling to compact and back`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, '/coach/matches/m-next', width, height)
    const header = page.getByRole('region', { name: 'vs Parkview Athletic U16' })
    await expect(header.getByRole('heading', { level: 1, name: 'vs Parkview Athletic U16' })).toBeVisible()
    // Imad, 6 Nov: the kick-off apart from the day, and the age group with no count.
    const details = header.getByRole('heading', { level: 1 }).locator('xpath=../following-sibling::div[1]').locator(':scope > *')
    await expect(details).toHaveText([/^\w{3} \d{1,2} \w{3}$/, /^Kick-off 11:00/, 'Rehearsal Park · Home', 'U16'])
    const tabs = page.getByRole('tablist', { name: 'This match' })
    await expect(tabs.getByRole('tab', { name: 'Evaluation', exact: true })).toBeVisible()
    await expect(tabs.getByRole('tab', { name: /^Game plan \d to do$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Review game plan' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'More actions', exact: true })).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`header-logistics-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    const keyboard = await everyControlByKeyboard(page, '.trak-wide')
    expect(keyboard.missed).toEqual([])

    // The keyboard moves along the tabs; Evaluation says when it opens.
    await tabs.getByRole('tab', { name: /^Logistics/ }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tabs.getByRole('tab', { name: /^Game plan/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('heading', { name: /^Opens at full time, \d\d:\d\d$/ })).toBeVisible()

    // Review game plan opens Review & share; scrolled, the header is compact and the tabs stay usable.
    await page.getByRole('button', { name: 'Review game plan' }).click()
    await expect(page.getByRole('region', { name: 'Game plan review' })).toBeVisible()
    // The header's, before the stepper's step of the same name.
    await expect(page.getByRole('button', { name: 'Review & share' }).first()).toBeVisible()
    // The "…" menu: Schedule share, and on a phone Save draft, folded in from the top row.
    // Folded, the top row's Save draft is inert: out of reach of the pointer, the keyboard and screen readers.
    expect(await page.getByRole('button', { name: 'Save draft' }).evaluate(el => !!el.closest('[inert]'))).toBe(width < 560)
    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Schedule share' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Save draft' })).toHaveCount(width < 560 ? 1 : 0)
    await page.waitForTimeout(300)
    await page.screenshot({ path: testInfo.outputPath(`header-menu-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await page.mouse.wheel(0, 700)
    const compact = page.getByRole('button', { name: 'vs Parkview Athletic U16, back to top' })
    await expect(compact).toBeVisible()
    await expect(tabs).toBeInViewport()
    await expect(header.getByRole('heading', { level: 1 })).not.toBeInViewport()
    // One scroll, the window's: nothing in the page scrolls on its own.
    const scrollers = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
      const overflow = getComputedStyle(el).overflowY
      return (overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1 && el.offsetParent !== null
    }).map(el => el.className))
    expect(scrollers).toEqual([])
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`header-compact-${width}.png`) })

    // A tab while compact keeps the compact row and shows the top of the new tab.
    await tabs.getByRole('tab', { name: /^Logistics/ }).click()
    await expect(compact).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit event', exact: true })).toBeInViewport()
    const pinnedTabs = (await tabs.boundingBox())!
    expect((await page.getByRole('button', { name: 'Edit event', exact: true }).boundingBox())!.y).toBeGreaterThan(pinnedTabs.y + pinnedTabs.height)
    // The compact title goes back to the top.
    await compact.click()
    await expect(header.getByRole('heading', { level: 1 })).toBeInViewport()
    await expect(header.getByRole('heading', { level: 1 })).toBeFocused()
    await expect(compact).toHaveCount(0)

    // Another match: its own header, and after full time its Evaluation is open.
    await page.goto('/coach/matches/m-past')
    const past = page.getByRole('region', { name: 'vs Lakeside FC U16' })
    await expect(past.getByRole('heading', { level: 1, name: 'vs Lakeside FC U16' })).toBeVisible()
    await expect(matchStatus(page).getByText('Full time')).toBeVisible()
    await expect(tabs.getByRole('tab', { name: 'Evaluation', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Review evaluation' }).click()
    await expect(page.getByRole('region', { name: 'Evaluation review' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Review & publish' })).toBeVisible()
    await tabs.getByRole('tab', { name: /^Evaluation/ }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(tabs.getByRole('tab', { name: /^Game plan/ })).toHaveAttribute('aria-selected', 'true')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`header-past-${width}.png`) })
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}
