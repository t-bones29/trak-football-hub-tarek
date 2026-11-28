import { test, expect, devices, type Page } from '@playwright/test'
import { openNewEvent } from './new-event'

// TRAK-178: iPhone Safari zooms the whole page in when a text box under 16px
// gets focus, and it stays zoomed. On a touch screen every text box shows at
// least 16px; bigger ones (the match score) keep their size, and a desktop
// keeps the design's smaller boxes. Synthetic coach; every Supabase call is
// answered here.

// The iPhone's screen and touch, in the suite's browser.
const { viewport, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 15']
const phone = { viewport, deviceScaleFactor, isMobile, hasTouch }
const coach = '97000000-0000-4000-8000-0000000001c8'

/** Every visible text box's computed font size, by its label. */
async function boxSizes(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('input, textarea, select')]
    .filter(el => (el as HTMLElement).offsetParent !== null
      && !['checkbox', 'radio', 'hidden', 'range', 'file'].includes((el as HTMLInputElement).type))
    .map(el => ({
      box: el.getAttribute('aria-label') || (el as HTMLInputElement).labels?.[0]?.textContent?.trim()
        || el.getAttribute('placeholder') || el.tagName,
      px: parseFloat(getComputedStyle(el).fontSize),
    })))
}

async function signedInCoach(page: Page) {
  const user = { id: coach, email: 'coach@example.test', email_confirmed_at: '2026-09-01T00:00:00Z', app_metadata: {}, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-09-01T00:00:00Z' }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: coach, exp, role: 'authenticated' }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await page.context().addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)), {
    access_token: token, refresh_token: 'synthetic', expires_in: 3600, expires_at: exp, token_type: 'bearer', user,
  })
  const unexpected: string[] = []
  await page.context().route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:4189') return route.continue()
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') return route.abort()
    const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(single && Array.isArray(data) ? (data[0] ?? null) : data) })
    if (url.pathname === '/auth/v1/user') return json(user)
    if (url.pathname === '/rest/v1/telemetry_events') return route.fulfill({ status: 201, body: '' })
    if (url.pathname === '/rest/v1/profiles') return json([{ id: coach, user_id: coach, role: 'coach', full_name: 'Synthetic Coach', avatar_url: null }])
    if (url.pathname === '/rest/v1/coach_details') return json([{ user_id: coach, organization_id: null, team: 'U14' }])
    // TRAK-288: Games off, so the session screen still offers the match log this measures.
    if (url.pathname === '/rest/v1/rpc/feature_on') return json(request.postDataJSON()?.p_feature !== 'games')
    // TRAK-350: the season plan's switch is on here, so Home asks for the squad's plan; there is none.
    if (url.pathname === '/rest/v1/season_plans') return json([])
    if (url.pathname === '/rest/v1/rpc/my_session_is_live') return json(true)
    // Read-only screens: the rest of the reads (GET) are empty lists.
    if (request.method() === 'GET') return json([])
    unexpected.push(`${request.method()} ${url.pathname}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
  return unexpected
}

test.describe('TRAK-178 on a phone', () => {
  test.use(phone)

  test('no text box is small enough for iPhone to zoom in on it', async ({ page }) => {
    await page.goto('/')
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'a touch screen').toBe(true)
    await expect(page.getByLabel('Password')).toBeVisible()
    for (const { box, px } of await boxSizes(page)) expect(px, `sign-in: ${box}`).toBeGreaterThanOrEqual(16)

    const unexpected = await signedInCoach(page)
    await page.goto('/coach/schedule')
    await openNewEvent(page)
    const sheet = page.getByRole('dialog', { name: 'New event' })
    await expect(sheet).toBeVisible()
    // TRAK-182: one step per screen, so each step's boxes are measured on it.
    const eventForm = await boxSizes(page)
    // TRAK-635: a training needs its title before Next.
    await sheet.getByLabel('Title', { exact: true }).fill('Finishing')
    await sheet.getByRole('button', { name: 'Next' }).click()
    await sheet.getByRole('button', { name: /^Start\b/ }).click()
    await page.getByRole('listbox').getByRole('option', { name: '17:00' }).click()
    await sheet.getByRole('button', { name: 'Next' }).click()
    await expect(sheet.getByLabel('Kit (Optional)', { exact: true })).toBeVisible()
    eventForm.push(...await boxSizes(page))
    expect(eventForm.map(b => b.box)).toEqual(expect.arrayContaining(['Venue (Optional)', 'Kit (Optional)', 'Message to players (Optional)']))
    for (const { box, px } of eventForm) expect(px, `event form: ${box}`).toBeGreaterThanOrEqual(16)

    // The match log's big boxes keep their size; its small ones grow.
    await page.goto('/coach/sessions/add')
    await page.getByRole('button', { name: 'Match', exact: true }).click()
    const matchLog = await boxSizes(page)
    for (const { box, px } of matchLog) expect(px, `match log: ${box}`).toBeGreaterThanOrEqual(16)
    expect(Math.max(...matchLog.map(b => b.px)), 'the score keeps its 28px').toBe(28)
    expect(unexpected).toEqual([])
  })
})

test('a desktop keeps the design\'s smaller boxes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByLabel('Password')).toBeVisible()
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(false)
  const sizes = await boxSizes(page)
  expect(sizes.length).toBeGreaterThan(0)
  for (const { box, px } of sizes) expect(px, `desktop sign-in: ${box}`).toBeLessThan(16)
})
