import { test, expect, type BrowserContext, type Page } from '@playwright/test'

// TRAK-601 (coach–player P13): a player reads their training's plan in a real browser, in the family look, at 390 and
// 1280. Home's week says Plan ready; the event page shows what it works on, the drills with their set-up and a Trak
// drill's picture, and one Got it that answers at once. Coaching points never show; nothing scrolls sideways.
// Production build, synthetic intercepted backend.
const playerId = '97601000-0000-4000-8000-000000000002'
const today = new Date().toLocaleDateString('en-CA')
const TRAINING = { id: '97601000-0000-4000-8000-000000000900', event_type: 'training', title: 'Finishing', event_date: today,
  start_time: '23:30:00', status: 'scheduled', venue: 'Synthetic Park', kit: 'Training kit' }
// What my_training_plans sends, plus a coaching point it never sends: it must not show.
const PLAN = [
  { position: 1, part: 'Warm-up', name: 'Tag games', minutes: 10, how: 'Two taggers chase the rest.\nSwap taggers every minute.',
    area: '', numbers: '', trak_drill: 'lib-tag-games', trak_level: 3, tell: 'SECRET coaching point' },
  { position: 2, part: 'Passing', name: 'Triangle passing', minutes: 15, how: 'Groups of three, cones 10 m apart.\nPass and follow your pass.',
    area: '20 x 20 m', numbers: '3 per group', trak_drill: null, trak_level: null },
  { position: 3, part: 'Game', name: 'Small-sided game', minutes: 20, how: 'Two teams, two small goals each.',
    area: '30 x 20 m', numbers: '5 v 5', trak_drill: null, trak_level: null },
].map(p => ({ event_id: TRAINING.id, event_date: today, session_id: null, direction: '', targets: '', conditions: '', ...p }))

async function backend(context: BrowserContext, unexpected: string[], answers: string[]) {
  const user = { id: playerId, email: 'player@plans601.test', email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: playerId, exp, role: 'authenticated' }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  await context.addInitScript(session => localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token', JSON.stringify(session)),
    { access_token: token, refresh_token: 'synthetic-plans601', expires_in: 3600, expires_at: exp, token_type: 'bearer', user })
  let answered = false
  await context.route('**/*', async route => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
    if (url.hostname !== 'xbykbqolvqyqmipikuae.supabase.co') { unexpected.push(req.url()); return route.abort() }
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    const rows = (all: Record<string, unknown>[]) => json(req.headers()['accept']?.includes('vnd.pgrst.object') ? all[0] ?? null : all)
    const path = url.pathname
    if (path === '/rest/v1/telemetry_events' && req.method() === 'POST') return route.fulfill({ status: 201, body: '' })
    if (path === '/auth/v1/user') return json(user)
    if (path === '/rest/v1/profiles') return rows([{ id: playerId, user_id: playerId, role: 'player', full_name: 'Theodoros Zagorakis' }])
    if (path === '/rest/v1/player_details') return rows([{ user_id: playerId, position: 'Midfielder', age_group: 'U16', current_club: 'Synthetic FC' }])
    if (path === '/rest/v1/rpc/my_session_is_live') return json(true)
    if (path === '/rest/v1/rpc/my_consent_status') return json({ required: false, invited_parent: null })
    if (path === '/rest/v1/rpc/family_feature_on') return json(true)
    if (path === '/rest/v1/rpc/child_events') return rows([TRAINING])
    if (path === '/rest/v1/rpc/my_training_plans') {
      const eq = (key: string) => url.searchParams.get(key)?.replace(/^eq\./, '')
      return json(PLAN.filter(p => (!eq('event_id') || p.event_id === eq('event_id')) && (!eq('position') || String(p.position) === eq('position'))))
    }
    if (path === '/rest/v1/rpc/my_tasks') return json([{ task_id: 'plan', title: 'Training plan: Finishing', source_type: 'training_plan',
      source_id: TRAINING.id, answer_kind: 'got_it', due_at: null, time_zone: 'Asia/Dubai', answered, outdated: false }])
    if (path === '/rest/v1/rpc/respond_to_task' || path === '/rest/v1/rpc/undo_task_response') {
      answers.push(`${path.endsWith('undo_task_response') ? 'undo' : 'answer'} ${(req.postDataJSON() as { p_task_id: string }).p_task_id}`)
      answered = !path.endsWith('undo_task_response')
      return json(null)
    }
    // Every other read is empty: this is about the plan, not the rest of the player's pages.
    if (path.startsWith('/rest/v1/') && (req.method() === 'GET' || path.startsWith('/rest/v1/rpc/'))) return rows([])
    unexpected.push(`${req.method()} ${path}`)
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Unmocked request blocked"}' })
  })
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const [width, height] of [[390, 844], [1280, 800]] as const) {
  test(`The training plan at ${width} px: Plan ready on Home, the plan on its page, Got it answers, nothing scrolls sideways`, async ({ context, page }, testInfo) => {
    const unexpected: string[] = [], errors: string[] = [], answers: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await backend(context, unexpected, answers)
    await page.setViewportSize({ width, height })

    await page.goto('/player/home')
    await expect(page.getByRole('button', { name: /^Finishing, .*Plan ready$/ })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`home-plan-ready-${width}.png`) })

    await page.goto(`/player/event/${TRAINING.id}`)
    const plan = page.getByRole('region', { name: 'Training plan' })
    await expect(plan.getByText('Warm-up · Passing · Game')).toBeVisible()
    await expect(plan.getByRole('heading', { level: 3 })).toHaveText(['What we’re working on', 'Tag games', 'Triangle passing', 'Small-sided game'])
    await expect(plan.locator('svg')).toHaveCount(1)
    await expect(page.getByText(/SECRET/)).toHaveCount(0)
    expect(await noSidewaysScroll(page)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: testInfo.outputPath(`plan-${width}.png`), fullPage: true })

    await plan.getByRole('button', { name: 'Got it' }).click()
    await expect(plan.getByRole('button', { name: 'Undo Got it' })).toBeVisible()
    await expect.poll(() => answers).toEqual(['answer plan'])
    await plan.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`plan-got-it-${width}.png`) })
    expect(unexpected).toEqual([])
    expect(errors).toEqual([])
  })
}
