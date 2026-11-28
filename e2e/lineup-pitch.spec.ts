import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test'

// TRAK-358 (Season plan 10/18, spec TRAK-348): the match line-up on Formations' pitch, with Bench and Not selected as
// tabs beside it (under it on a tablet and a phone). At 1440, 1280, 834 and 390 the pitch, its eleven places and the
// tabs fit with no sideways scroll; a real pointer drag puts a bench player on the pitch, and another takes a starter
// onto the Not selected tab; every face's markers stay inside the pitch. Production build, synthetic intercepted
// backend that keeps what's saved; synthetic people.
test.use({ timezoneId: 'Asia/Dubai' })

const COACH = '97358000-0000-4000-8000-000000000001'
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const date = new Date(Date.now() + 4 * 60 * MINUTE + 3 * DAY).toISOString().slice(0, 10)
const starts = Date.parse(`${date}T11:00:00+04:00`)
const MATCH = {
  id: 'm-358', coach_user_id: COACH, squad: 'U16', title: 'Match', event_type: 'match', published: true, status: 'scheduled',
  starts_at: new Date(starts).toISOString(), ends_at: new Date(starts + 90 * MINUTE).toISOString(), event_date: date,
  start_time: '11:00:00', end_time: null, meet_time: null, opponent: 'Synthetic Rovers U16', home_away: 'home',
  venue: 'Rehearsal Park', kit: null, kit_snapshot: null, family_note: null, notes: null, series_id: null,
  training_themes: [], cancel_reason: null, source: 'manual', organization_id: 'org-358',
}
// Fourteen in the squad: two keepers, four defenders, five midfielders, three attackers. Attacker 14's family said
// they can't make it.
const LINES: [string, number][] = [['Goalkeeper', 2], ['Defender', 4], ['Midfielder', 5], ['Attacker', 3]]
const PLAYERS = LINES.flatMap(([position, count]) => Array.from({ length: count }, () => position)).map((position, i) => ({
  id: `sq-${i + 1}`, coach_user_id: COACH, player_name: `Synthetic ${position} ${String(i + 1).padStart(2, '0')}`, position,
  age_group: 'U16', shirt_number: i + 1, status: 'active', linked_player_id: null, created_at: '2026-10-01T08:00:00Z',
}))
const PLAN = { event_id: 'm-358', strength: 'similar', their_formation: null, key_players: [], scouting: '', format: 11, formation: '4-4-2',
  goals: [], created_at: '2026-11-01T17:00:00Z', updated_at: '2026-11-01T17:40:00Z' }
// The keeper starts with a job and a lead; a defender at the back is stretched, with context; a midfielder on the bench
// has a job; an attacker is left out with a note.
const LINE_UP = [
  { squad_player_id: 'sq-1', role: 'starter', slot: 1, job: 'Talk to the back four.', note: '', context: [], expectation: 'lead' },
  { squad_player_id: 'sq-3', role: 'starter', slot: 2, job: 'Stay tight to their winger.', note: '', context: ['first_start'], expectation: 'stretch' },
  { squad_player_id: 'sq-7', role: 'bench', slot: null, job: 'Ready at half-time.', note: '', context: [], expectation: 'usual' },
  { squad_player_id: 'sq-12', role: 'not_selected', slot: null, job: '', note: 'Your chance comes Tuesday.', context: [], expectation: 'usual' },
].map(line => ({ event_id: 'm-358', ...line }))

async function backend(context: BrowserContext, unexpected: string[]) {
  const user = { id: COACH, email: 'coach@lineup358.test', email_confirmed_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: COACH, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-lineup358-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  const lineUp = new Map(LINE_UP.map(line => [line.squad_player_id, line as Record<string, unknown>]))
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
    if (path === '/rest/v1/profiles') return json([{ user_id: COACH, id: COACH, role: 'coach', full_name: 'Synthetic Coach' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: COACH, organization_id: 'org-358', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/organizations') return json([{ id: 'org-358', name: 'Rehearsal FC', logo_url: null }])
    if (path === '/rest/v1/squad_players') return json(PLAYERS)
    if (path === '/rest/v1/rpc/coach_squad_player_consent_required') return json(false)
    // TRAK-312: the whole roster in one check; the ids still waiting.
    if (path === '/rest/v1/rpc/coach_squad_players_consent_pending') return json([])
    if (path === '/rest/v1/rpc/my_session_is_live' || path === '/rest/v1/rpc/feature_on') return json(true)
    if (path === '/rest/v1/event_confirmations') return json(PLAYERS.filter(p => p.id !== 'sq-14').map(p => ({ squad_player_id: p.id })))
    if (path === '/rest/v1/event_absences') return json([{ squad_player_id: 'sq-14' }])
    // Can also play: the first attacker plays midfield too.
    if (path === '/rest/v1/squad_player_also_plays') return json([{ squad_player_id: 'sq-12', position: 'Midfielder' }])
    if (path === '/rest/v1/coach_calendar_events') return json([MATCH])
    if (path === '/rest/v1/game_plans' && req.method() === 'POST') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/game_plans') return json([PLAN])
    if (path === '/rest/v1/game_plan_players' && req.method() === 'POST') {
      for (const line of req.postDataJSON() as Record<string, unknown>[]) lineUp.set(line.squad_player_id as string, line)
      return route.fulfill({ status: 201, body: '' })
    }
    if (path === '/rest/v1/game_plan_players') return json([...lineUp.values()])
    // Every other read is empty: this is about the line-up, not the rest of the match.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return json([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
  return lineUp
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
const pitch = (page: Page) => page.getByRole('group', { name: '4-4-2, starting players. Attacking upwards.' })
const place = (page: Page, slot: number) => pitch(page).getByRole('button', { name: new RegExp(`slot ${slot}(,|$)`, 'i') })
const tab = (page: Page, name: 'Bench' | 'Not selected') => page.getByRole('tab', { name: new RegExp(`^${name} · `) })

/** A real drag with the mouse's pointer events: press, move in steps, release over the target. Both ends are brought
 *  on screen first (a coach's own drag scrolls the page near its edges). */
async function drag(page: Page, from: Locator, to: Locator) {
  const height = page.viewportSize()!.height
  const [a0, b0] = [(await from.boundingBox())!, (await to.boundingBox())!]
  await page.evaluate(by => window.scrollBy(0, by), (Math.min(a0.y, b0.y) + Math.max(a0.y + a0.height, b0.y + b0.height)) / 2 - height / 2)
  const a = (await from.boundingBox())!, b = (await to.boundingBox())!
  expect(a.y >= 0 && a.y + a.height <= height && b.y >= 0 && b.y + b.height <= height, 'both ends of the drag are on screen').toBe(true)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
}

for (const [width, height] of [[1440, 900], [1280, 800], [834, 1112], [390, 844]] as const) {
  test(`the line-up at ${width} px: the pitch and its tabs fit, with no sideways scroll; real drags onto a place and a tab`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const lineUp = await backend(context, unexpected)
    await page.setViewportSize({ width, height })
    await page.goto('/coach/matches/m-358?tab=plan')
    await page.getByRole('button', { name: 'Next: Line-up and jobs' }).click()
    await expect(pitch(page)).toBeVisible()
    await expect(tab(page, 'Bench')).toHaveAccessibleName('Bench · 10')
    await expect(tab(page, 'Not selected')).toHaveAccessibleName('Not selected · 1')
    // The markers, in words: the keeper leads with a job; the defender is stretched, with a job and context.
    await expect(place(page, 1)).toHaveAccessibleName('Synthetic Goalkeeper 01, slot 1, lead, has a job')
    await expect(place(page, 2)).toHaveAccessibleName('Synthetic Defender 03, slot 2, stretch, has a job, context: first start')
    await page.waitForTimeout(500)

    // Nothing scrolls sideways, every place and its markers stay inside the pitch, and the tabs stay on screen.
    expect(await sideways(page), `${width} px scrolls sideways`).toBeLessThanOrEqual(0)
    const outside = await pitch(page).evaluate(el => {
      const box = el.getBoundingClientRect()
      return [...el.querySelectorAll('[data-spot^="slot:"], [data-mark]')].map(item => item.getBoundingClientRect())
        .filter(b => b.left < box.left - 1 || b.right > box.right + 1 || b.top < box.top - 1 || b.bottom > box.bottom + 1).length
    })
    expect(outside, 'every place and marker stays inside the pitch').toBe(0)
    await expect(pitch(page).locator('[data-spot^="slot:"]')).toHaveCount(11)
    const [pitchBox, tabsBox] = [(await pitch(page).boundingBox())!, (await page.getByRole('tablist', { name: 'Off the pitch' }).boundingBox())!]
    expect(tabsBox.x + tabsBox.width).toBeLessThanOrEqual(width)
    // TRAK-359: all three tabs sit inside the card, so none is clipped behind the tab list's scroll arrows.
    const clipped = await page.getByRole('tablist', { name: 'Off the pitch' }).evaluate(list => list.parentElement!.scrollWidth - list.parentElement!.clientWidth)
    expect(clipped, 'the three tabs fit without scrolling').toBeLessThanOrEqual(1)
    // Beside the pitch on a laptop and, since TRAK-513's Formations card, a tablet; under it on a phone.
    if (width >= 768) expect(tabsBox.x).toBeGreaterThanOrEqual(pitchBox.x + pitchBox.width)
    else expect(tabsBox.y).toBeGreaterThanOrEqual(pitchBox.y + pitchBox.height)
    await page.screenshot({ path: testInfo.outputPath(`lineup-${width}.png`) })

    // A real drag: the second keeper from the bench onto the keeper's place; the keeper goes to the bench.
    await drag(page, page.getByRole('group', { name: 'Bench' }).getByRole('button', { name: /^Synthetic Goalkeeper 02, bench/ }), place(page, 1))
    await expect(place(page, 1)).toHaveAccessibleName('Synthetic Goalkeeper 02, slot 1')
    await expect(page.getByRole('group', { name: 'Bench' }).getByRole('button', { name: 'Synthetic Goalkeeper 01, bench, lead, has a job' })).toBeVisible()
    // Another: the stretched defender onto the Not selected tab. Left out, he keeps only a note.
    await drag(page, place(page, 2), tab(page, 'Not selected'))
    await expect(place(page, 2)).toHaveAccessibleName('Slot 2, empty')
    await expect(tab(page, 'Not selected')).toHaveAccessibleName('Not selected · 2')
    await tab(page, 'Not selected').click()
    await expect(page.getByRole('group', { name: 'Not selected' }).getByRole('button', { name: 'Synthetic Defender 03, not selected' })).toBeVisible()
    // One panel at a time: the Bench's is hidden, not drawn under this one.
    await expect(page.getByRole('group', { name: 'Bench', exact: true })).toBeHidden()
    expect(await sideways(page)).toBeLessThanOrEqual(0)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`lineup-dragged-${width}.png`) })

    // Saved as the pitch shows it.
    if (width > 560) await page.getByRole('button', { name: 'Save draft' }).click()
    else { await page.getByRole('button', { name: 'More actions', exact: true }).click(); await page.getByRole('menuitem', { name: 'Save draft' }).click() }
    await expect.poll(() => lineUp.get('sq-2')?.slot).toBe(1)
    expect(lineUp.get('sq-1')).toMatchObject({ role: 'bench', slot: null, job: 'Talk to the back four.' })
    expect(lineUp.get('sq-3')).toMatchObject({ role: 'not_selected', slot: null, job: '', context: [], expectation: 'usual' })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}
