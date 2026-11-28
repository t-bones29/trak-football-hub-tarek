import { test, expect, type BrowserContext } from '@playwright/test'
import { createRequire } from 'node:module'
import { openNewEvent } from './new-event'

const require = createRequire(import.meta.url)

// TRAK-182: the coach screens the Arc refresh touches, on the production build
// with a synthetic, intercepted backend. Screenshots at phone width for review;
// no console errors and no unmocked request. Not a deployed-phone acceptance.
const ids = { coach: '97182000-0000-4000-8000-000000000001' }
const players = [
  { id: 'sq-1', player_name: 'Hugo Lloris', position: 'Goalkeeper', age_group: 'U16', shirt_number: 1 },
  { id: 'sq-2', player_name: 'Bukayo Saka', position: 'Defender', age_group: 'U16', shirt_number: 4 },
  { id: 'sq-3', player_name: 'Beth Mead', position: 'Midfielder', age_group: 'U16', shirt_number: 8 },
  { id: 'sq-4', player_name: 'Cole Palmer', position: 'Forward', age_group: 'U16', shirt_number: 9 },
  { id: 'sq-5', player_name: 'Thiago Silva', position: 'Midfielder', age_group: 'U16', shirt_number: 10 },
].map(p => ({ ...p, coach_user_id: ids.coach, status: 'active', linked_player_id: `${p.id}-user`, created_at: '2026-10-01T08:00:00Z' }))

async function coachBackend(context: BrowserContext, unexpected: string[], withMatch = false, cancelled = false, sessionHours = 1) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
  const user = { id: ids.coach, email: 'coach@arc182.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  // A test that moves the page's clock forward needs a session that lasts past it.
  const exp = Math.floor(Date.now() / 1000) + 3600 * sessionHours
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: ids.coach, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-arc182-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  const assessments = players.slice(0, 3).map((p, i) => ({ id: `as-${i}`, squad_player_id: p.id, coach_user_id: ids.coach,
    created_at: `${day}T0${8 - i}:00:00Z`, coach_rating: 8 - i, work_rate: 8, tactical: 7, attitude: 8, technical: 7, physical: 7, coachability: 8,
    squad_players: { player_name: p.player_name } }))
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (rows: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows), headers: { 'content-range': '0-0/1' } })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/profiles') return json([{ user_id: ids.coach, id: ids.coach, role: 'coach', full_name: 'Synthetic Coach' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: ids.coach, organization_id: 'org-182', coach_role: 'Head Coach', team: 'U16' }])
    // TRAK-196: Home's quiet line names the academy.
    if (path === '/rest/v1/organizations') return json([{ id: 'org-182', name: 'Synthetic Academy' }])
    if (path === '/rest/v1/squad_players') {
      const one = url.searchParams.get('id')?.replace(/^eq\./, '')
      return json(one ? players.filter(p => p.id === one) : players)
    }
    // A lookup for one player's session is a first assessment here; lists get the recent three.
    if (path === '/rest/v1/coach_assessments') return json(url.searchParams.has('session_id') ? [] : assessments)
    // withMatch: a published away match tonight, changed 3 h ago; Beth can't make it, Thiago's consent isn't active.
    const match = { id: 'ev-182', coach_user_id: ids.coach, event_type: 'match', title: 'League', event_date: day, start_time: '20:00:00',
      meet_time: '19:15:00', starts_at: `${day}T16:00:00Z`, venue: 'Rivals Park', kit: 'White shirts, black shorts', opponent: 'Rivals FC',
      home_away: 'away', status: cancelled ? 'cancelled' : 'scheduled', published: true, family_note: 'Bring water and shin pads', sequence: 1,
      updated_at: new Date(Date.now() - 3 * 3600_000).toISOString() }
    if (withMatch && path === '/rest/v1/coach_sessions' && url.searchParams.has('event_id')) return json([])
    if (withMatch && path === '/rest/v1/coach_calendar_events') return json([match])
    if (withMatch && path === '/rest/v1/event_absences') return json([{ squad_player_id: 'sq-3', reason: 'school' }])
    if (withMatch && path.startsWith('/rest/v1/rpc/coach_squad_player_consent_required')) return json(req.postDataJSON()?.p_squad_player_id === 'sq-5')
    // TRAK-312: the whole roster in one check; the ids still waiting.
    if (withMatch && path.startsWith('/rest/v1/rpc/coach_squad_players_consent_pending')) return json((req.postDataJSON()?.p_squad_player_ids ?? []).filter((id: string) => id === 'sq-5'))
    if (path === '/rest/v1/coach_sessions') return json([{ id: 'session-1', coach_user_id: ids.coach, title: 'Finishing', session_type: 'training', session_date: day, venue: 'Synthetic pitch' }])
    if (path === '/rest/v1/coach_calendar_events') return json([])
    if (path === '/rest/v1/coach_team_kits') return json([])
    // TRAK-263: the Players view's profile facts (TRAK-260).
    if (path === '/rest/v1/squad_player_profiles') return json([])
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    // TRAK-261: the coach's notification switches (the bell's "Can't make it"); no row means on.
    if (path === '/rest/v1/notification_settings') return json([])
    if (path.startsWith('/rest/v1/rpc/coach_squad_player_consent_required')) return json(false)
    // TRAK-312: the whole roster in one check; the ids still waiting.
    if (path.startsWith('/rest/v1/rpc/coach_squad_players_consent_pending')) return json([])
    if (path === '/rest/v1/rpc/my_session_is_live' || path === '/rest/v1/rpc/feature_on') return json(true)
    // TRAK-350: the season plan's switch is on here, so Home asks for the squad's plan; there is none.
    if (path === '/rest/v1/season_plans') return json([])
    // TRAK-355: who the coach is watching; no one.
    if (path === '/rest/v1/player_watches') return json([])
    // TRAK-353: so a player's page lists their Can also play and roles; there are none.
    if (path === '/rest/v1/squad_player_also_plays' || path === '/rest/v1/squad_player_roles') return json([])
    // TRAK-354: so a player's page lists their objectives; there are none.
    if (path === '/rest/v1/player_objectives') return json([])
    if (path === '/rest/v1/objective_progress') return json([])
    // TRAK-526: each assessment card reads its objective answers; none here (TRAK-538).
    if (path === '/rest/v1/assessment_objectives') return json([])
    if (path === '/rest/v1/rpc/stuck_player_objectives') return json([])
    if (path.startsWith('/rest/v1/rpc/')) return json([])
    if (path === '/rest/v1/session_attendance') return json(players.map(p => ({ session_id: 'session-1', squad_player_id: p.id, status: 'present' })))
    // TRAK-262: notification_settings is Home's Needs you switch (no row: on).
    if (['matches', 'event_absences', 'recognition_awards', 'coach_shared_feedback', 'player_details', 'coach_assessment_notes', 'notification_settings',
      // TRAK-286: no game plan, shared or not.
      'game_plans', 'game_shares', 'game_evaluations', 'game_evaluation_players', 'game_evaluation_notes', 'game_for_family', 'game_for_player', 'game_review_for_family', 'game_review_for_player', 'training_plans', 'training_plan_practices', 'training_notes'].some(t => path === `/rest/v1/${t}`)) return json([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

test.describe('TRAK-182 coach screens', () => {
  test.use({ timezoneId: 'Asia/Dubai', deviceScaleFactor: 3 })
  // TRAK-211: the attention levels moved from Home to the Feedback and assessment tab.
  test('TRAK-189 coach Feedback attention levels remain readable in the light theme', async ({ page, context }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await coachBackend(context, unexpected)
    // All three levels must render; a fixture with only recent assessments
    // cannot check the warning and urgent colours introduced by #365.
    await context.route('**/rest/v1/coach_assessments*', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([30, 15, 0].map((days, i) => ({
        id: `attention-${i}`, squad_player_id: players[i].id, coach_user_id: ids.coach,
        created_at: new Date(Date.now() - days * 86400_000).toISOString(),
      }))),
    }))
    await page.goto('/coach/feedback')
    const overview = page.getByRole('region', { name: 'Feedback and assessment' })
    for (const level of ['Urgent', 'Warning', 'On track']) {
      await expect(overview.getByText(level, { exact: true }).first()).toBeVisible()
    }
    await page.waitForLoadState('networkidle')
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (options: unknown) => Promise<{ violations: unknown[] }> } }).axe
      return (await axe.run({ runOnly: ['color-contrast'] })).violations
    })
    await page.screenshot({ path: testInfo.outputPath('coach-feedback-attention-contrast.png'), fullPage: true })
    expect(violations).toEqual([])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  for (const [name, path, ready] of [
    // TRAK-262: Home's week, Squad shape and Needs you. TRAK-304: with Training and Games on, Today takes Squad shape's place.
    ['home', '/coach/home', 'Today'],
    ['feedback', '/coach/feedback', 'Hugo Lloris'],
    ['squad', '/coach/squad', 'Bukayo Saka'],
    ['assess', '/coach/assess', 'Assessment'],
    // TRAK-368: the player's own page in Squad; the list behind it is hidden, so wait for the page's own section.
    // TRAK-546: "Season so far" is gone from it, so About is the section waited for.
    ['player', '/coach/squad/player/sq-2', 'About Bukayo'],
    // TRAK-418: the coach's own How Trak works, opened from Settings.
    ['how-trak-works', '/coach/how-trak-works', 'Every week'],
  ] as const) {
    test(`coach ${name}`, async ({ page, context }, testInfo) => {
      const unexpected: string[] = [], errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await coachBackend(context, unexpected)
      await page.goto(path)
      await expect(page.getByText(ready).first()).toBeVisible()
      await page.waitForTimeout(400) // let springs settle for the screenshot
      await page.screenshot({ path: testInfo.outputPath(`coach-${name}.png`), fullPage: true })
      expect(unexpected).toEqual([])
      expect(errors).toEqual([])
    })
  }

  // TRAK-496 (Imad, 19 Nov, on his phone): switching weeks shows the week's skeleton until the days load, not a blank strip.
  for (const width of [390, 1280]) test(`at ${width} px, the next week loads behind a skeleton`, async ({ page, context }, testInfo) => {
    const unexpected: string[] = []
    await page.setViewportSize({ width, height: 900 })
    await coachBackend(context, unexpected)
    let release = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let hold = false
    // Registered last, so it runs first: the next week's events wait until the test lets them through.
    await context.route('**/rest/v1/coach_calendar_events*', async route => { if (hold) await held; await route.fallback() })
    await page.goto('/coach/home')
    await expect(page.getByRole('button', { name: 'Next week' })).toBeVisible()
    await page.waitForTimeout(800) // the first week has grown in
    hold = true
    await page.getByRole('button', { name: 'Next week' }).click()
    await page.waitForTimeout(500) // well past any fade
    // The header, the arrows and the next week's seven days stay; only the events wait, behind a skeleton.
    await expect(page.getByRole('heading', { name: 'Next week', level: 2 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Previous week' })).toBeVisible()
    await expect(page.getByRole('group', { name: /^\d+–\d+ / }).getByRole('button')).toHaveCount(7)
    const skeleton = page.locator('[aria-busy="true"] [data-state="skeleton"] > [aria-hidden="true"]')
    await expect(skeleton).toHaveCount(1)
    expect((await skeleton.boundingBox())!.height).toBeGreaterThan(40)
    expect(Number(await skeleton.evaluate(el => getComputedStyle(el).opacity))).toBeGreaterThan(.5)
    await page.screenshot({ path: testInfo.outputPath(`home-week-loading-${width}.png`) })
    release()
    await expect(page.getByRole('listitem').getByText('Nothing planned')).toBeVisible()
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
    expect(unexpected).toEqual([])
  })

  // Imad, 16 Oct: the event sheet's layout, with the names folded behind the avatars and opened.
  test('coach event sheet, a published away match', async ({ page, context }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await coachBackend(context, unexpected, true)
    // The match is tonight at 20:00 Dubai: hold the page before kick-off, or after it
    // the sheet rightly says Attended (TRAK-182) and this check depends on the hour.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
    await page.clock.setFixedTime(new Date(Math.min(Date.now(), Date.parse(`${day}T13:00:00Z`))))
    await page.goto('/coach/home')
    // TRAK-262: tapping the event picks it on the week; Details opens its sheet.
    await page.getByRole('button', { name: /Rivals FC/ }).click()
    await page.getByRole('button', { name: 'Details' }).click()
    const sheet = page.getByRole('dialog', { name: 'vs Rivals FC' })
    await expect(sheet.getByRole('heading', { name: 'Attending · 3' })).toBeVisible()
    await expect(sheet.getByText(/not counted yet: waiting for consent/)).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath('coach-event-sheet-1.png') })
    await sheet.getByRole('button', { name: 'Expand sheet' }).click()
    await sheet.getByRole('button', { name: 'Show names: Attending' }).click()
    await expect(sheet.getByRole('list', { name: 'Attending' }).getByRole('listitem')).toHaveCount(3)
    await page.mouse.move(0, 0) // a phone has no hover; keep the avatar tooltip out of the shot
    await sheet.getByRole('heading', { name: 'Attending · 3' }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath('coach-event-sheet-2-names.png') })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-427: on a laptop the event pop-up is the centred card (TRAK-450), the same from Home's Details and from Events.
  test('coach event pop-up on a laptop: one centred card from Home and from Events', async ({ page, context }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width: 1280, height: 800 })
    await coachBackend(context, unexpected, true)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
    await page.clock.setFixedTime(new Date(Math.min(Date.now(), Date.parse(`${day}T13:00:00Z`))))
    const boxes = []
    for (const path of ['/coach/home', '/coach/schedule']) {
      await page.goto(path)
      // Home picks the event on the week, then Details opens it; on Events the card's title opens it.
      if (path === '/coach/home') {
        await page.getByRole('button', { name: /Rivals FC/ }).first().click()
        await page.getByRole('button', { name: 'Details' }).click()
      } else await page.getByRole('button', { name: 'League', exact: true }).click()
      const card = page.getByRole('dialog', { name: 'vs Rivals FC' })
      await expect(card.getByRole('heading', { name: 'Attending · 3' })).toBeVisible()
      await expect(card.getByRole('button', { name: 'Expand sheet' })).toHaveCount(0)
      await page.waitForTimeout(500)
      await page.screenshot({ path: testInfo.outputPath(`coach-event-popup-laptop${path.replace(/\//g, '-')}.png`) })
      const box = (await card.boundingBox())!
      expect(Math.round(box.width)).toBe(672)
      expect(Math.round(box.x + box.width / 2)).toBe(640)
      boxes.push(box)
    }
    expect(boxes[1]).toEqual(boxes[0])
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-182 part 8: the quick-add's faces: "+", menu, form, saved. TRAK-259: the "+" is Arc's glass menu in the
  // phone's glass tab bar; the form opens above it, and a toast says the draft is saved.
  test('coach quick add, its four states', async ({ page, context }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await coachBackend(context, unexpected)
    // The draft's insert answers like PostgREST.
    await context.route(url => url.pathname === '/rest/v1/coach_calendar_events', route =>
      route.request().method() === 'POST' ? route.fulfill({ status: 201, contentType: 'application/json', body: '[{"id":"new-1"}]' }) : route.fallback())
    await page.goto('/coach/schedule')
    const plus = page.getByRole('button', { name: 'Quick add' })
    await expect(plus).toBeVisible()
    const settle = async () => {
      // motion's springs run in JavaScript: wait until the surface stops moving.
      let last = ''
      for (let i = 0; i < 20; i++) {
        const box = await page.evaluate(() => JSON.stringify((document.querySelector('[data-quick-add]') ?? document.querySelector('[role="menu"]')
          ?? document.querySelector('[data-quick-add-trigger]'))?.getBoundingClientRect()))
        if (box === last) return
        last = box; await page.waitForTimeout(80)
      }
    }
    await settle(); await page.screenshot({ path: testInfo.outputPath('quick-add-1-plus.png') })
    await plus.click()
    await expect(page.getByRole('menu', { name: 'Quick add' })).toBeVisible()
    await settle(); await page.screenshot({ path: testInfo.outputPath('quick-add-2-menu.png') })
    await page.getByRole('menuitem', { name: 'New event' }).click()
    const form = page.getByRole('dialog', { name: 'New event' })
    await expect(form).toBeVisible()
    await settle(); await page.screenshot({ path: testInfo.outputPath('quick-add-3-form.png') })
    // The pickers open upward, whole, inside the screen (Imad, 16 Oct).
    await form.getByRole('button', { name: /^Date\b/ }).click()
    const calendar = page.getByRole('dialog', { name: 'Date calendar' })
    await expect(calendar).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('quick-add-3b-calendar.png') })
    const box = await calendar.boundingBox()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await page.keyboard.press('Escape')
    await form.getByRole('button', { name: /^Start\b/ }).click()
    const list = page.getByRole('listbox')
    await expect(list).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('quick-add-3c-times.png') })
    const listBox = await list.boundingBox()
    expect(listBox!.y).toBeGreaterThanOrEqual(0)
    await list.getByRole('option', { name: '17:00' }).click()
    // TRAK-635: a training needs its title, here as in the full form.
    await form.getByLabel('Title', { exact: true }).fill('Finishing')
    await form.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByText('Draft saved. Publish it from Events.')).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: testInfo.outputPath('quick-add-4-check.png') })
    await expect(form).toHaveCount(0, { timeout: 3000 })
    await expect(page.getByRole('button', { name: 'Quick add', exact: true })).toHaveAttribute('aria-expanded', 'false')
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-182 part 7: Schedule's event form one step per screen, ending in Review.
  test('coach schedule, through the steps', async ({ page, context }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await coachBackend(context, unexpected)
    await page.goto('/coach/schedule')
    await openNewEvent(page)
    const sheet = page.getByRole('dialog', { name: 'New event' })
    await sheet.getByRole('button', { name: 'Match' }).click()
    await sheet.getByLabel('Opponent').fill('Synthetic Rovers')
    // TRAK-288: with Games on, New event asks a match's competition.
    await sheet.getByRole('group', { name: 'Competition' }).getByRole('button', { name: 'League' }).click()
    await sheet.getByRole('button', { name: 'Away' }).click()
    await sheet.getByLabel('Venue (Optional)').fill('Rovers Park')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('coach-schedule-what.png') })
    await sheet.getByRole('button', { name: 'Next' }).click()
    await sheet.getByRole('button', { name: /^Kickoff\b/ }).click()
    await page.getByRole('listbox').getByRole('option', { name: '16:00' }).click()
    await sheet.getByRole('button', { name: 'Next' }).click()
    await sheet.getByRole('textbox', { name: 'Kit (Optional)', exact: true }).fill('Red shirts, black shorts')
    await sheet.getByRole('button', { name: 'Next' }).click()
    await expect(sheet.getByRole('button', { name: 'Publish' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Save draft' })).toBeVisible()
    await expect(sheet.getByText('Synthetic Rovers (Away)')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('coach-schedule-review.png') })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })

  // TRAK-182 part 7: the assessment one step per screen, ending in Review.
  test('coach assess, through the steps', async ({ page, context }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await coachBackend(context, unexpected)
    await page.goto('/coach/assess')
    await page.getByRole('combobox', { name: 'Player' }).click()
    await page.getByRole('option', { name: 'Bukayo Saka' }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    const slider = page.getByRole('slider', { name: 'Work Rate' })
    await slider.focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
    await expect(slider).toHaveAttribute('aria-valuenow', '8')
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('coach-assess-ratings.png'), fullPage: true })
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByLabel(/^Message to/).fill('Great pressing today.')
    await page.getByLabel(/^Private note/).fill('Work on the first touch under pressure.')
    await page.waitForTimeout(300)
    await page.screenshot({ path: testInfo.outputPath('coach-assess-message.png'), fullPage: true })
    // Message and private note share a step (Imad, 16 Oct); Next goes to Review.
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible()
    await expect(page.getByText('Great pressing today.')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('coach-assess-review.png'), fullPage: true })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
})

// TRAK-220 (20 Oct live run): menus and the expanded assessment card were
// see-through on the light theme. Arc's tokens live on `.arc`; a panel Radix
// portals to <body> has no `.arc` ancestor unless it carries the class itself.
// TRAK-425 (Imad, 11 Nov): Assess player fills a laptop's page like the other coach pages, and its step strip goes forward
// as well as back once a player and session are picked. Before that the form is locked, so the strip stays back-only.
test.describe('TRAK-425 Assess player on a laptop', () => {
  test.use({ timezoneId: 'Asia/Dubai', viewport: { width: 1440, height: 900 } })

  test('fills the page, and the steps can be jumped ahead once a player is picked', async ({ page, context }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await coachBackend(context, unexpected)
    await page.goto('/coach/assess')
    const steps = page.getByRole('navigation', { name: 'Assessment steps' })
    await expect(steps).toBeVisible()
    // Not the old 640 px column: the page uses the room beside the side menu.
    expect((await steps.boundingBox())!.width).toBeGreaterThan(800)
    // Nothing picked yet: Review cannot be jumped to.
    await expect(steps.getByRole('button', { name: /Review/ })).toBeDisabled()
    await page.getByRole('combobox', { name: 'Player' }).click()
    await page.getByRole('option', { name: 'Bukayo Saka' }).click()
    // A picked player shows once: the card (with Change) replaces the list.
    await expect(page.getByRole('combobox', { name: 'Player' })).toHaveCount(0)
    await expect(page.getByText('Bukayo Saka')).toHaveCount(1)
    await steps.getByRole('button', { name: /Review/ }).click()
    await expect(page.getByRole('button', { name: 'Publish' }).or(page.getByRole('button', { name: 'Save' })).first()).toBeVisible()
    await steps.getByRole('button', { name: /Ratings/ }).click()
    await expect(page.getByRole('slider', { name: 'Work Rate' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('coach-assess-laptop.png') })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
})

// TRAK-425: on a phone Assess has its own Back and Next bar, so the glass tab bar steps aside: one bar at the bottom, not two.
test.describe('TRAK-425 Assess player on a phone', () => {
  test.use({ timezoneId: 'Asia/Dubai', viewport: { width: 390, height: 844 } })

  test('has one bar at the bottom, and asks no session (TRAK-500)', async ({ page, context }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await coachBackend(context, unexpected)
    await page.goto('/coach/assess')
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Coach' })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Player' }).click()
    await page.getByRole('option', { name: 'Bukayo Saka' }).click()
    await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled()
    await expect(page.getByRole('combobox', { name: 'Session' })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('coach-assess-phone.png') })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
})

test.describe('TRAK-220 Arc panels opened over the page', () => {
  test.use({ timezoneId: 'Asia/Dubai', viewport: { width: 390, height: 844 } })
  // The alpha of an element's computed background colour (0 = see-through).
  const alpha = (css: string) => { const m = css.match(/rgba?\(([^)]+)\)/) ?? css.match(/oklch\(([^)]+)\)/) ?? css.match(/color\(([^)]+)\)/); if (!m) return 0; const slash = m[1].split('/'); if (slash[1]) return Number(slash[1].trim().replace('%', '')) / (slash[1].includes('%') ? 100 : 1); const parts = m[1].split(','); return parts.length === 4 ? Number(parts[3]) : 1 }
  const background = (locator: import('@playwright/test').Locator) => locator.evaluate(el => getComputedStyle(el).backgroundColor)

  test('the card menu, the expanded card and its backdrop are opaque', async ({ page, context }, testInfo) => {
    const unexpected: string[] = []
    await coachBackend(context, unexpected)
    await page.goto('/coach/squad/player/sq-2')
    // TRAK-368: the player's page is an article too, so the card is picked by its name.
    const card = page.getByRole('article', { name: /assessment, Bukayo Saka/ }).first()
    await card.getByRole('button', { name: /more actions$/ }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    expect(alpha(await background(menu)), `menu background ${await background(menu)}`).toBeGreaterThan(0.9)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('coach-card-menu.png') })
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    await card.locator('h3 button').first().click()
    const panel = page.getByRole('dialog')
    await expect(panel.getByText('MESSAGE TO THE PLAYER')).toBeVisible()
    expect(alpha(await background(panel)), `card panel background ${await background(panel)}`).toBeGreaterThan(0.9)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath('coach-card-expanded.png') })
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    expect(unexpected).toEqual([])
  })

  // Imad's 23 Oct phone review: on a scrolled page the quick look rose from under the screen. Motion measured the fixed
  // panel without the page's scroll (it took the panel's layoutScroll for a scroll root) and the card with it, so the
  // grow began a page-scroll below the card. It must begin where the card sits.
  test('on a scrolled page, an assessment card grows from where it sits', async ({ page, context }) => {
    const unexpected: string[] = []
    await coachBackend(context, unexpected)
    await page.goto('/coach/squad')
    await page.getByRole('button', { name: /^Bukayo Saka/ }).click()
    const trigger = page.locator('article[aria-label^="Bukayo Saka"]').locator('h3 button').first()
    // The card a third of the way down, wholly on screen, with the page scrolled.
    await trigger.evaluate(el => scrollTo({ top: el.closest('article')!.getBoundingClientRect().top + scrollY - 280 }))
    // As a coach does: scroll, look, then tap.
    await page.waitForTimeout(150)
    const scrolled = await page.evaluate(() => scrollY)
    expect(scrolled, 'the page must be scrolled for this check to mean anything').toBeGreaterThan(100)
    const cardTop = await trigger.evaluate(el => el.closest('article')!.getBoundingClientRect().top)
    // A tap where the title is, as a finger does: Playwright's locator click can scroll the page first.
    const box = (await trigger.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const firstTop = await page.evaluate(() => new Promise<number>(resolve => {
      const look = () => { const panel = document.querySelector('[role="dialog"]'); if (panel) resolve(panel.getBoundingClientRect().top); else requestAnimationFrame(look) }
      look()
    }))
    expect(Math.abs(firstTop - cardTop), `card at ${Math.round(cardTop)}, quick look began at ${Math.round(firstTop)}, page scrolled ${scrolled}`).toBeLessThan(80)
    await page.keyboard.press('Escape')
    expect(unexpected).toEqual([])
  })
})

// TRAK-541 (Imad's live check, 22 Nov): an opened assessment card's close button sat on its date ("22 N"). The date
// (TRAK-526) and the close button share the quick look's top-right corner; each must show whole, clear of the other.
for (const width of [390, 1280]) {
  test.describe(`TRAK-541 at ${width} px`, () => {
    test.use({ timezoneId: 'Asia/Dubai', viewport: { width, height: 844 } })

    test("an opened assessment card shows its whole date beside the close button", async ({ page, context }, testInfo) => {
      const unexpected: string[] = []
      await coachBackend(context, unexpected)
      // The card reads its objective answers (TRAK-526); this spec's backend doesn't answer that yet (TRAK-538).
      await context.route('**/rest/v1/assessment_objectives*', route => route.fulfill({ json: [] }))
      await page.goto('/coach/squad/player/sq-2')
      const card = page.getByRole('article', { name: /assessment, Bukayo Saka/ }).first()
      await card.locator('h3 button').first().click()
      const panel = page.getByRole('dialog')
      await expect(panel.getByText('MESSAGE TO THE PLAYER')).toBeVisible()
      await page.waitForTimeout(700)
      const date = panel.locator('h2 + span')
      await expect(date).toHaveText(/^\d{1,2} \w{3,}$/)
      const close = panel.getByRole('button', { name: 'Close quick look' })
      const [d, c] = [(await date.boundingBox())!, (await close.boundingBox())!]
      const apart = d.x + d.width <= c.x || c.y + c.height <= d.y || d.y + d.height <= c.y
      expect(apart, `date ${JSON.stringify(d)} and close ${JSON.stringify(c)} overlap`).toBe(true)
      // Whole: nothing of the date is cut off inside its own box.
      expect(await date.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`coach-card-date-${width}.png`) })
      await page.keyboard.press('Escape')
      await expect(panel).toBeHidden()
      expect(unexpected).toEqual([])
    })
  })
}

// TRAK-554 (Kostas, 23 Nov): a published event's "Published" is a state, not a button: it sits at the pop-up's top
// right, under the date and above the kick-off time, not in the row of buttons with Share.
for (const [width, height] of [[1280, 800], [390, 844]] as const) {
  test.describe(`TRAK-554 at ${width} px`, () => {
    test.use({ timezoneId: 'Asia/Dubai', viewport: { width, height } })

    test('the event pop-up says Published at its top right, under the date', async ({ page, context }, testInfo) => {
      const unexpected: string[] = []
      await coachBackend(context, unexpected, true)
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
      // Before tonight's kick-off, so the sheet still offers Share.
      await page.clock.setFixedTime(new Date(Math.min(Date.now(), Date.parse(`${day}T13:00:00Z`))))
      await page.goto('/coach/home')
      await page.getByRole('button', { name: /Rivals FC/ }).first().click()
      await page.getByRole('button', { name: 'Details' }).click()
      const sheet = page.getByRole('dialog', { name: 'vs Rivals FC' })
      const published = sheet.getByText('Published', { exact: true })
      await expect(published).toBeVisible()
      await expect(sheet.getByRole('button', { name: 'Share' })).toBeVisible()
      await page.waitForTimeout(500)
      const [p, title, kickOff, share] = await Promise.all([published.boundingBox(), sheet.getByRole('heading', { name: 'vs Rivals FC' }).boundingBox(),
        sheet.getByText('Kick-off', { exact: true }).boundingBox(), sheet.getByRole('button', { name: 'Share' }).boundingBox()])
      expect(p!.x, 'right of the title').toBeGreaterThan(title!.x + title!.width)
      expect(p!.y + p!.height, 'above the kick-off time').toBeLessThanOrEqual(kickOff!.y)
      expect(p!.y + p!.height, 'above the buttons').toBeLessThan(share!.y)
      await page.screenshot({ path: testInfo.outputPath(`event-published-${width}.png`) })
      expect(unexpected).toEqual([])
    })
  })
}

// Imad's 23 Oct phone review: picking a player in a long list lagged, and the profile under the list needed scrolling to.
// On a phone the profile now takes the list's place, and "All players" returns to the same spot. TRAK-351: on every
// screen a player opens as their own page, and going back returns to the same spot (TRAK-428: by the trail).
test.describe('Squad Players on a phone', () => {
  test.use({ timezoneId: 'Asia/Dubai', viewport: { width: 390, height: 500 } })

  test("a picked player's page replaces the list, and the trail returns to it", async ({ page, context }) => {
    const unexpected: string[] = []
    await coachBackend(context, unexpected)
    await page.goto('/coach/squad')
    const list = page.getByRole('list', { name: 'Players' })
    await expect(list).toBeVisible()
    await page.evaluate(() => scrollTo({ top: 200 }))
    const before = await page.evaluate(() => scrollY)
    await page.getByRole('button', { name: /^Thiago Silva/ }).click()
    const profile = page.locator('article[aria-label^="Thiago Silva"]')
    await expect(profile).toBeInViewport()
    await expect(list).toBeHidden()
    await page.getByRole('navigation', { name: 'Breadcrumb trail' }).getByRole('link', { name: 'Squad' }).click()
    await expect(list).toBeVisible()
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(before)
    expect(unexpected).toEqual([])
  })
})

// TRAK-221 (20 Oct live run): scrolling the assessment with a finger that
// lands on a slider changed that rating. Real touches through Chromium's touch
// input, so the browser's own scroll, cancel and capture rules apply (jsdom
// has none of them).
test.describe('TRAK-221 assessment sliders under a finger', () => {
  test.use({ timezoneId: 'Asia/Dubai', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a vertical swipe scrolls without changing a rating; a tap and a sideways drag still set one', async ({ page, context }) => {
    const unexpected: string[] = []
    await coachBackend(context, unexpected)
    await page.goto('/coach/assess')
    await page.getByRole('combobox', { name: 'Player' }).click()
    await page.getByRole('option', { name: 'Bukayo Saka' }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    const cdp = await context.newCDPSession(page)
    const finger = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
    const row = async (name: string) => {
      const slider = page.getByRole('slider', { name })
      await slider.scrollIntoViewIfNeeded()
      const box = (await slider.locator('xpath=ancestor::div[contains(@class, "control")][1]').boundingBox())!
      return { slider, box, y: box.y + box.height / 2 }
    }

    // Vertical swipe starting at 85% across Work Rate: no rating moves.
    const work = await row('Work Rate')
    const before = await page.getByRole('slider').evaluateAll(all => all.map(s => s.getAttribute('aria-valuenow')))
    const x = work.box.x + work.box.width * 0.85
    await finger('touchStart', x, work.y)
    for (let i = 1; i <= 12; i++) { await finger('touchMove', x, work.y - i * 15); await page.waitForTimeout(16) }
    await finger('touchEnd')
    await page.waitForTimeout(400)
    expect(await page.getByRole('slider').evaluateAll(all => all.map(s => s.getAttribute('aria-valuenow')))).toEqual(before)

    // A tap near the right end sets a high rating.
    const tactical = await row('Tactical')
    await page.touchscreen.tap(tactical.box.x + tactical.box.width * 0.95, tactical.y)
    await expect(tactical.slider).toHaveAttribute('aria-valuenow', '10')

    // A sideways drag from the middle to the left end sets the lowest.
    const attitude = await row('Attitude')
    const from = attitude.box.x + attitude.box.width * 0.5
    await finger('touchStart', from, attitude.y)
    for (let i = 1; i <= 12; i++) { await finger('touchMove', from - i * attitude.box.width * 0.05, attitude.y + i); await page.waitForTimeout(16) }
    await finger('touchEnd')
    await expect(attitude.slider).toHaveAttribute('aria-valuenow', '0')
    expect(unexpected).toEqual([])
  })
})

// TRAK-227 (20 Oct live run, S1): on a phone the event form's date calendar
// dropped past the end of the sheet's scroll area, so the coach had to scroll
// to see it and to get back to Next. Layout, so a real browser measures it.
test.describe('TRAK-227 date and time pickers in the event form', () => {
  test.use({ timezoneId: 'Asia/Dubai', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the calendar and the time list open fully visible, and Next is reachable after a pick', async ({ page, context }) => {
    const unexpected: string[] = []
    await coachBackend(context, unexpected)
    await page.goto('/coach/schedule')
    await openNewEvent(page)
    const sheet = page.getByRole('dialog', { name: 'New event' })
    // TRAK-635: a training needs its title before Next.
    await sheet.getByLabel('Title', { exact: true }).fill('Finishing')
    await sheet.getByRole('button', { name: 'Next', exact: true }).click()
    // Fully inside every scroll area it sits in, and inside the screen.
    const fullyVisible = (panel: import('@playwright/test').Locator) => panel.evaluate(el => {
      const box = el.getBoundingClientRect()
      let top = 0, bottom = innerHeight
      for (let node = el.parentElement; node; node = node.parentElement) {
        if (!['auto', 'scroll', 'hidden'].includes(getComputedStyle(node).overflowY)) continue
        const r = node.getBoundingClientRect(); top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom)
      }
      return box.top >= top - 1 && box.bottom <= bottom + 1
    })
    await sheet.getByRole('button', { name: 'Date', exact: true }).click()
    const calendar = page.getByRole('dialog', { name: /calendar$/ })
    await expect.poll(() => fullyVisible(calendar)).toBe(true)
    await calendar.locator('[data-date]:not([disabled])').last().click()
    await expect(calendar).toBeHidden()
    const next = sheet.getByRole('button', { name: 'Next', exact: true })
    const box = (await next.boundingBox())!
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent?.trim(), [box.x + box.width / 2, box.y + box.height / 2])).toBe('Next')
    await sheet.getByRole('button', { name: /^Start/ }).click()
    await expect.poll(() => fullyVisible(page.getByRole('listbox'))).toBe(true)
    expect(unexpected).toEqual([])
  })
})

// Cancelled and Other must differ by shape even on the green selected day.
// The backend dates the event by Dubai's day, so the page must be on Dubai's day
// too: on UTC it picked yesterday from 20:00 to 24:00 UTC and found no mark.
test.describe('TRAK-189 calendar on Dubai time', () => {
  test.use({ timezoneId: 'Asia/Dubai' })
  test('TRAK-189 cancelled calendar mark stays hollow and readable when selected', async ({ page, context }, testInfo) => {
    const unexpected: string[] = []
    await coachBackend(context, unexpected, true, true)
    await page.goto('/coach/schedule')
    const day = page.getByRole('gridcell', { selected: true })
    const ring = day.locator('[aria-hidden="true"] > span').first()
    await expect(ring).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(ring).toHaveCSS('border-top-style', 'solid')
    // A neutral backing keeps the red outline distinct from the green disc.
    await expect(ring.locator('..')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await page.screenshot({ path: testInfo.outputPath('cancelled-calendar-selected.png'), fullPage: true })
    // TRAK-270 (Tarek, 23 Oct): needs you is a clear yellow, not the warning amber, with a dark edge.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t-attention').trim())).toBe('234 179 8')
    const needsYou = page.getByRole('group', { name: 'Colour key' }).getByText('Needs you').locator('xpath=preceding-sibling::div[1]')
    await expect(needsYou.locator('div')).toHaveCSS('background-color', 'rgb(234, 179, 8)')
    await expect(needsYou).toHaveCSS('filter', /drop-shadow/)
    // TRAK-270 (Tarek, 23 Oct): the legend's mark is coach Home's corner, not a triangle.
    await expect(needsYou.locator('div')).toHaveCSS('clip-path', 'polygon(0px 0px, 100% 0px, 100% 100%)')
    // TRAK-272, TRAK-275: a card's actions are big enough to tap, and tapping the card opens its sheet. TRAK-508 (20 Nov):
    // Share is a green next-step button at the card's bottom right, out of the outline group of icons.
    await expect(page.getByRole('group', { name: 'Actions for League' }).getByRole('button', { name: 'Share League' })).toHaveCount(0)
    const share = page.getByRole('button', { name: 'Share League' })
    expect((await share.boundingBox())!.height).toBeGreaterThanOrEqual(36)
    await page.getByText('Kit: White shirts, black shorts').click()
    // A match's sheet is titled by its opponent, as on coach Home.
    await expect(page.getByRole('dialog', { name: 'vs Rivals FC' })).toBeVisible()
    expect(unexpected).toEqual([])
  })

  // TRAK-270 (Tarek, 23 Oct): "make it the same way it is on the home screen". A day that needs the
  // coach (tonight's match, started, not logged) has coach Home's yellow corner flag, tucked into the
  // day's top-right corner, not a triangle standing out of it.
  test('TRAK-270 needs you is coach Home\'s corner flag, inside the day', async ({ page, context }, testInfo) => {
    const unexpected: string[] = []
    await coachBackend(context, unexpected, true, false, 36)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
    await page.clock.setFixedTime(new Date(`${day}T17:00:00Z`)) // 21:00 in Dubai: the 20:00 kick-off has passed
    await page.goto('/coach/schedule')
    const cell = page.getByRole('gridcell', { name: /needs you/ })
    await expect(cell).toHaveCount(1)
    const flag = cell.locator('[aria-hidden="true"]').filter({ hasNot: page.locator('span') }).first()
    await expect(flag).toHaveCSS('clip-path', 'polygon(0px 0px, 100% 0px, 100% 100%)')
    await expect(flag).toHaveCSS('border-top-right-radius', '4px')
    await expect(flag).toHaveCSS('background-color', 'rgb(234, 179, 8)')
    const [f, c] = [(await flag.boundingBox())!, (await cell.boundingBox())!]
    expect(f.x).toBeGreaterThanOrEqual(c.x)
    expect(f.y).toBeGreaterThanOrEqual(c.y)
    expect(f.x + f.width).toBeLessThanOrEqual(c.x + c.width)
    expect(f.y + f.height).toBeLessThanOrEqual(c.y + c.height)
    await cell.screenshot({ path: testInfo.outputPath('needs-you-corner.png'), scale: 'device' })
    expect(unexpected).toEqual([])
  })
})

// TRAK-495 (Imad, 19 Nov): on Home, the Needs you badge is the corner's yellow, the item says only "Played", and Details
// looks like a button before any hover. Tonight's match is over and not evaluated, so it needs the coach.
test.describe('TRAK-495 coach Home', () => {
  test.use({ timezoneId: 'Asia/Dubai', deviceScaleFactor: 2 })
  for (const width of [390, 1280]) {
    test(`at ${width} px: one yellow, "Played", and a Details button`, async ({ page, context }, testInfo) => {
      const unexpected: string[] = []
      await page.setViewportSize({ width, height: 900 })
      await coachBackend(context, unexpected, true, false, 36)
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
      await page.clock.setFixedTime(new Date(`${day}T19:30:00Z`)) // 23:30 in Dubai: the 20:00 match is over
      await page.goto('/coach/home')
      const badge = page.getByRole('button', { name: /Rivals FC/ }).getByText('Needs you', { exact: true })
      // The label sits in a span inside the badge; the yellow is the badge's own background.
      await expect.poll(() => badge.evaluate(el => getComputedStyle(el.closest('[class*="badge"]')!).backgroundColor)).toBe('rgb(234, 179, 8)')
      await expect(page.getByText('Played', { exact: true }).first()).toBeVisible()
      await expect(page.getByText(/not (evaluated|logged) yet/)).toHaveCount(0)
      const details = page.getByRole('button', { name: 'Details', exact: true })
      await expect(details).toBeVisible()
      expect(await details.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
      await page.waitForTimeout(400) // let springs settle for the screenshot
      await page.screenshot({ path: testInfo.outputPath(`home-trak495-${width}.png`) })
      expect(unexpected).toEqual([])
    })
  }
})

// Imad, 23 Oct: event times follow the phone's own clock. Tonight's away match is 20:00 at a Dubai academy.
test.describe("Event times on the phone's clock", () => {
  const kickOff = (timeZone: string, day: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(`${day}T16:00:00Z`))

  for (const [timeZone, academyLine] of [['Asia/Dubai', false], ['Europe/Athens', true]] as const) {
    test(`a phone in ${timeZone}`, async ({ browser }) => {
      const context = await browser.newContext({ timezoneId: timeZone, viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      const unexpected: string[] = []
      // A session that lasts past the clock set below.
      await coachBackend(context, unexpected, true, false, 36)
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date())
      // TRAK-292: 13:00Z is 17:00 in Dubai and 15:00 (16:00 in summer) in Athens: the match's day on both clocks,
      // before its 20:00 kick-off, whenever the suite runs. The real clock failed from 20:00 to 22:00 UTC, when
      // Dubai is already on the next day and Athens isn't.
      await page.clock.setFixedTime(new Date(`${day}T13:00:00Z`))
      await page.goto('/coach/home')
      await page.getByRole('button', { name: /Rivals FC/ }).click()
      await page.getByRole('button', { name: 'Details' }).click()
      const sheet = page.getByRole('dialog', { name: 'vs Rivals FC' })
      await expect(sheet.getByText(kickOff(timeZone, day), { exact: true })).toBeVisible()
      if (academyLine) await expect(sheet.getByText('20:00 Dubai time', { exact: true })).toBeVisible()
      else await expect(sheet.getByText(/Dubai time|Athens time|on this phone/)).toHaveCount(0)
      expect(unexpected).toEqual([])
      await context.close()
    })
  }
})

// Imad, 23 Oct: in the "+" form the date and time pickers opened upward and were cut off by the form's own edge (its
// shape clips while it moves, and the side-picker didn't count `clip`). Once the form has settled they open whole.
test.describe('The "+" form\'s pickers on a phone', () => {
  test.use({ timezoneId: 'Asia/Dubai', viewport: { width: 390, height: 844 } })

  test('the date calendar and the time list open fully on screen', async ({ page, context }) => {
    const unexpected: string[] = []
    await coachBackend(context, unexpected)
    await page.goto('/coach/home')
    await page.getByRole('button', { name: 'Quick add' }).click()
    await page.getByText('New event', { exact: true }).click()
    await page.waitForTimeout(600)
    // Whole on screen, and not cut by an ancestor: the point a little inside each corner is the panel itself.
    const whole = (selector: string) => page.evaluate(sel => {
      const panel = document.querySelector(sel) as HTMLElement
      const r = panel.getBoundingClientRect()
      const inside = [[r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8]]
        .every(([x, y]) => panel.contains(document.elementFromPoint(x, y)))
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), inside }
    }, selector)
    await page.getByRole('button', { name: 'Date', exact: true }).click()
    await page.waitForTimeout(500)
    const calendar = await whole('[role="dialog"][aria-label$="calendar"]')
    expect(calendar.top, JSON.stringify(calendar)).toBeGreaterThanOrEqual(0)
    expect(calendar.inside, JSON.stringify(calendar)).toBe(true)
    await page.keyboard.press('Escape')
    // The form's own Start time (TRAK-350 put the season plan's Start on Home, behind the form).
    await page.getByRole('dialog', { name: 'New event' }).getByRole('button', { name: /^Start/ }).click()
    await page.waitForTimeout(500)
    const times = await whole('[role="listbox"]')
    expect(times.top, JSON.stringify(times)).toBeGreaterThanOrEqual(0)
    expect(times.inside, JSON.stringify(times)).toBe(true)
    expect(unexpected).toEqual([])
  })
})

// TRAK-420 (11 Nov review): on a phone the Log page squeezed the trail, "What are you logging?" and History onto one
// line. The trail gets its own line, the title sits under it, and History touches neither. A laptop shows the trail in
// its top bar, so the page itself shows only the title and History, on one line.
test.describe('TRAK-420 Log page header', () => {
  test.use({ timezoneId: 'Asia/Dubai' })
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

  for (const [name, width, height] of [['phone', 390, 844], ['laptop', 1440, 900]] as const) {
    test(`on a ${name}, the trail, the title and History do not touch`, async ({ page, context }, testInfo) => {
      const unexpected: string[] = [], errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.setViewportSize({ width, height })
      await coachBackend(context, unexpected)
      // TRAK-426: the Log page is there only where Training or Matches is off; here Training is off.
      await context.route('**/rest/v1/rpc/feature_on', route => route.fulfill({ contentType: 'application/json',
        body: JSON.stringify(route.request().postDataJSON()?.p_feature !== 'training') }))
      await page.goto('/coach/sessions')
      const title = page.getByRole('heading', { name: 'What are you logging?' })
      const history = page.getByRole('button', { name: 'History' })
      await expect(title).toBeVisible()
      const titleBox = (await title.boundingBox())!, historyBox = (await history.boundingBox())!
      expect(overlap(titleBox, historyBox), 'title and History overlap').toBe(false)
      if (name === 'phone') {
        // On a phone the page's own trail is the only one.
        const trail = page.getByRole('navigation', { name: 'Breadcrumb' })
        await expect(trail).toBeVisible()
        const trailBox = (await trail.boundingBox())!
        // Its own line: the trail ends above the title and above History.
        expect(trailBox.y + trailBox.height, 'the trail must sit above the title').toBeLessThanOrEqual(titleBox.y)
        expect(trailBox.y + trailBox.height, 'the trail must sit above History').toBeLessThanOrEqual(historyBox.y)
      }
      await page.waitForTimeout(300)
      await page.screenshot({ path: testInfo.outputPath(`coach-log-header-${name}.png`) })
      expect(unexpected).toEqual([])
      expect(errors).toEqual([])
    })
  }
})

// TRAK-415: below 1024 px the frame drew pages with no `.arc` around them, so a player's radar chart, band chip and
// avatar lost Arc's colours and sizes. Any part from an Arc stylesheet must sit inside `.arc`.
for (const width of [390, 820]) {
  test(`TRAK-415 at ${width} px: a player's page keeps Arc's styling`, async ({ page, context }) => {
    const unexpected: string[] = []
    await page.setViewportSize({ width, height: 900 })
    await coachBackend(context, unexpected)
    await page.goto('/coach/squad/player/sq-2')
    await expect(page.getByRole('heading', { name: 'Bukayo Saka', level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const outside = await page.evaluate(() => [...document.querySelectorAll('[class]')]
      .filter(el => /(?:^|\s)_[A-Za-z]+_[a-z0-9]{4,6}_\d+/.test(el.getAttribute('class') ?? '') && !el.closest('.arc') && el.getBoundingClientRect().width > 0)
      .map(el => `${el.getAttribute('class')} "${(el.textContent ?? '').trim().slice(0, 30)}"`))
    expect(outside).toEqual([])
    expect(unexpected).toEqual([])
  })
}

// TRAK-428 (11 Nov review): on a phone a player's page opened with two ways back (a Back button, then the trail), the
// band badge cut the name ("Giourkas Sei…"), and the Published button cut the card's band ("Mix…").
test("TRAK-428 at 390 px: a player's page has one way back, and neither the name nor a card's band is cut", async ({ page, context }, testInfo) => {
  const unexpected: string[] = []
  await page.setViewportSize({ width: 390, height: 844 })
  await coachBackend(context, unexpected)
  // Added after coachBackend, so they answer first: the reviewed name, and the longest band word ("Exceptional").
  const roster = players.map(p => p.id === 'sq-2' ? { ...p, player_name: 'Giourkas Seitaridis' } : p)
  await context.route('**/rest/v1/squad_players?*', route => {
    const one = new URL(route.request().url()).searchParams.get('id')?.replace(/^eq\./, '')
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(one ? roster.filter(p => p.id === one) : roster) })
  })
  await context.route('**/rest/v1/coach_assessments?*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{
    id: 'as-9', squad_player_id: 'sq-2', coach_user_id: ids.coach, created_at: '2026-11-10T08:00:00Z', published_at: '2026-11-10T09:00:00Z',
    coach_rating: 10, work_rate: 10, tactical: 10, attitude: 10, technical: 10, physical: 10, coachability: 10, squad_players: { player_name: 'Giourkas Seitaridis' } }]) })) // TRAK-556: Exceptional is a 10
  await page.goto('/coach/squad')
  await page.getByRole('button', { name: /^Giourkas Seitaridis/ }).click()
  const profile = page.locator('article[aria-label^="Giourkas Seitaridis,"]')
  const card = profile.getByRole('article', { name: /assessment, Giourkas Seitaridis/ })
  await expect(card.getByRole('button', { name: 'Published more actions' })).toBeVisible()
  const cut = (locator: import('@playwright/test').Locator) => locator.evaluate(el => el.scrollWidth > el.clientWidth)

  await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0)
  const trail = page.getByRole('navigation', { name: 'Breadcrumb trail' })
  await expect(trail).toBeInViewport()
  expect(await cut(profile.getByRole('heading', { level: 3, name: 'Giourkas Seitaridis' }))).toBe(false)
  // The card's overall band, in its footer beside Published (each bar above shows its own band too).
  const band = card.locator('[class*="_meta_"]')
  await expect(band).toHaveText('Exceptional')
  expect(await cut(band)).toBe(false)
  await page.waitForTimeout(1500) // let the assessments grow in for the screenshot
  await page.screenshot({ path: testInfo.outputPath('player-page-390.png'), fullPage: true })
  // Narrower than the band and the button side by side: the button takes a line of its own, and the band stays whole.
  await page.setViewportSize({ width: 320, height: 844 })
  await expect.poll(() => cut(band)).toBe(false)
  await card.screenshot({ path: testInfo.outputPath('assessment-card-320.png') })

  await trail.getByRole('link', { name: 'Squad' }).click()
  await expect(page.getByRole('list', { name: 'Players' })).toBeVisible()
  expect(unexpected).toEqual([])
})
