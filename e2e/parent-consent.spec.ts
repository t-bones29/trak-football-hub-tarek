import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { CONSENT_NOTICE_VERSION, CONSENT_STATEMENT } from '../src/lib/consent'

// Production bundle, real router/AuthProvider/Supabase SDK, mobile viewport.
// Only local assets may reach the network. Every backend request is synthetic;
// this proves UI recovery, not the deferred backend consent-policy contract.
const appOrigin = 'http://127.0.0.1:4189'
const backendOrigin = 'https://xbykbqolvqyqmipikuae.supabase.co'
const storageKey = 'sb-xbykbqolvqyqmipikuae-auth-token'
const parentId = '99000000-0000-4000-8000-000000000101'
const childA = { player_user_id: '99000000-0000-4000-8000-000000000001', full_name: 'Alex Synthetic', age_years: 12 }
const childB = { player_user_id: '99000000-0000-4000-8000-000000000002', full_name: 'Blair Synthetic', age_years: 13 }
const consentId = '99000000-0000-4000-8000-000000000003'
interface Reply { data: unknown; status?: number }
interface ObservedRequest { method: string; path: string; authorization: string | undefined; body: unknown }

function expectedGrant(childId: string) {
  return {
    p_player_user_id: childId,
    p_relationship: 'parent',
    p_purposes: { coaching_records: true, recognition: false, parent_visibility: false },
    p_notice_version: CONSENT_NOTICE_VERSION,
    p_consent_text: CONSENT_STATEMENT,
  }
}

async function consentFixture(page: Page, context: BrowserContext, replies: Reply[], holdFirstGrant = false) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const user = {
    id: parentId, email: 'parent@consent.test.invalid', email_confirmed_at: '2026-09-18T08:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated',
    created_at: '2026-09-18T08:00:00Z',
  }
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: parentId, exp: expiresAt, role: 'authenticated', email: user.email }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic'
  const session = { access_token: token, refresh_token: 'synthetic-consent-refresh', expires_in: 3600,
    expires_at: expiresAt, token_type: 'bearer', user }
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: session })

  const unexpected: string[] = [], errors: string[] = []
  const requests: ObservedRequest[] = [], pending: ObservedRequest[] = [], grants: ObservedRequest[] = []
  let releaseGrant!: () => void
  const heldGrant = new Promise<void>(resolve => { releaseGrant = resolve })
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === appOrigin) return route.continue()
    if (url.origin !== backendOrigin) {
      unexpected.push(`${request.method()} ${request.url()}`)
      return route.abort()
    }
    const observed: ObservedRequest = {
      method: request.method(), path: url.pathname, authorization: request.headers().authorization,
      body: request.postData() ? request.postDataJSON() as unknown : null,
    }
    requests.push(observed)
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
    if (observed.authorization !== `Bearer ${token}`) {
      unexpected.push(`Unexpected account: ${observed.method} ${url.pathname}`)
      return json({ message: 'Unknown synthetic account' }, 401)
    }
    if (url.pathname === '/auth/v1/user' && observed.method === 'GET') return json(user)
    if (url.pathname === '/rest/v1/telemetry_events' && observed.method === 'POST') return json(null, 201)
    if (url.pathname === '/rest/v1/profiles' && observed.method === 'GET'
      && url.searchParams.get('user_id') === `eq.${parentId}` && ['*', 'role'].includes(url.searchParams.get('select') ?? '')) {
      const profile = url.searchParams.get('select') === 'role' ? { role: 'parent' }
        : { id: parentId, user_id: parentId, full_name: 'Synthetic Parent', role: 'parent', nationality: null }
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile])
    }
    // Independent family navigation is deliberately empty; no development
    // data requests are needed to establish consent-route recovery.
    if (url.pathname === '/rest/v1/player_parent_links' && observed.method === 'GET'
      && url.searchParams.get('parent_user_id') === `eq.${parentId}` && url.searchParams.get('select') === 'player_user_id') return json([])
    if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent' && observed.method === 'POST') {
      pending.push(observed)
      expect(observed.body).toEqual({})
      const reply = replies[Math.min(pending.length - 1, replies.length - 1)]
      return json(reply.data, reply.status ?? 200)
    }
    if (url.pathname === '/rest/v1/rpc/record_parental_consent' && observed.method === 'POST') {
      grants.push(observed)
      if (holdFirstGrant && grants.length === 1) await heldGrant
      return json(consentId)
    }
    unexpected.push(`${observed.method} ${url.pathname}${url.search}`)
    return json({ message: 'Unmodelled request blocked' }, 500)
  })
  return { unexpected, errors, requests, pending, grants, releaseGrant }
}

test('malformed consent responses show a recoverable error rather than empty approval state', async ({ page, context }, testInfo) => {
  const fixture = await consentFixture(page, context, [{ data: null }, { data: [null] }, { data: [] }])
  try {
    await page.goto('/parent/consent')
    await expect(page.getByRole('alert')).toContainText("Couldn't load pending approvals")
    await expect(page.getByText('Nothing to approve', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0)
    expect(fixture.pending).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath('consent-malformed-mobile.png'), fullPage: true })

    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(() => fixture.pending.length).toBe(2)
    await expect(page.getByRole('alert')).toContainText("Couldn't load pending approvals")
    await expect(page.getByText('Nothing to approve', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByText('Nothing to approve', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(`${appOrigin}/parent/consent`)
    expect(fixture.pending).toHaveLength(3)
    expect(fixture.grants).toHaveLength(0)
    expect(fixture.errors).toEqual([])
    expect(fixture.unexpected).toEqual([])
  } finally {
    fixture.releaseGrant()
  }
})

test('saved approval survives a failed refresh, then retries to a fresh child before finishing Home', async ({ page, context }, testInfo) => {
  const fixture = await consentFixture(page, context, [
    { data: [childA] },
    { data: { code: 'PGRST000', message: 'Synthetic pending-approval read unavailable' }, status: 503 },
    { data: [childB] },
    { data: [] },
  ], true)
  try {
    await page.goto('/parent/consent')
    await expect(page.getByRole('heading', { name: "Approve Alex Synthetic's account" })).toBeVisible()
    await page.getByRole('button', { name: 'Legal guardian', exact: true }).click()
    await page.getByRole('checkbox', { name: /recognition awards/i }).check()
    await page.getByRole('checkbox', { name: /I can see their progress/i }).check()
    await page.getByRole('checkbox', { name: CONSENT_STATEMENT }).check()
    await page.getByRole('button', { name: "Approve Alex Synthetic's account" }).click()
    await expect.poll(() => fixture.grants.length).toBe(1)
    const saving = page.getByRole('button', { name: 'Saving…', exact: true })
    await expect(saving).toBeDisabled()
    for (const checkbox of await page.getByRole('checkbox').all()) await expect(checkbox).toBeDisabled()
    const bounds = await saving.boundingBox()
    expect(bounds).not.toBeNull()
    if (!bounds) throw new Error('Saving button must be visible for duplicate-click control')
    await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    expect(fixture.grants).toHaveLength(1)
    expect(fixture.pending).toHaveLength(1)
    fixture.releaseGrant()

    await expect(page.getByRole('alert')).toContainText("Couldn't load pending approvals")
    await expect(page.getByRole('status')).toHaveText('Approval saved for Alex Synthetic.')
    await expect(page).toHaveURL(`${appOrigin}/parent/consent`)
    await expect(page.getByText('Nothing to approve', { exact: true })).toHaveCount(0)
    expect(fixture.pending).toHaveLength(2)
    expect(fixture.grants).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath('consent-saved-refresh-error-mobile.png'), fullPage: true })

    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.getByRole('heading', { name: "Approve Blair Synthetic's account" })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /recognition awards/i })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: /I can see their progress/i })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: CONSENT_STATEMENT })).not.toBeChecked()
    await expect(page.getByRole('button', { name: "Approve Blair Synthetic's account" })).toBeDisabled()
    expect(fixture.pending).toHaveLength(3)
    expect(fixture.grants).toHaveLength(1)
    await page.screenshot({ path: testInfo.outputPath('consent-next-child-mobile.png'), fullPage: true })

    await page.getByRole('checkbox', { name: CONSENT_STATEMENT }).check()
    await page.getByRole('button', { name: "Approve Blair Synthetic's account" }).click()
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible()
    await expect(page).toHaveURL(`${appOrigin}/parent/home`)
    // The fifth list request is Home's own pending-approval read.
    await expect.poll(() => fixture.pending.length).toBe(5)
    expect(fixture.grants.map(request => request.body)).toEqual([
      { ...expectedGrant(childA.player_user_id), p_relationship: 'legal_guardian',
        p_purposes: { coaching_records: true, recognition: true, parent_visibility: true } },
      expectedGrant(childB.player_user_id),
    ])
    expect(fixture.pending.map(request => request.body)).toEqual([{}, {}, {}, {}, {}])
    expect(fixture.errors).toEqual([])
    expect(fixture.unexpected).toEqual([])
  } finally {
    fixture.releaseGrant()
  }
})
