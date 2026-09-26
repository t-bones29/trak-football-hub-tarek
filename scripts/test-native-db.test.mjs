import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { advisorDatabaseUrl, buildReplayPlan, childEnvironment, migrationReplayOrder, parseMode, runCommand } from './test-native-db.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runnerUrl = new URL('./test-native-db.mjs', import.meta.url).href;
const privateDirectory = '/private/tmp/trak-native-helper-test';
const pgBin = '/synthetic-postgres/bin';
const options = { env: childEnvironment(pgBin, privateDirectory), cwd: root, timeoutMs: 5_000 };
// These tests launch only short-lived Node/env processes. They never start a
// PostgreSQL cluster, connect to a database, create fixtures or invoke advisors.

test('child environment excludes inherited database targets and credentials', async () => {
  const inherited = {
    PATH: '/untrusted/search/path', PGHOST: 'remote.invalid', PGPORT: '5432',
    PGSERVICE: 'production', PGOPTIONS: '-c search_path=other', PGPASSWORD: 'synthetic-secret',
    PGPASSFILE: '/untrusted/password-file', DB_URL: 'postgresql://remote.invalid/database',
    SUPABASE_ACCESS_TOKEN: 'synthetic-token', NODE_OPTIONS: '--no-warnings',
  };
  const result = await runCommand(process.execPath, ['--input-type=module', '-e',
    `import { childEnvironment } from ${JSON.stringify(runnerUrl)}; process.stdout.write(JSON.stringify(childEnvironment(${JSON.stringify(pgBin)}, ${JSON.stringify(privateDirectory)})));`,
  ], { ...options, env: inherited });
  const actual = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(actual).sort(), ['LANG', 'LC_ALL', 'PATH', 'PGPASSFILE', 'TZ']);
  assert.equal(actual.PGPASSFILE, join(privateDirectory, 'unused-pgpass'));
  assert.equal(actual.TZ, 'UTC');
  assert.ok(!actual.PATH.includes('/untrusted/search/path'));
});

test('a Node-wrapped CLI resolves the current Node without the inherited PATH', async () => {
  const result = await runCommand('/usr/bin/env', ['node', '-p', 'process.execPath'], options);
  assert.equal(result.stdout.trim(), process.execPath);
  assert.ok(options.env.PATH.split(':').includes(dirname(process.execPath)));
});

test('advisor URL names only the private socket and explicit database identity', () => {
  const socket = '/private/tmp/trak test/socket';
  const url = new URL(advisorDatabaseUrl(socket));
  assert.equal(url.hostname, '');
  assert.equal(url.pathname, '/postgres');
  assert.equal(url.searchParams.get('host'), socket);
  assert.equal(url.searchParams.get('port'), '55439');
  assert.equal(url.searchParams.get('user'), 'postgres');
  assert.equal(url.searchParams.get('password'), null);
});

test('full replay includes all backfills and leaves committed deletion fixtures last', async () => {
  const { sql, suites } = await buildReplayPlan(root, parseMode([]));
  const index = file => sql.indexOf(`\\echo [stage] ${file}\n`);
  for (const [setup, migration, assertions] of [
    ['parent_invite_backfill_setup.sql', '20260917205027_secure_parent_invites.sql', 'parent_invite_backfill_assertions.sql'],
    ['academy_orphan_backfill_setup.sql', '20260918062345_preserve_academy_access_and_fk_cleanup.sql', 'academy_orphan_backfill_assertions.sql'],
  ]) {
    assert.ok(index(setup) >= 0 && index(setup) < index(migration));
    assert.ok(index(migration) < index(assertions));
  }
  assert.ok(index('pilot_view_backfill_setup.sql') >= 0);
  assert.ok(index('pilot_view_backfill_setup.sql') < index('20260918070209_restrict_pilot_operational_views.sql'));
  for (const suite of ['parent_invite_security.sql', 'pilot_view_security.sql', 'coach_departure_review.sql', 'academy_access_security.sql', 'pilot_g7.sql', 'avatar_storage.sql']) {
    assert.ok(suites.includes(suite), `${suite} must run in the full replay`);
  }
  assert.deepEqual(suites.slice(-2), ['account_deletion_setup.sql', 'account_deletion_assertions.sql']);
  assert.ok(index('academy_access_security.sql') < index('account_deletion_setup.sql'));
});

test('academy upgrade preserves dependencies before the older repair and its forward correction last', async () => {
  const academy = '20260918062345_preserve_academy_access_and_fk_cleanup.sql';
  const parent = '20260917205027_secure_parent_invites.sql';
  const pilot = '20260918070209_restrict_pilot_operational_views.sql';
  const files = (await readdir(join(root, 'supabase/migrations'))).filter(file => file.endsWith('.sql')).sort();
  const { sql, migrationCount, suites } = await buildReplayPlan(root, parseMode(['--academy-upgrade-review']));
  const stages = [...sql.matchAll(/^\\echo \[stage\] (.+)$/gm)].map(match => match[1]);
  const replayed = stages.filter(file => /^\d{14}_/.test(file));
  assert.equal(migrationCount, files.length);
  assert.deepEqual([...replayed].sort(), files, 'no migration omitted, duplicated, or replaced');
  // The invariant is adjacency, not position: the old academy migration replays
  // immediately before its forward repair, after everything deployed before that
  // repair. "Repair is last" was only true until the next migration merged — #84's
  // 20260921110000 sorts after it and legitimately follows it.
  const repair = '20260920152925_preserve_closed_academy_history.sql';
  assert.equal(replayed[replayed.indexOf(repair) - 1], academy, 'academy migration immediately precedes its forward repair');
  assert.ok(replayed.slice(0, replayed.indexOf(academy)).every(file => file < repair),
    'everything before the academy migration was deployed before the repair');
  assert.ok(replayed.slice(replayed.indexOf(repair) + 1).every(file => file > repair),
    'only migrations newer than the repair follow it');
  assert.ok(replayed.indexOf('20260918133800_ai_quota_known_functions.sql') < replayed.indexOf(academy));
  assert.equal(replayed.indexOf(parent), replayed.indexOf(pilot) + 1, 'preserve the deployed report-before-parent upgrade order');
  for (const [setup, migration, assertions] of [
    ['parent_invite_backfill_setup.sql', parent, 'parent_invite_backfill_assertions.sql'],
    ['academy_orphan_backfill_setup.sql', academy, 'academy_orphan_backfill_assertions.sql'],
  ]) {
    const index = stages.indexOf(migration);
    assert.equal(stages[index - 1], setup);
    assert.equal(stages[index + 1], assertions);
  }
  assert.equal(stages[stages.indexOf(pilot) - 1], 'pilot_view_backfill_setup.sql');
  assert.deepEqual(suites, ['parent_invite_security.sql', 'pilot_view_security.sql',
    'privilege_and_consent_security.sql', 'coach_notes_privacy.sql', 'org_referential_cleanup.sql', 'account_export.sql', 'pilot_g7.sql', 'avatar_storage.sql', 'family_training_history.sql',
    'coach_departure_review.sql', 'academy_access_security.sql',
    'account_deletion_setup.sql', 'account_deletion_assertions.sql']);
  assert.match(sql, /deployed main first, then academy repair/);
});

test('assessment upgrade applies current main, academy repair, then the unchanged older index', async () => {
  const files = (await readdir(join(root, 'supabase/migrations'))).filter(file => file.endsWith('.sql')).sort();
  const { sql, migrationCount, suites } = await buildReplayPlan(root, parseMode(['--assessment-upgrade-review']));
  const replayed = [...sql.matchAll(/^\\echo \[stage\] (\d{14}_.+\.sql)$/gm)].map(match => match[1]);
  assert.equal(migrationCount, files.length);
  assert.deepEqual([...replayed].sort(), files, 'all migration files run exactly once');
  // Invariants, not positions: the older index replays last of all; the
  // academy migration immediately precedes its forward repair; migrations
  // newer than the repair (#84 onward) legitimately sit between the two.
  const academy = '20260918062345_preserve_academy_access_and_fk_cleanup.sql';
  const repair = '20260920152925_preserve_closed_academy_history.sql';
  const index = '20260918080430_index_coach_assessment_history.sql';
  assert.equal(replayed.at(-1), index, 'the older index is applied last');
  assert.equal(replayed[replayed.indexOf(repair) - 1], academy, 'academy migration immediately precedes its repair');
  assert.ok(replayed.slice(0, replayed.indexOf(academy)).every(file => file < repair),
    'everything before the academy migration was deployed before the repair');
  assert.ok(replayed.indexOf('20260918133800_ai_quota_known_functions.sql') < replayed.indexOf(academy));
  assert.equal(replayed.indexOf('20260917205027_secure_parent_invites.sql'),
    replayed.indexOf('20260918070209_restrict_pilot_operational_views.sql') + 1);
  assert.deepEqual(suites, ['parent_invite_security.sql', 'pilot_view_security.sql',
    'privilege_and_consent_security.sql', 'coach_notes_privacy.sql', 'org_referential_cleanup.sql', 'account_export.sql', 'pilot_g7.sql', 'avatar_storage.sql', 'family_training_history.sql',
    'coach_departure_review.sql', 'academy_access_security.sql',
    'account_deletion_setup.sql', 'account_deletion_assertions.sql']);
  assert.match(sql, /deployed main first, then academy repair and forward corrections, then assessment index/);
});

test('upgrade modes fail if their required historical migrations are missing', () => {
  assert.throws(() => migrationReplayOrder([], '--parent-upgrade-review'), /requires both original/);
  assert.throws(() => migrationReplayOrder([
    '20260917205027_secure_parent_invites.sql', '20260918070209_restrict_pilot_operational_views.sql',
  ], '--academy-upgrade-review'), /requires the original academy migration/);
  assert.throws(() => migrationReplayOrder([
    '20260917205027_secure_parent_invites.sql', '20260918070209_restrict_pilot_operational_views.sql',
    '20260918062345_preserve_academy_access_and_fk_cleanup.sql',
  ], '--assessment-upgrade-review'), /requires the original index migration/);
});

test('negative controls exclude the corresponding repair while retaining its failing suite', async () => {
  const parent = await buildReplayPlan(root, parseMode(['--baseline']));
  assert.ok(!parent.sql.includes('\\echo [stage] 20260917205027_secure_parent_invites.sql\n'));
  assert.deepEqual(parent.suites, ['parent_invite_security.sql']);
  const departure = await buildReplayPlan(root, parseMode(['--coach-departure-baseline']));
  assert.ok(departure.sql.includes('\\echo [stage] 20260917205027_secure_parent_invites.sql\n'));
  assert.ok(!departure.sql.includes('\\echo [stage] 20260918062345_preserve_academy_access_and_fk_cleanup.sql\n'));
  assert.ok(departure.suites.includes('coach_departure_review.sql'));
  assert.ok(departure.migrationCount > parent.migrationCount);
});

test('CLI rejects arbitrary connection arguments and conflicting baseline modes', () => {
  assert.throws(() => parseMode(['--db-url=postgresql://remote.invalid']), /Usage/);
  assert.throws(() => parseMode(['--baseline', '--coach-departure-baseline']), /Usage/);
});

test('a failing process is rejected with its useful diagnostic output', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e',
    "process.stdout.write('last-stage'); process.stderr.write('synthetic failure'); process.exit(7);",
  ], options), error => {
    assert.match(error.message, /exited 7/);
    assert.match(error.message, /last-stage/);
    assert.match(error.message, /synthetic failure/);
    return true;
  });
});

test('only explicitly accepted nonzero status is successful', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.exit(3)'], { ...options, allowedCodes: [0, 3] });
  assert.equal(result.code, 3);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(3)'], options), /exited 3/);
});

test('missing executable is rejected without waiting for the command deadline', async () => {
  await assert.rejects(runCommand(join(root, 'no-such-native-test-binary'), [], options), /ENOENT/);
});

test('a hung process is terminated and rejected at its deadline', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    ...options, timeoutMs: 100,
  }), /deadline/);
});

test('an interrupted process is terminated and cannot become a successful result', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      ...options, signal: controller.signal,
    }), /interrupted/);
  } finally { clearTimeout(timer); }
});

test('process diagnostics stay bounded while preserving the end of each stream', async () => {
  const result = await runCommand(process.execPath, ['-e',
    "process.stdout.write('x'.repeat(40000) + 'stdout-tail'); process.stderr.write('y'.repeat(40000) + 'stderr-tail');",
  ], options);
  assert.ok(result.stdout.length <= 16 * 1024);
  assert.ok(result.stderr.length <= 16 * 1024);
  assert.ok(result.stdout.endsWith('stdout-tail'));
  assert.ok(result.stderr.endsWith('stderr-tail'));
});
