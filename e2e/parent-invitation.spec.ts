import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const appOrigin = 'http://127.0.0.1:4189';
const backendOrigin = 'https://xbykbqolvqyqmipikuae.supabase.co';
const storageKey = 'sb-xbykbqolvqyqmipikuae-auth-token';
const playerId = '11111111-1111-4111-8111-111111111111';
const parentId = '22222222-2222-4222-8222-222222222222';
const alexId = '33333333-3333-4333-8333-333333333333';
const zaraId = '44444444-4444-4444-8444-444444444444';
const alexInvite = '55555555-5555-4555-8555-555555555555';
const zaraInvite = '66666666-6666-4666-8666-666666666666';
const inviteToken = '77777777-7777-4777-8777-777777777777';
const unavailableToken = '88888888-8888-4888-8888-888888888888';
const parentEmail = 'parent@example.test';

function session(id: string, email: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id, email, email_confirmed_at: '2026-09-01T00:00:00Z',
    app_metadata: { provider: 'email' }, user_metadata: {}, aud: 'authenticated', role: 'authenticated',
    created_at: '2026-09-01T00:00:00Z',
  };
  const token = [{ alg: 'HS256', typ: 'JWT' }, { sub: id, exp: expiresAt, role: 'authenticated', email }]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.synthetic';
  return { access_token: token, refresh_token: `synthetic-refresh-${id}`, expires_in: 3600, expires_at: expiresAt, token_type: 'bearer', user };
}

interface ObservedRequest {
  path: string;
  method: string;
  authorization: string | undefined;
  body: unknown;
}

async function invitationsFixture(page: Page, context: BrowserContext, initialAccount: 'player' | 'parent' | null = null, available = true) {
  const player = session(playerId, 'player@example.test');
  const parent = session(parentId, parentEmail);
  if (initialAccount) {
    await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: storageKey, value: initialAccount === 'player' ? player : parent,
    });
  }
  const invites = [
    { invite_id: alexInvite, player_user_id: alexId, player_name: 'Alex Example', parent_email: parentEmail },
    { invite_id: zaraInvite, player_user_id: zaraId, player_name: 'Zara Example', parent_email: parentEmail },
  ].map(invite => ({ ...invite, expires_at: new Date(Date.now() + 86_400_000).toISOString() }));
  const requests: ObservedRequest[] = [];
  const claims: ObservedRequest[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appOrigin) return route.continue();
    if (url.origin !== backendOrigin) {
      // Fonts are optional assets; every other unexpected external call fails.
      if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) unexpected.push(request.url());
      return route.abort();
    }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const observed = {
      path: url.pathname, method: request.method(), authorization: request.headers().authorization,
      body: request.postData() ? request.postDataJSON() as unknown : null,
    };
    requests.push(observed);
    const account = observed.authorization === `Bearer ${parent.access_token}` ? parent
      : observed.authorization === `Bearer ${player.access_token}` ? player : null;

    if (url.pathname === '/auth/v1/user' && request.method() === 'GET' && account) return json(account.user);
    if (url.pathname === '/auth/v1/logout' && request.method() === 'POST' && account) return route.fulfill({ status: 204 });
    if (url.pathname === '/auth/v1/token' && request.method() === 'POST'
      && url.searchParams.get('grant_type') === 'password') {
      const credentials = observed.body as { email?: string; password?: string };
      if (credentials.email === parentEmail && credentials.password === 'ExistingParent1!') return json(parent);
      return json({ message: 'Invalid synthetic credentials' }, 400);
    }
    if (url.pathname === '/rest/v1/telemetry_events' && request.method() === 'POST') return json(null, 201);
    if (url.pathname === '/rest/v1/profiles' && request.method() === 'GET' && account
      && url.searchParams.get('user_id') === `eq.${account.user.id}`) {
      const profile = {
        id: account.user.id, user_id: account.user.id, role: account === parent ? 'parent' : 'player',
        full_name: account === parent ? 'Existing Parent' : 'Existing Player', nationality: null,
      };
      return json(request.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile]);
    }
    if (account === parent) {
      if (url.pathname === '/rest/v1/player_parent_links' && request.method() === 'GET') return json([]);
      if (request.method() === 'POST') {
        if (url.pathname === '/rest/v1/rpc/get_my_pending_parent_invites') return json(available ? invites : []);
        if (url.pathname === '/rest/v1/rpc/get_parent_invite_by_token') {
          return json(available && (observed.body as { p_token?: string }).p_token === inviteToken ? [{ id: alexInvite }] : []);
        }
        if (url.pathname === '/rest/v1/rpc/accept_parent_invite') {
          claims.push(observed);
          const id = (observed.body as { p_invite_id?: string }).p_invite_id;
          return json(id === zaraInvite ? zaraId : alexId);
        }
        // TRAK-77: Matches lists the selected child's training (a read, over POST).
        if (url.pathname === '/rest/v1/rpc/family_training_history') return json([]);
        if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent') {
          return json(claims.length ? [{ player_user_id: zaraId, full_name: 'Zara Example', age_years: 14 }] : []);
        }
      }
    }
    // Includes all credential/profile changes, provisioning, emails and consent writes.
    unexpected.push(`${request.method()} ${url.pathname}`);
    return json({ message: 'Unmocked request blocked' }, 500);
  });
  return { requests, claims, unexpected, errors, parent, player };
}

test('public invitation reveals no child or recipient details before authentication', async ({ page, context }) => {
  const observed = await invitationsFixture(page, context);
  await page.goto(`/parent-invite?token=${inviteToken}`);
  await expect(page.getByRole('heading', { name: 'Parent invitation', exact: true })).toBeVisible();
  await expect(page.getByLabel('Your email address')).toBeVisible();
  await expect(page.getByText('Alex Example', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Zara Example', { exact: true })).toHaveCount(0);
  await expect(page.getByText(parentEmail, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Your email address')).toHaveValue('');
  expect(observed.requests.filter(request => request.path.includes('/rpc/'))).toEqual([]);
  expect(observed.claims).toEqual([]);
  expect(observed.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('shared phone switches from player to existing parent on the invitation and claims only the chosen child', async ({ page, context }, testInfo) => {
  const observed = await invitationsFixture(page, context, 'player');
  const invitationPath = `/parent-invite?token=${inviteToken}`;
  await page.goto(invitationPath);
  await expect(page.getByRole('alert')).toContainText('This account is not a parent account');
  await expect(page.getByText('Alex Example', { exact: true })).toHaveCount(0);
  expect(observed.requests.filter(request => request.path.includes('parent_invite'))).toEqual([]);

  await page.getByRole('button', { name: 'Sign out to use another account', exact: true }).click();
  await expect(page.getByLabel('Your email address')).toBeVisible();
  await expect(page).toHaveURL(appOrigin + invitationPath);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull();
  expect(observed.requests.find(request => request.path === '/auth/v1/logout')?.authorization)
    .toBe(`Bearer ${observed.player.access_token}`);

  await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();
  await page.getByLabel('Your email address').fill(parentEmail);
  await page.getByLabel('Password', { exact: true }).fill('ExistingParent1!');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('ExistingParent1!');
  expect(observed.requests.some(request => request.path === '/auth/v1/token')).toBe(false);
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Link Alex Example', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link Zara Example', exact: true })).toBeVisible();
  await expect(page).toHaveURL(appOrigin + invitationPath);
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Full name', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('existing-parent-invitations.png'), fullPage: true });

  await page.getByRole('button', { name: 'Link Zara Example', exact: true }).click();
  await expect(page).toHaveURL(appOrigin + '/parent/consent');
  await expect(page.getByRole('heading', { name: "Approve Zara Example's account", exact: true })).toBeVisible();
  expect(observed.claims).toEqual([{
    path: '/rest/v1/rpc/accept_parent_invite', method: 'POST',
    authorization: `Bearer ${observed.parent.access_token}`, body: { p_invite_id: zaraInvite },
  }]);
  expect(observed.requests.some(request => request.method === 'PUT' || request.method === 'PATCH'
    || request.path.includes('provision_my_profile') || request.path.includes('/functions/'))).toBe(false);
  expect(observed.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('expired or foreign invitation links produce a safe empty state for the verified parent', async ({ page, context }) => {
  const observed = await invitationsFixture(page, context, 'parent', false);
  for (const token of [inviteToken, unavailableToken]) {
    await page.goto(`/parent-invite?token=${token}`);
    await expect(page.getByRole('heading', { name: 'No active invitations', exact: true })).toBeVisible();
    await expect(page.getByText('This link is no longer active or is not available for this account.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Link / })).toHaveCount(0);
    await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Alex Example', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Zara Example', { exact: true })).toHaveCount(0);
  }
  expect(observed.claims).toEqual([]);
  expect(observed.requests.filter(request => request.path.startsWith('/auth/') && request.method !== 'GET')).toEqual([]);
  expect(observed.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});

// Stateful HTTP boundary only: this exercises the real router, AuthProvider,
// Supabase SDK and family query cache, not database RLS or email delivery.
// Both linked players are synthetic adults; consent policy is outside this test.
async function secondChildFixture(page: Page, context: BrowserContext) {
  const parent = session(parentId, parentEmail);
  const children = [
    { id: alexId, name: 'Alex Adult', born: '2000-01-01', opponent: 'Alex Opposition', club: 'Alex Academy' },
    { id: zaraId, name: 'Zara Adult', born: '1999-02-02', opponent: 'Zara Opposition', club: 'Zara Academy' },
  ];
  const linked = new Set([alexId]);
  const requests: ObservedRequest[] = [];
  const claims: ObservedRequest[] = [];
  const memberships: { ids: string[]; failed: boolean }[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  let failMembership = false;
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: storageKey, value: parent,
  });
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appOrigin) return route.continue();
    if (url.origin !== backendOrigin) {
      unexpected.push(request.url());
      return route.abort();
    }
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const reject = () => {
      unexpected.push(`${request.method()} ${url.pathname}${url.search}`);
      return json({ message: 'Unexpected request blocked' }, 500);
    };
    const observed: ObservedRequest = {
      path: url.pathname, method: request.method(), authorization: request.headers().authorization,
      body: request.postData() ? request.postDataJSON() as unknown : null,
    };
    requests.push(observed);
    if (observed.authorization !== `Bearer ${parent.access_token}`) return reject();
    if (request.method() === 'GET' && url.pathname === '/auth/v1/user') return json(parent.user);
    if (request.method() === 'POST') {
      if (url.pathname === '/rest/v1/telemetry_events') return json(null, 201);
      if (url.pathname === '/rest/v1/rpc/get_children_awaiting_consent') return json([]);
      // TRAK-77: Matches lists the selected child's training (a read, over POST).
      if (url.pathname === '/rest/v1/rpc/family_training_history') return json([]);
      if (url.pathname === '/rest/v1/rpc/get_my_pending_parent_invites') return json(linked.has(zaraId) ? [] : [{
        invite_id: zaraInvite, player_user_id: zaraId, player_name: children[1].name,
        parent_email: parentEmail, expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }]);
      if (url.pathname === '/rest/v1/rpc/get_parent_invite_by_token') {
        if ((observed.body as { p_token?: string }).p_token !== inviteToken) return reject();
        return json(linked.has(zaraId) ? [] : [{ id: zaraInvite }]);
      }
      if (url.pathname === '/rest/v1/rpc/accept_parent_invite') {
        if ((observed.body as { p_invite_id?: string }).p_invite_id !== zaraInvite) return reject();
        claims.push(observed);
        linked.add(zaraId);
        failMembership = true;
        return json(zaraId); // Actual RPC returns the linked player's UUID.
      }
      return reject();
    }
    // No password/profile writes, provisioning, consent, logout or email calls
    // are permitted. An unexpected request must fail, not silently succeed.
    if (request.method() !== 'GET') return reject();
    if (url.pathname === '/rest/v1/parental_consents') {
      if (url.searchParams.get('parent_user_id') !== `eq.${parentId}`
        || !linked.has((url.searchParams.get('player_user_id') ?? '').slice(3))
        || url.searchParams.get('withdrawn_at') !== 'is.null') return reject();
      return json([]);
    }
    if (url.pathname === '/rest/v1/player_parent_links') {
      if (url.searchParams.get('parent_user_id') !== `eq.${parentId}`) return reject();
      memberships.push({ ids: [...linked], failed: failMembership });
      return failMembership ? json({ message: 'Synthetic membership refresh failed' }, 503)
        : json([...linked].map(player_user_id => ({ player_user_id })));
    }
    if (url.pathname === '/rest/v1/profiles') {
      const filter = url.searchParams.get('user_id');
      if (filter === `eq.${parentId}`) {
        const profile = { id: parentId, user_id: parentId, role: 'parent', full_name: 'Existing Parent', nationality: null };
        return json(request.headers().accept?.includes('vnd.pgrst.object') ? profile : [profile]);
      }
      const ids = /^in\.\(([^)]+)\)$/.exec(filter ?? '')?.[1].split(',');
      if (!ids || ids.some(id => !linked.has(id))) return reject();
      return json(children.filter(child => ids.includes(child.id)).map(child => ({ user_id: child.id, full_name: child.name })));
    }
    const child = children.find(candidate => linked.has(candidate.id)
      && url.searchParams.get(url.pathname.endsWith('/squad_players') ? 'linked_player_id' : 'user_id') === `eq.${candidate.id}`);
    if (child && url.pathname === '/rest/v1/player_details') {
      return json([{ position: 'Midfielder', current_club: child.club, age_group: 'Senior' }]);
    }
    // No assessment/award data is needed for this membership-recovery journey.
    if (child && url.pathname === '/rest/v1/squad_players') return json([]);
    if (child && url.pathname === '/rest/v1/matches') return json([{
      id: child.id, user_id: child.id, match_date: '2026-09-01', created_at: '2026-09-02T12:00:00Z',
      opponent: child.opponent, competition: 'Synthetic Adult League', venue: child.club,
      team_score: 2, opponent_score: 1, computed_rating: 7,
    }]);
    return reject();
  });
  return {
    parent, children, requests, claims, memberships, unexpected, errors,
    restoreMembership: () => { failMembership = false; },
    linkedIds: () => [...linked],
  };
}

test('existing parent accepts a second child, recovers a failed family refresh and keeps both links after reload', async ({ page, context }) => {
  const observed = await secondChildFixture(page, context);
  const [alex, zara] = observed.children;
  await page.goto('/parent/home');
  await expect(page.getByRole('heading', { name: alex.name, exact: true })).toBeVisible();
  await expect(page.getByText(alex.opponent, { exact: true })).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(1);
  expect(observed.linkedIds()).toEqual([alexId]);

  const membershipReadsBeforeInvite = observed.memberships.length;
  await page.goto(`/parent-invite?token=${inviteToken}`);
  await expect(page.getByRole('button', { name: `Link ${zara.name}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Link ${alex.name}`, exact: true })).toHaveCount(0);
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
  await expect.poll(() => observed.memberships.slice(membershipReadsBeforeInvite)
    .some(read => !read.failed && read.ids.length === 1 && read.ids[0] === alexId)).toBe(true);
  const beforeClaim = observed.memberships.length;
  await page.getByRole('button', { name: `Link ${zara.name}`, exact: true }).click();
  await expect(page).toHaveURL(appOrigin + '/parent/consent');
  await expect(page.getByText('Nothing to approve', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Go to home', exact: true }).click();
  const failure = page.getByRole('alert').filter({ hasText: "Couldn't load your linked children." });
  await expect(failure).toBeVisible({ timeout: 15_000 });
  expect(observed.memberships.slice(beforeClaim).some(read => read.failed && read.ids.includes(zaraId))).toBe(true);
  await expect(page.getByText('No child linked yet', { exact: true })).toHaveCount(0);
  await expect(page.getByText(alex.opponent, { exact: true })).toHaveCount(0);
  await expect(page.getByText(zara.opponent, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);

  observed.restoreMembership();
  await failure.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.getByText(alex.opponent, { exact: true })).toBeVisible();
  await page.getByRole('combobox').selectOption(zaraId);
  await expect(page.getByRole('heading', { name: zara.name, exact: true })).toBeVisible();
  await expect(page.getByText(zara.opponent, { exact: true })).toBeVisible();
  await expect(page.getByText(alex.opponent, { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Matches', exact: true }).click();
  await expect(page.getByRole('combobox')).toHaveValue(zaraId);
  await expect(page.getByText(zara.opponent, { exact: true })).toBeVisible();
  await page.getByRole('combobox').selectOption(alexId);
  await expect(page.getByText(alex.opponent, { exact: true })).toBeVisible();
  await expect(page.getByText(zara.opponent, { exact: true })).toHaveCount(0);
  await page.getByRole('combobox').selectOption(zaraId);

  await page.getByRole('button', { name: 'Alerts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.getByText(`vs ${zara.opponent} · 2–1`, { exact: true })).toHaveCount(0);
  await expect(page.getByText(`vs ${alex.opponent} · 2–1`, { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to home' }).click();
  await expect(page.getByRole('combobox')).toHaveValue(zaraId);
  await expect(page.getByText(zara.opponent, { exact: true })).toBeVisible();
  await expect(page.getByText(alex.opponent, { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByText(`Following ${zara.name} · 2 children linked`, { exact: true })).toBeVisible();
  await page.getByRole('combobox').selectOption(alexId);
  await expect(page.getByText(`Following ${alex.name} · 2 children linked`, { exact: true })).toBeVisible();
  await page.getByRole('combobox').selectOption(zaraId);
  // P6 owns the subtitle change; this journey follows the Settings entry in
  // both independently reviewed branches, then verifies the actual children.
  await page.getByRole('button', { name: /^SETTINGS / }).click();
  const connections = page.getByRole('list', { name: 'Linked children', exact: true });
  await expect(connections.getByText(alex.name, { exact: true })).toHaveCount(1);
  await expect(connections.getByText(zara.name, { exact: true })).toHaveCount(1);
  await page.goBack();
  await page.getByRole('button', { name: 'Matches', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('combobox').selectOption(zaraId);
  await expect(page.getByText(zara.opponent, { exact: true })).toBeVisible();
  await expect(page.getByText(alex.opponent, { exact: true })).toHaveCount(0);

  expect(observed.linkedIds()).toEqual([alexId, zaraId]);
  expect(observed.claims).toEqual([{
    path: '/rest/v1/rpc/accept_parent_invite', method: 'POST',
    authorization: `Bearer ${observed.parent.access_token}`, body: { p_invite_id: zaraInvite },
  }]);
  const allowedPosts = new Set([
    '/rest/v1/telemetry_events', '/rest/v1/rpc/get_children_awaiting_consent',
    '/rest/v1/rpc/get_my_pending_parent_invites', '/rest/v1/rpc/get_parent_invite_by_token',
    '/rest/v1/rpc/accept_parent_invite', '/rest/v1/rpc/family_training_history',
  ]);
  expect(observed.requests.filter(request => request.method !== 'GET')
    .every(request => request.method === 'POST' && allowedPosts.has(request.path))).toBe(true);
  expect(observed.unexpected).toEqual([]);
  expect(observed.errors).toEqual([]);
});


// Coach and club signup forms are gone: Trak sets up staff (TRAK-12, staff-set-up-by-trak.test.tsx).
for (const role of ['player']) {
  test(`${role} signup reveals passwords independently without sending a request`, async ({ page, context }, testInfo) => {
    const observed = await invitationsFixture(page, context);
    await page.goto(`/onboarding/${role}`);
    const password = page.getByLabel('New password', { exact: true });
    const confirmation = page.getByLabel('Confirm password', { exact: true });
    await password.fill('SyntheticOnly1!');
    await confirmation.fill('SyntheticOnly1!');
    const toggle = page.getByRole('button', { name: 'Show new password', exact: true });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('SyntheticOnly1!');
    await expect(confirmation).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show confirm password', exact: true }).click();
    await expect(confirmation).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide new password', exact: true }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(confirmation).toHaveValue('SyntheticOnly1!');
    await confirmation.clear();
    await expect(confirmation).toHaveAttribute('type', 'password');
    await page.screenshot({ path: testInfo.outputPath(`${role}-password-toggle.png`), fullPage: true });
    expect(observed.requests).toEqual([]);
    expect(observed.unexpected).toEqual([]);
    expect(observed.errors).toEqual([]);
  });
}
