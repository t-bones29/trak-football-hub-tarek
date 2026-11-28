import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { openNewEvent } from './new-event'

// TRAK-199 (team decision, 21 Oct): a coach's screens use a tablet's or a laptop's
// width; a phone, upright or sideways, keeps today's layout, and so does every
// player and parent screen. Layout only. Production build, synthetic intercepted backend.
const ids = { coach: '97199000-0000-4000-8000-000000000001', player: '97199000-0000-4000-8000-000000000002', parent: '97199000-0000-4000-8000-000000000003' }
// TRAK-441 slice 2: the parent's two children.
const children = [{ user_id: 'child-199-a', full_name: 'Kostas Manolas' }, { user_id: 'child-199-b', full_name: 'Sokratis Papastathopoulos' }]
type Role = keyof typeof ids
const players = ['Hugo Lloris', 'Bukayo Saka', 'Beth Mead', 'Cole Palmer', 'Ella Toone', 'Declan Rice'].map((name, i) => ({
  id: `sq-${i + 1}`, coach_user_id: ids.coach, player_name: name, position: 'Defender', age_group: 'U16', shirt_number: i + 1,
  status: 'active', linked_player_id: `sq-${i + 1}-user`, created_at: '2026-10-01T08:00:00Z',
}))

async function backend(context: BrowserContext, role: Role, unexpected: string[], features: string[] = ['events']) {
  const id = ids[role]
  const user = { id, email: `${role}@wide199.test`, email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-wide199-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    const json = (rows: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows), headers: { 'content-range': '0-0/1' } })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const path = url.pathname
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (path === '/rest/v1/profiles' && role === 'parent' && !url.searchParams.get('user_id')?.includes(id)) return json(children)
    if (path === '/rest/v1/player_parent_links' && role === 'parent') return json(children.map(child => ({ player_user_id: child.user_id })))
    if (path === '/rest/v1/profiles') return json([{ user_id: id, id, role, full_name: role === 'coach' ? 'Synthetic Coach' : role === 'parent' ? 'Eleni Seitaridi' : 'Synthetic Player' }])
    if (path === '/rest/v1/coach_details') return json([{ user_id: ids.coach, organization_id: 'org-199', coach_role: 'Head Coach', team: 'U16' }])
    if (path === '/rest/v1/squad_players' && role === 'coach') {
      const one = url.searchParams.get('id')?.replace(/^eq\./, '')
      return json(one ? players.filter(p => p.id === one) : players)
    }
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, granted: true, invited_parent: null })
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    // Events on; Games (TRAK-283) and Training (TRAK-294) off, as for every academy until they are switched on, unless a
    // test switches them on.
    if (path === '/rest/v1/rpc/feature_on') return json(features.includes(req.postDataJSON()?.p_feature))
    // TRAK-441: a player's or parent's switch (family_look) is read through family_feature_on.
    if (path === '/rest/v1/rpc/family_feature_on') return json(features.includes(req.postDataJSON()?.p_feature))
    if (path.startsWith('/rest/v1/rpc/coach_squad_player_consent_required')) return json(false)
    // TRAK-312: the whole roster in one check; the ids still waiting.
    if (path.startsWith('/rest/v1/rpc/coach_squad_players_consent_pending')) return json([])
    // TRAK-250: the Squad tabs' reads. Two latest bands for three children, so Snapshot has columns to show.
    if (path === '/rest/v1/coach_assessments') return json(role === 'coach' ? [
      { squad_player_id: 'sq-1', coach_rating: 9, created_at: '2026-10-10T10:00:00Z', work_rate: 4, technical: 4, physical: 4, coachability: 4, attitude: 4, tactical: 4 },
      { squad_player_id: 'sq-2', coach_rating: 7, created_at: '2026-10-10T10:00:00Z', work_rate: 3, technical: 3, physical: 3, coachability: 3, attitude: 3, tactical: 3 },
      { squad_player_id: 'sq-3', coach_rating: 5, created_at: '2026-10-10T10:00:00Z', work_rate: 2, technical: 3, physical: 2, coachability: 3, attitude: 2, tactical: 3 },
    ] : [])
    if (['/rest/v1/coach_sessions', '/rest/v1/session_attendance', '/rest/v1/rpc/coach_squad_season', '/rest/v1/coach_calendar_events',
      '/rest/v1/event_confirmations', '/rest/v1/event_absences'].includes(path)) return json([])
    // TRAK-441: a family's week has today's match, so the picker's footer shows Details (and a parent's red Can't make it).
    if (path === '/rest/v1/rpc/child_events') return json([{ id: 'ev-199', event_type: 'match', title: 'League', opponent: 'Rivals FC',
      event_date: new Date().toLocaleDateString('en-CA'), start_time: '23:30:00', status: 'scheduled', sequence: 0, updated_at: '2026-11-01T00:00:00Z' }])
    // Layout only: every other read is empty.
    if (path.startsWith('/rest/v1/')) return json(req.method() === 'GET' || path.startsWith('/rest/v1/rpc/') ? [] : null)
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

async function open(page: Page, context: BrowserContext, role: Role, path: string, width: number, height: number, features?: string[]) {
  const unexpected: string[] = [], errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width, height })
  await backend(context, role, unexpected, features)
  await page.goto(path)
  return { unexpected, errors }
}

// [screen, width, height, page width]
for (const [label, width, height, pageWidth] of [
  ['a phone', 390, 844, 390],
  ['a phone turned sideways', 844, 390, 430],
  ['an upright tablet', 820, 1180, 820], // TRAK-307: the menu pages' one column, 32 px from each side
] as const) {
  test(`coach Home on ${label}: the page, and the glass tab bar with the "+" under it`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', width, height)
    await expect(page.getByRole('heading', { name: 'Squad shape' })).toBeVisible()

    // TRAK-259: Home, Squad and Library, with the "+" merged in at the right; no Calendar, Feedback or Profile tab.
    const bar = page.getByRole('tablist', { name: 'Coach' })
    await expect(bar.getByRole('tab')).toHaveText(['Home', 'Squad', 'Library'])
    const shell = await box(page, '.trak-wide')
    expect(Math.round(shell.width)).toBe(pageWidth)
    expect(Math.round(shell.x + shell.width / 2)).toBe(Math.round(width / 2))
    const nav = (await page.getByRole('navigation', { name: 'Coach' }).boundingBox())!
    const plus = (await page.getByRole('button', { name: 'Quick add' }).boundingBox())!
    // The bar floats above the bottom edge, centred, with the "+" beside it inside the screen.
    expect(nav.y + nav.height).toBeLessThan(height)
    expect(Math.abs(nav.x + nav.width / 2 - width / 2)).toBeLessThanOrEqual(1)
    expect(plus.x).toBeGreaterThan((await bar.boundingBox())!.x)
    expect(plus.x + plus.width).toBeLessThanOrEqual(width)
    // The avatar (top left) opens the side menu; the calendar sits beside the bell.
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Events' })).toBeVisible() // TRAK-255; TRAK-449
    await page.screenshot({ path: testInfo.outputPath(`coach-home-${width}.png`) })
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('coach Home on a laptop: the sidebar on the left, "+ Create" at the top right, the page beside it', async ({ page, context }, testInfo) => {
  const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', 1440, 900)
  await expect(page.getByRole('heading', { name: 'Squad shape' })).toBeVisible()

  // TRAK-259: Arc's sidebar rail. The club, then Home, Calendar, Squad, Library; Settings and the coach at the bottom.
  const sidebar = page.getByRole('navigation', { name: 'Your academy' })
  const rows = sidebar.getByRole('button')
  await expect(rows).toHaveText(['Home', 'Events', 'Squad', 'Library', 'Settings']) // TRAK-255; TRAK-449
  const rail = await sidebar.evaluate(el => el.closest('[id$="-sidebar"]')!.getBoundingClientRect().toJSON() as DOMRect)
  expect([rail.x, rail.y, rail.width, rail.height].map(Math.round)).toEqual([0, 0, 240, 900])
  const [first, last] = [(await rows.first().boundingBox())!, (await rows.last().boundingBox())!]
  expect(last.y + last.height).toBeGreaterThan(900 - 140)
  await expect(page.getByText('Synthetic Coach').first()).toBeVisible()
  expect(first.x).toBeLessThan(240)
  await page.waitForTimeout(600) // let the radar draw in for the screenshot
  await page.screenshot({ path: testInfo.outputPath('coach-home-1440.png') })
  // "+ Create" at the top right, after the bell; it opens the same menu.
  const create = page.getByRole('button', { name: 'Create' })
  const createBox = (await create.boundingBox())!
  expect(createBox.x + createBox.width).toBeGreaterThan(1440 - 40)
  expect(createBox.y).toBeLessThan(60)
  await create.click()
  // TRAK-265: Arc's Action morph; the button grows into the menu, titled "Create", with a close button.
  await expect(page.getByRole('menu', { name: 'Create' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close create' })).toBeVisible()
  await expect(page.getByRole('tablist', { name: 'Coach' })).toHaveCount(0)

  // TRAK-262: Home takes the wide column on a laptop, the week and Squad shape side by side. TRAK-307: the menu pages'
  // one column, up to 1,280 px, so the whole 1,200 px beside the sidebar here.
  const shell = await box(page, '.trak-wide')
  expect(Math.round(shell.width)).toBe(1200)
  expect(Math.round(shell.x + shell.width / 2)).toBe(240 + (1440 - 240) / 2)
  const [week, shape] = [(await page.getByRole('region', { name: 'This week' }).boundingBox())!, (await page.getByRole('region', { name: 'Squad shape' }).boundingBox())!]
  expect(shape.x).toBeGreaterThan(week.x + week.width - 1)
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

test("a coach's Settings sits in the frame on a laptop; on a phone it keeps no bottom bar", async ({ page, context }, testInfo) => {
  await open(page, context, 'coach', '/settings', 1440, 900)
  await expect(page.getByText('Synthetic Coach').first()).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Your academy' }).getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('navigation', { name: 'Your academy' })).toHaveCount(0)
  await expect(page.getByRole('tablist', { name: 'Coach' })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('coach-settings-390.png'), fullPage: true })
})

// TRAK-430: the side menu's rows sit at the same height on Settings as on Home (one squad: the picker's empty slot stays).
test('TRAK-430: the side menu does not jump between Home and Settings on a laptop', async ({ page, context }) => {
  const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', 1440, 900)
  const home = page.getByRole('navigation', { name: 'Your academy' }).getByRole('button', { name: /^Home/ })
  await expect(home).toHaveAttribute('aria-current', 'page')
  const top = (await home.boundingBox())!.y
  await page.goto('/settings')
  await expect(page.getByRole('navigation', { name: 'Your academy' }).getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
  expect((await home.boundingBox())!.y).toBe(top)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-261: a coach's Settings is Arc's settings page, its section menu beside the sections, in the wide column.
test("a coach's Settings is Arc's settings page in the wide column on a laptop", async ({ page, context }, testInfo) => {
  const { unexpected } = await open(page, context, 'coach', '/settings', 1440, 900)
  await expect(page.getByRole('textbox', { name: 'Full name' })).toHaveValue('Synthetic Coach')
  const column = await box(page, '.trak-wide')
  expect(Math.round(column.x + column.width / 2)).toBe(240 + (1440 - 240) / 2)
  const menu = (await page.getByRole('navigation', { name: 'Settings sections' }).boundingBox())!
  const profile = (await page.getByRole('heading', { name: 'Profile', exact: true }).boundingBox())!
  expect(profile.x).toBeGreaterThan(menu.x + menu.width)
  await expect(page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button')).toHaveText(['Profile', 'Club', 'Language', 'Notifications', 'How Trak works', 'Account'])  // TRAK-406: Language
  await page.screenshot({ path: testInfo.outputPath('coach-settings-1440.png') })
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
})

// TRAK-459: on a laptop the section menu stays in view when a section further down opens.
test("TRAK-459: Settings' section menu stays in view when a section opens on a laptop", async ({ page, context }, testInfo) => {
  await open(page, context, 'coach', '/settings', 1440, 900)
  const menu = page.getByRole('navigation', { name: 'Settings sections' })
  await menu.getByRole('button', { name: 'Account' }).click()
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeInViewport()
  await expect(menu.getByRole('button', { name: 'Profile' })).toBeInViewport({ ratio: 1 })
  await expect(menu.getByRole('button', { name: 'Account' })).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: testInfo.outputPath('coach-settings-account-1440.png') })
  // A phone keeps its row of sections at the top, as before.
  await page.setViewportSize({ width: 390, height: 844 })
  await menu.getByRole('button', { name: 'Profile' }).click()
  await menu.getByRole('button', { name: 'Account' }).click()
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeInViewport()
  await expect(menu.getByRole('button', { name: 'Account' })).toBeInViewport({ ratio: 1 })
})

// TRAK-477: Settings' section menu looks like every other page's tabs (TRAK-431's glass pill): the section in view is the
// tinted pill with the green word, and on a phone the sections sit in one pill.
test("TRAK-477: Settings' section menu is the glass pill on a laptop and a phone", async ({ page, context }, testInfo) => {
  const { unexpected } = await open(page, context, 'coach', '/settings', 1440, 900)
  const menu = page.getByRole('navigation', { name: 'Settings sections' })
  await expect(menu.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'true')
  const look = () => menu.evaluate(nav => {
    const current = nav.querySelector('[aria-current]')!, mark = current.querySelector('span[aria-hidden="true"]')!, list = nav.querySelector('ul')!
    // The page header's tab look (#679), read through the same tokens.
    const probe = nav.appendChild(document.createElement('span'))
    probe.style.cssText = 'background: color-mix(in oklab, var(--accent) 14%, var(--surface)); color: var(--accent-strong); border-radius: var(--radius-pill)'
    const want = getComputedStyle(probe), got = getComputedStyle(mark), track = getComputedStyle(list)
    const result = { tint: got.backgroundColor === want.backgroundColor, word: getComputedStyle(current).color === want.color,
      pill: got.borderRadius === want.borderRadius, track: track.borderRadius === want.borderRadius && track.borderTopWidth === '1px' }
    probe.remove()
    return result
  })
  expect(await look()).toMatchObject({ tint: true, word: true, pill: true })
  await page.screenshot({ path: testInfo.outputPath('settings-menu-pill-1440.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(look).toEqual({ tint: true, word: true, pill: true, track: true })
  await page.screenshot({ path: testInfo.outputPath('settings-menu-pill-390.png') })
  expect(unexpected).toEqual([])
})

// TRAK-427: on a laptop New event is the centred pop-up every other pop-up is (TRAK-450), and it keeps one size,
// so nothing moves when the coach goes from step to step. A phone keeps the bottom sheet.
test('TRAK-427: New event on a laptop is a centred pop-up that stays put between steps', async ({ page, context }, testInfo) => {
  const { unexpected } = await open(page, context, 'coach', '/coach/schedule', 1280, 800)
  await openNewEvent(page)
  const dialog = page.getByRole('dialog', { name: 'New event' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: testInfo.outputPath('new-event-laptop-step1.png') })
  const first = (await dialog.boundingBox())!
  // TRAK-635: a training needs its title before Next.
  await dialog.getByLabel('Title', { exact: true }).fill('Finishing')
  await dialog.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(dialog.getByRole('button', { name: /^Back to / })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('new-event-laptop-step2.png') })
  const second = (await dialog.boundingBox())!
  expect(Math.round(first.width)).toBe(672)
  expect(Math.round(first.x + first.width / 2)).toBe(640)
  expect(Math.round(first.y + first.height / 2)).toBe(400)
  expect(second).toEqual(first)
  expect(unexpected).toEqual([])
})

test('TRAK-427: New event on a phone keeps the bottom sheet', async ({ page, context }) => {
  const { unexpected } = await open(page, context, 'coach', '/coach/schedule', 390, 844)
  await openNewEvent(page)
  const sheet = (await page.getByRole('dialog', { name: 'New event' }).boundingBox())!
  expect(Math.round(sheet.width)).toBe(390)
  expect(Math.round(sheet.y + sheet.height)).toBe(844 - 64)
  expect(unexpected).toEqual([])
})

test("the Calendar's sheets stop at the Arc bottom sheet's width on a tablet", async ({ page, context }) => {
  const { unexpected } = await open(page, context, 'coach', '/coach/schedule', 820, 1180)
  await openNewEvent(page)
  const sheet = (await page.getByRole('dialog', { name: 'New event' }).boundingBox())!
  expect(Math.round(sheet.width)).toBe(576)
  expect(Math.round(sheet.x + sheet.width / 2)).toBe(410)
  expect(unexpected).toEqual([])
})

test("a player's Home keeps the phone column on a laptop", async ({ page, context }) => {
  const { unexpected } = await open(page, context, 'player', '/player/home', 1440, 900)
  // TRAK-440: the bar is the coach's glass tab bar, floating 12 px above the bottom, centred under the column.
  const bar = page.getByRole('navigation', { name: 'Player' })
  await expect(bar.getByRole('tab', { name: 'Matches' })).toBeVisible()
  const shell = await box(page, '.trak-page')
  expect([Math.round(shell.width), Math.round(shell.x + shell.width / 2)]).toEqual([430, 720])
  const nav = (await bar.boundingBox())!
  expect([Math.round(nav.x + nav.width / 2), Math.round(nav.y + nav.height)]).toEqual([720, 888])
  expect(nav.width).toBeLessThanOrEqual(406)
  expect(await page.evaluate(() => document.documentElement.dataset.layout)).toBeUndefined()
  expect(unexpected).toEqual([])
})

// TRAK-441: with the academy's family_look on, a player on a laptop gets the coach's side menu and page widths.
test("a player's laptop frame, with the academy's family_look on: the side menu, no glass bar", async ({ page, context }, testInfo) => {
  const { unexpected, errors } = await open(page, context, 'player', '/player/matches', 1440, 900, ['events', 'family_look'])
  const menu = page.getByRole('navigation', { name: 'Trak' })
  await expect(menu.getByRole('button', { name: /^Matches/ })).toHaveAttribute('aria-current', 'page')
  await expect(menu.getByRole('button', { name: /^Profile/ })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Player' })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.dataset.layout)).toBe('coach')
  await page.waitForTimeout(400)
  await page.screenshot({ path: testInfo.outputPath('family-frame-1440.png') })
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-441 slice 2: a parent picks the child in the side menu, where the coach picks the squad.
test("a parent's laptop frame: the child switcher in the side menu", async ({ page, context }, testInfo) => {
  const { unexpected, errors } = await open(page, context, 'parent', '/parent/home', 1440, 900, ['events', 'family_look'])
  await expect(page.getByRole('navigation', { name: 'Trak' }).getByRole('button', { name: /^Events/ })).toBeVisible()
  await page.getByRole('button', { name: /^Child: Kostas Manolas/ }).click()
  await page.getByRole('listbox', { name: 'Children' }).getByRole('option', { name: /Sokratis Papastathopoulos/ }).click()
  await expect(page.getByRole('button', { name: /^Child: Sokratis Papastathopoulos/ })).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: testInfo.outputPath('family-frame-parent-1440.png') })
  expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-441 slice 2 (Imad, 13 Nov): the player Home in the coach's look, behind family_look; the parent's too (2.6). A
// phone: the bell on the page; a laptop: the bell in the top bar and two columns. No sideways scroll either way.
for (const who of ['player', 'parent'] as const) for (const [label, width, height] of [['a phone', 390, 844], ['a laptop', 1440, 900]] as const) {
  test(`the ${who} Home in the coach's look on ${label}`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, who, `/${who}/home`, width, height, ['events', 'family_look'])
    const bell = page.getByRole('button', { name: /^Alerts/ })
    await expect(bell).toBeVisible()
    // 2.4c: the coach's week picker, not the letter strip.
    await expect(page.getByRole('heading', { name: 'This week', level: 2 })).toBeVisible()
    // 2.6b: today's match, Details beside a red Can't make it for a parent; a player under the consent age has none.
    await expect(page.getByRole('button', { name: 'Details' })).toBeVisible()
    await expect(page.getByRole('button', { name: "Can't make it" })).toHaveCount(who === 'parent' ? 1 : 0)
    // A phone: the bell in the page's own top row, the glass tab bar. A laptop: the side menu, the bell in its top bar.
    await expect(page.getByRole('navigation', { name: 'Trak' })).toHaveCount(width < 1024 ? 0 : 1)
    expect((await bell.boundingBox())!.y).toBeLessThan(60)
    await page.waitForTimeout(400)
    await page.screenshot({ path: testInfo.outputPath(`family-home-${who}-${width}.png`), fullPage: true })
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-250: Squad is a coach workspace of views. TRAK-263 (Imad, 22 Oct): Players (Arc's team
// directory) replaced Snapshot, and the views sit on Arc's glass segmented control. On a tablet
// or a laptop it uses the room: a page wider than the phone column. TRAK-351 (Tarek, 3 Nov): a player opens as their
// own full page, with no list beside it, and Back returns to the list. TRAK-428: a laptop keeps Back beside the top bar's
// trail (Imad, 19 Nov); a tablet, whose trail is on the page, goes back by the trail.
// [screen, width, height, rail]
for (const [label, width, height, rail] of [
  ['an upright tablet', 820, 1180, 0],
  ['a laptop', 1440, 900, 240],
] as const) {
  test(`coach Squad on ${label}: the three views across a wide page, a player's own full page, no sheet`, async ({ page, context }, testInfo) => {
    const { unexpected, errors } = await open(page, context, 'coach', '/coach/squad', width, height)
    const views = page.getByRole('radiogroup', { name: 'Squad view' }).getByRole('radio')
    await expect(views).toHaveText(['Players', 'Attributes', 'Availability']) // TRAK-283: Games left Squad
    const playersView = page.getByRole('region', { name: 'Players', exact: true })
    await expect(playersView.getByRole('list', { name: 'Players' }).getByRole('listitem').first()).toBeVisible()

    // The wide page, right of the side menu on a laptop: no 430 px column.
    const panel = (await playersView.boundingBox())!
    expect(Math.round(panel.width)).toBe(Math.min(1280, width - rail) - 64)
    expect(Math.round(panel.x)).toBeGreaterThanOrEqual(rail)

    // Picking a player opens their own page: their address, the page's whole width, and no list beside it.
    const list = playersView.getByRole('list', { name: 'Players' })
    const name = players[0].player_name
    await list.getByRole('button').first().click()
    await expect(page).toHaveURL(/\/coach\/squad\/player\/sq-1$/)
    // The profile is the article named after the player (their assessment cards are articles too).
    const profile = playersView.getByRole('article', { name: new RegExp(`^${name},`) })
    await expect(profile.getByRole('heading', { level: 3, name })).toBeVisible()
    await expect(list).toBeHidden()
    await expect(page.getByRole('radiogroup', { name: 'Squad view' })).toBeHidden()
    expect((await profile.boundingBox())!.width).toBeGreaterThan(panel.width * 0.95)
    await page.waitForTimeout(600) // let the radar draw in for the screenshot
    await page.screenshot({ path: testInfo.outputPath(`coach-squad-${width}.png`) })
    if (rail) await page.getByRole('button', { name: 'Back' }).click()
    else {
      await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0)
      await page.getByRole('navigation', { name: 'Breadcrumb trail' }).getByRole('link', { name: 'Squad' }).click()
    }
    await expect(list).toBeVisible()

    // Each view opens in place: no Arc sheet, and no read the backend does not answer.
    for (const name of ['Attributes', 'Availability', 'Players']) {
      await views.filter({ hasText: name }).click()
      await expect(views.filter({ hasText: name })).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByRole('region', { name, exact: true }).getByText(/^(Loading|Checking) /)).toHaveCount(0)
      // TRAK-335: a load still going is a skeleton now, heard as "Loading …".
      await expect(page.getByRole('region', { name, exact: true }).getByRole('status', { name: /^Loading/ })).toHaveCount(0)
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

test('Feedback on a laptop: a table with a filter by level and Assess on each row', async ({ page, context }) => {
  const { unexpected } = await open(page, context, 'coach', '/coach/feedback', 1440, 900)
  const table = page.getByRole('table')
  await expect(table.getByRole('columnheader')).toHaveText(['Player', 'Status', 'Why', 'Assess'])
  await expect(table.getByRole('row')).toHaveCount(1 + players.length)
  await expect(table.getByRole('button', { name: /^Assess / })).toHaveCount(players.length)
  await expect(page.getByRole('radio', { name: `All ${players.length}` }).or(page.getByRole('tab', { name: `All ${players.length}` })).or(page.getByRole('button', { name: `All ${players.length}` }))).toBeVisible()
  expect(unexpected).toEqual([])
})

test('Feedback on a phone keeps its list', async ({ page, context }) => {
  await open(page, context, 'coach', '/coach/feedback', 390, 844)
  await expect(page.getByText('Hugo Lloris')).toBeVisible()
  await expect(page.getByRole('table')).toHaveCount(0)
})

// TRAK-574 (Dimos, 25 Nov): one column on every screen. The month is a low strip across the top, and the chosen day
// sits under it, in view without scrolling.
for (const [label, width, height] of [['an upright tablet', 820, 1180], ['a laptop', 1440, 900], ['a short laptop', 1280, 720]] as const) {
  test(`the Calendar on ${label}: the chosen day under the month strip, in view`, async ({ page, context }) => {
    const { unexpected } = await open(page, context, 'coach', '/coach/schedule', width, height)
    const month = (await page.getByRole('grid').boundingBox())!
    const day = (await page.getByText('Nothing planned', { exact: true }).boundingBox())!
    expect(day.y).toBeGreaterThan(month.y + month.height)
    expect(day.y + day.height).toBeLessThan(height)
    expect(month.height).toBeLessThan(120)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    expect(unexpected).toEqual([])
  })
}

// TRAK-265 (Imad, 22 Oct): the "+" is Arc's Action morph; the phone's sidebar sheet works; one title in the breadcrumb.
test('the "+" grows into its menu with a close button, and Escape folds it back', async ({ page, context }, testInfo) => {
  for (const [width, height, name] of [[390, 844, 'Quick add'], [1440, 900, 'Create']] as const) {
    const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', width, height)
    await page.getByRole('button', { name, exact: true }).click()
    const menu = page.getByRole('menu', { name })
    // TRAK-499 (20 Nov): Log training and Log match left the "+"; it offers Assess player and New event.
    await expect(menu.getByRole('menuitem')).toHaveText(['Assess player', 'New event'])
    await expect(page.getByRole('button', { name: `Close ${name.toLowerCase()}` })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'New event' }).click()
    const form = page.getByRole('dialog', { name: 'New event' })
    await expect(form.getByRole('button', { name: 'Save draft' })).toBeVisible()
    await page.waitForTimeout(500)
    await page.screenshot({ path: testInfo.outputPath(`coach-create-${width}.png`) })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name })).toBeVisible()
    // Focus comes back to the first row two frames after the form folds; on a slow runner a key pressed sooner lands on the page.
    await expect(page.getByRole('menu', { name }).getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    await expect(page.getByRole('menu', { name })).toHaveCount(0)
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  }
})

test("a phone's sidebar sheet takes a tap: the row opens its page and the sheet closes", async ({ page, context }) => {
  const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', 390, 844)
  await page.getByRole('button', { name: 'Open menu' }).click()
  const sheet = page.getByRole('navigation', { name: 'Your academy' })
  await sheet.getByRole('button', { name: 'Squad', exact: true }).click()
  await expect(page).toHaveURL(/\/coach\/squad$/)
  await expect(page.getByRole('navigation', { name: 'Your academy' })).toHaveCount(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-377 (Imad, 5 Nov): the sidebar sometimes stayed on screen until a refresh. On a phone's network a page's code
// takes a moment; the sheet must still slide away while it loads, and stay away once it has.
test("a phone's sidebar sheet closes while a page's code is still on its way", async ({ page, context }) => {
  const { unexpected, errors } = await open(page, context, 'coach', '/coach/home', 390, 844)
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
  // A held request can finish another way while it waits (the context's catch-all, or the page moving on): CI saw "Route is
  // already handled!" from this continue on 11 and 12 Nov, which failed the test though the menu behaved. Only the delay matters.
  await page.route(/\/assets\/.+\.js$/, async route => { await new Promise(done => setTimeout(done, 1500)); await route.continue().catch(() => {}) })
  await page.getByRole('button', { name: 'Open menu' }).click()
  const sheet = page.getByRole('navigation', { name: 'Your academy' })
  await sheet.getByRole('button', { name: 'Squad', exact: true }).click()
  await expect(page).toHaveURL(/\/coach\/squad$/)
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0, { timeout: 5000 })
  // The page's code arrives: the sheet must not slide back in, nor leave the page under it blocked.
  // Not 'wait': that waits for every held handler, and one whose request the page already dropped never finishes, so CI
  // timed out here at 45 s on 11 to 13 Nov (2 in 48 locally). A held request still gets its continue when its 1.5 s is up.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.waitForTimeout(1800)
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.pointerEvents)).toBe('')
  // The page takes taps (Home from the tab bar), and the menu still opens and closes there.
  await page.getByRole('tab', { name: 'Home' }).or(page.getByRole('button', { name: 'Home', exact: true })).first().click()
  await expect(page).toHaveURL(/\/coach\/home$/)
  await page.getByRole('button', { name: 'Open menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible()
  await page.getByRole('button', { name: 'Close menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

test("a laptop's breadcrumb names the page, one title after several moves", async ({ page, context }) => {
  const { errors } = await open(page, context, 'coach', '/coach/home', 1440, 900)
  const side = page.getByRole('navigation', { name: 'Your academy' })
  for (const name of ['Squad', 'Events', 'Library', 'Home']) {
    await side.getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(300)
  }
  // TRAK-347 (Imad, 3 Nov): the club is in the sidebar, not in the top bar's trail.
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveText(/^Home$/)
  expect(errors).toEqual([])
})

/** Where a page draws (its text, cards, buttons and boxes), right of a laptop's sidebar and under its top bar. Each box
 *  is cut to what its scrolling parents show; the page's own plain background doesn't count. */
const drawnEdges = (page: Page) => page.evaluate(() => {
  const sidebar = document.querySelector('[id$="-sidebar"]')
  const rail = sidebar ? sidebar.getBoundingClientRect().right : 0
  const top = sidebar ? 60 : 0
  let left = Infinity, right = -Infinity
  const add = (el: Element, r: DOMRect) => {
    if (r.width < 2 || r.height < 2 || r.top < top || r.top > window.innerHeight) return
    let l = Math.max(r.left, rail), rt = Math.min(r.right, window.innerWidth)
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') { const b = a.getBoundingClientRect(); l = Math.max(l, b.left); rt = Math.min(rt, b.right) }
    }
    if (rt - l >= 2) { left = Math.min(left, l); right = Math.max(right, rt) }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: node => {
    if (node.nodeType !== 1) return NodeFilter.FILTER_ACCEPT
    const el = node as HTMLElement, style = getComputedStyle(el)
    return el.id.endsWith('-sidebar') || style.position === 'fixed' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0'
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  } })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      add(node.parentElement!, range.getBoundingClientRect())
      continue
    }
    const el = node as HTMLElement, style = getComputedStyle(el), r = el.getBoundingClientRect()
    const control = ['svg', 'img', 'button', 'input', 'textarea', 'select', 'canvas'].includes(el.tagName.toLowerCase())
    const bordered = parseFloat(style.borderTopWidth) > 0 && style.borderTopColor !== 'rgba(0, 0, 0, 0)'
    const filled = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && r.width < (window.innerWidth - rail) * 0.95 && !el.classList.contains('bg-ground')
    if (control || bordered || filled) add(el, r)
  }
  return { left, right }
})

// TRAK-307 (Kostas, 29 Oct): ONE width for every page in a coach's menu, Squad's and Games'. On a tablet or a laptop the
// page fills the screen beside the menu, 32 px from each side, up to 1,280 px; a phone keeps the phone column (20 px).
// Each page's column is the same, its content starts at the margin, and nothing sits in the margins.
const MENU_PAGES = [
  ['Home', '/coach/home', ['events', 'games', 'training']], ['Schedule', '/coach/schedule', ['events', 'games', 'training']],
  ['Squad', '/coach/squad', ['events', 'games', 'training']], ['Matches', '/coach/matches', ['events', 'games', 'training']],
  ['Training', '/coach/training', ['events', 'games', 'training']], ['Drills', '/coach/training/drills', ['events', 'games', 'training']],
  ['Settings', '/settings', ['events', 'games', 'training']], ['Library', '/coach/trainings', ['events']], // Library: Training off
] as const
for (const [label, width, height] of [['a phone', 390, 844], ['an upright tablet', 820, 1180], ['a laptop', 1440, 900], ['a big screen', 1920, 1080], ['a 2,560 px monitor', 2560, 1440]] as const) {
  test(`TRAK-307: every page in the coach's menu takes the same width on ${label}`, async ({ browser }, testInfo) => {
    const rail = width >= 1024 ? 240 : 0
    const margin = width >= 768 ? 32 : 20
    // TRAK-463 (11 Nov walk-through): beside a laptop's sidebar the column fills the screen; a tablet keeps 1,280 px.
    const column = rail ? width - rail : Math.min(1280, width)
    const start = rail + (width - rail - column) / 2
    const found: Record<string, string> = {}, wanted: Record<string, string> = {}
    for (const [name, path, features] of MENU_PAGES) {
      // A fresh coach for each page: the app keeps a switch's answer for 30 s.
      const context = await browser.newContext()
      const page = await context.newPage()
      const { unexpected, errors } = await open(page, context, 'coach', path, width, height, [...features])
      await expect(page.getByRole('heading').first()).toBeVisible()
      await page.waitForLoadState('networkidle')
      await expect(page.getByText(/^(Loading|Checking) /)).toHaveCount(0)
      await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
      await page.waitForTimeout(400) // let the page settle
      // The menu pages' column (WIDE_COLUMN), if the page has it.
      const columns = page.locator('.trak-wide')
      const box = await columns.count() ? await columns.first().boundingBox() : null
      const { left, right } = await drawnEdges(page)
      // Within 6 px: a scrolling row may reach a few pixels into the margin to keep its focus rings.
      found[name] = [!box ? 'no menu-page column' : Math.abs(box.x - start) <= 1 && Math.abs(box.width - column) <= 1 ? 'same column' : `column ${Math.round(box.x)}+${Math.round(box.width)}`,
        Math.abs(left - (start + margin)) <= 6 ? 'starts at the margin' : `starts at ${Math.round(left)}`,
        right <= start + column - margin + 6 ? 'ends inside' : `ends at ${Math.round(right)}`].join(', ')
      wanted[name] = 'same column, starts at the margin, ends inside'
      if (width === 1440) await page.screenshot({ path: testInfo.outputPath(`menu-page-${name.toLowerCase()}-${width}.png`) })
      expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
      expect(unexpected).toEqual([])
      expect(errors).toEqual([])
      await context.close()
    }
    expect(found).toEqual(wanted)
  })
}

// TRAK-417: on a laptop every page's full-height wrapper (min-h-screen) sat under the frame's 60 px top bar, so even a
// near-empty page scrolled 60 px, and Assess (a fixed full height) put Back and Next 60 px below the window. Their
// lowest edge must be the window's; a phone keeps the whole window.
for (const [width, height, label] of [[1440, 900, 'a laptop'], [390, 844, 'a phone']] as const) {
  test(`TRAK-417: a short page does not scroll on ${label}`, async ({ page, context }) => {
    const { unexpected, errors } = await open(page, context, 'coach', '/coach/schedule', width, height)
    for (const path of ['/coach/schedule', '/coach/squad', '/settings', '/coach/assess']) {
      if (path !== '/coach/schedule') await page.goto(path)
      const wrapper = page.locator('.min-h-screen, .h-dvh').first()
      await expect(wrapper).toBeVisible()
      // Polled: a page's styles can land a moment after it shows.
      const reach = () => wrapper.evaluate((el, laptop) => { const style = getComputedStyle(el), min = parseFloat(el.classList.contains('h-dvh') ? style.height : style.minHeight); return laptop ? el.getBoundingClientRect().top + scrollY + min : min }, width > 1024)
      await expect.poll(reach, { message: path }).toBe(height)
    }
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}

// TRAK-463: on a wide monitor the page fills the screen, so Squad's rows flow into columns instead of 2,000 px rows.
test('TRAK-463: Squad lists its players in columns on a 2,560 px monitor, one column on a laptop', async ({ page, context }) => {
  const { unexpected, errors } = await open(page, context, 'coach', '/coach/squad', 2560, 1440)
  const list = page.getByRole('list', { name: 'Players' })
  await expect(list.getByRole('listitem').first()).toBeVisible()
  const columns = () => list.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  await expect.poll(columns).toBeGreaterThan(1)
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(columns).toBe(1)
  expect(unexpected).toEqual([])
  expect(errors).toEqual([])
})

// TRAK-422 (Kostas, 13 Nov): ONE page title on every coach page, Squad's and Matches' style (22 px on a phone, 26 px on a
// laptop, medium), and the same gap above it on every page of the same kind: 20 px from the top of a phone (60 px on a
// sub-page, under its trail), 20 px under a laptop's top bar. Before, there were six sizes and gaps from 72 to 97 px.
const TITLED_PAGES = [
  ['Home', '/coach/home', 'menu'], ['Schedule', '/coach/schedule', 'menu'], ['Squad', '/coach/squad', 'menu'],
  ['Matches', '/coach/matches', 'menu'], ['Training', '/coach/training', 'menu'], ['Drills', '/coach/training/drills', 'menu'],
  ['Feedback', '/coach/feedback', 'menu'], ['Settings', '/settings', 'menu'],
  ['Season plan', '/coach/season-plan', 'sub'], ['Evaluation', '/coach/evaluation', 'sub'], ['Past trainings', '/coach/training/past', 'sub'], ['Past matches', '/coach/matches/past', 'sub'],
  ['My drills', '/coach/training/drills/mine', 'sub'], ['All drills', '/coach/training/drills/all', 'sub'], ['How Trak works', '/coach/how-trak-works', 'sub'],
] as const
for (const [label, width, height, size, menuTop, subTop] of [['a phone', 390, 844, 22, 20, 60], ['a laptop', 1440, 900, 26, 80, 80]] as const) {
  test(`TRAK-422: every coach page has the one title, at the same height, on ${label}`, async ({ browser }) => {
    const found: Record<string, string> = {}, wanted: Record<string, string> = {}
    for (const [name, path, kind] of TITLED_PAGES) {
      // A fresh coach for each page: the app keeps a switch's answer for 30 s.
      const context = await browser.newContext()
      const page = await context.newPage()
      const { unexpected, errors } = await open(page, context, 'coach', path, width, height, ['events', 'games', 'training', 'season_plan'])
      const title = page.locator('h1:visible').first()
      await expect(title).toBeVisible()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(300) // let the page settle
      const { px, weight, top } = await title.evaluate(el => {
        const style = getComputedStyle(el)
        return { px: parseFloat(style.fontSize), weight: style.fontWeight, top: Math.round(el.getBoundingClientRect().top) }
      })
      found[name] = `${px} px, weight ${weight}, ${top} px from the top`
      wanted[name] = `${size} px, weight 500, ${kind === 'menu' ? menuTop : subTop} px from the top`
      expect(unexpected).toEqual([])
      expect(errors).toEqual([])
      await context.close()
    }
    expect(found).toEqual(wanted)
  })
}
