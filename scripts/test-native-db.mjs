#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMigrationFiles } from './migration-input.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultBin = '/opt/homebrew/opt/postgresql@17/bin';
export const temporaryRoot = process.platform === 'darwin' ? '/private/tmp' : '/tmp';
const socketPort = '55439';
const outputLimit = 16 * 1024;
const securityMigration = '20260917205027_secure_parent_invites.sql';
const academyMigration = '20260918062345_preserve_academy_access_and_fk_cleanup.sql';
const pilotViewsMigration = '20260918070209_restrict_pilot_operational_views.sql';
const assessmentMigration = '20260918080430_index_coach_assessment_history.sql';
const historyRepairMigration = '20260920152925_preserve_closed_academy_history.sql';

export function parseMode(args) {
  if (args.length > 1 || (args.length && !['--baseline', '--coach-departure-baseline', '--academy-upgrade-review', '--assessment-upgrade-review'].includes(args[0]))) {
    throw new Error('Usage: node scripts/test-native-db.mjs [--baseline | --coach-departure-baseline | --academy-upgrade-review | --assessment-upgrade-review]');
  }
  return args[0] ?? 'all';
}

// Both engines exercise the same order without renaming or rewriting reviewed
// migrations. PR35 preceded P1 in deployment; PR34 is still unapplied on main.
export function migrationReplayOrder(files, mode) {
  const migrations = [...files].sort();
  const assessmentUpgrade = mode === '--assessment-upgrade-review';
  if (mode === '--parent-upgrade-review' || mode === '--academy-upgrade-review' || assessmentUpgrade) {
    if (!migrations.includes(securityMigration) || !migrations.includes(pilotViewsMigration)) {
      throw new Error('Upgrade review requires both original parent and pilot-view migration files');
    }
    migrations.splice(migrations.indexOf(securityMigration), 1);
    migrations.splice(migrations.indexOf(pilotViewsMigration) + 1, 0, securityMigration);
  }
  if (mode === '--academy-upgrade-review' || assessmentUpgrade) {
    if (!migrations.includes(academyMigration)) throw new Error('Academy upgrade review requires the original academy migration');
    migrations.splice(migrations.indexOf(academyMigration), 1);
    // The old migration is pending after the deployed dependency, but must
    // never run after the forward repair which reconciles their definitions.
    const forwardIndex = migrations.findIndex(file => file >= historyRepairMigration);
    migrations.splice(forwardIndex < 0 ? migrations.length : forwardIndex, 0, academyMigration);
  }
  if (assessmentUpgrade) {
    if (!migrations.includes(assessmentMigration)) throw new Error('Assessment upgrade review requires the original index migration');
    migrations.splice(migrations.indexOf(assessmentMigration), 1);
    migrations.push(assessmentMigration);
  }
  return migrations;
}

// Do not inherit PGHOST, PGSERVICE, PGOPTIONS, passwords, default-cluster
// settings or other application credentials. Even libpq's default .pgpass is
// disabled by pointing it at a nonexistent file in our private directory.
export function childEnvironment(bin, directory) {
  return {
    // npm-installed CLIs may use /usr/bin/env node. Resolve the executable
    // already running this script, without trusting the inherited PATH.
    PATH: `${dirname(process.execPath)}:${bin}:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
    PGPASSFILE: join(directory, 'unused-pgpass'),
  };
}

export function advisorDatabaseUrl(socket) {
  const query = new URLSearchParams({ host: socket, port: socketPort, user: 'postgres' });
  // No network hostname: an unsupported Unix-socket URL must fail, never
  // fall back to localhost, a linked project, or a default database.
  return `postgresql:///postgres?${query}`;
}

export async function buildReplayPlan(projectRoot, mode) {
  const migrationDirectory = join(projectRoot, 'supabase/migrations');
  const migrations = migrationReplayOrder(validateMigrationFiles(await readdir(migrationDirectory)).filter(file =>
    (mode !== '--baseline' || file < securityMigration)
    && (mode !== '--coach-departure-baseline' || file < academyMigration),
  ), mode);
  const steps = [{ name: 'bootstrap.sql', path: join(projectRoot, 'supabase/tests/bootstrap.sql') }];
  const fixture = name => steps.push({ name, path: join(projectRoot, 'supabase/tests', name) });
  for (const file of migrations) {
    if (!/^\d{14}_[a-zA-Z0-9_-]+\.sql$/.test(file)) throw new Error(`Unsupported migration filename: ${file}`);
    if (file === securityMigration) fixture('parent_invite_backfill_setup.sql');
    if (file === academyMigration) fixture('academy_orphan_backfill_setup.sql');
    if (file === pilotViewsMigration) fixture('pilot_view_backfill_setup.sql');
    steps.push({ name: file, path: join(migrationDirectory, file) });
    if (file === securityMigration) fixture('parent_invite_backfill_assertions.sql');
    if (file === academyMigration) fixture('academy_orphan_backfill_assertions.sql');
  }
  const suites = mode === '--baseline' ? ['parent_invite_security.sql'] : [
    ...(mode === 'all' || mode === '--academy-upgrade-review' || mode === '--assessment-upgrade-review' ? ['parent_invite_security.sql', 'pilot_view_security.sql',
      'privilege_and_consent_security.sql', 'coach_notes_privacy.sql', 'org_referential_cleanup.sql', 'account_export.sql', 'pilot_g7.sql', 'avatar_storage.sql',
      'family_training_history.sql'] : []),
    'coach_departure_review.sql', 'academy_access_security.sql',
    // These committed fixtures must stay LAST; earlier suites assume a clean DB.
    'account_deletion_setup.sql', 'account_deletion_assertions.sql',
  ];
  let sql = "\\set ON_ERROR_STOP on\nSET client_min_messages = warning;\n"
    + "SELECT '[native-db] ' || version();\n\\o /dev/null\n";
  for (const step of steps) {
    sql += `\\echo [stage] ${step.name}\n${await readFile(step.path, 'utf8')}\n`;
  }
  const description = mode === '--assessment-upgrade-review' ? '; deployed main first, then academy repair and forward corrections, then assessment index.'
    : mode === '--academy-upgrade-review' ? '; deployed main first, then academy repair and forward corrections.'
    : mode === 'all' ? ' with backfill assertions.' : '; vulnerable baseline MUST fail.';
  sql += `\\echo [native-db] Replayed ${migrations.length} migrations${description}\n`;
  for (const suite of suites) {
    sql += `\\echo [stage] ${suite}\n${await readFile(join(projectRoot, 'supabase/tests', suite), 'utf8')}\n`;
    sql += `\\echo [native-db] Passed: ${suite}\n`;
  }
  return { sql, migrationCount: migrations.length, suites };
}

// Bounded output and deadlines apply to every child, including shutdown.
export function runCommand(executable, args, { env, cwd, timeoutMs = 60_000, signal, allowedCodes = [0] }) {
  return new Promise((resolveCommand, rejectCommand) => {
    if (signal?.aborted) return rejectCommand(new Error('Native database run interrupted'));
    let stdout = '', stderr = '', failure = '', killTimer;
    const child = spawn(executable, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = reason => {
      if (failure) return;
      failure = reason;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    };
    const interrupted = () => stop('interrupted');
    signal?.addEventListener('abort', interrupted, { once: true });
    const timer = setTimeout(() => stop(`exceeded ${timeoutMs}ms deadline`), timeoutMs);
    child.stdout.on('data', data => { stdout = (stdout + data).slice(-outputLimit); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-outputLimit); });
    child.once('error', error => { failure = error.message; });
    child.once('close', (code, childSignal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', interrupted);
      if (failure || !allowedCodes.includes(code)) {
        rejectCommand(new Error(`${basename(executable)} ${failure || `exited ${code ?? childSignal}`}\n${stdout}\n${stderr}`.trim()));
      } else {
        resolveCommand({ code, stdout, stderr });
      }
    });
  });
}

async function printServerLog(path) {
  try {
    const log = await readFile(path, 'utf8');
    if (log.trim()) console.error(`[native-db] Server log (last ${outputLimit} characters):\n${log.slice(-outputLimit)}`);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(`[native-db] Could not read server log: ${error.message}`);
  }
}

export async function runNative({ args = [], bin = defaultBin, advisorBin } = {}) {
  const mode = parseMode(args);
  if (!isAbsolute(bin) || (advisorBin && !isAbsolute(advisorBin))) {
    throw new Error('TRAK_TEST_PG_BIN and optional TRAK_TEST_SUPABASE_BIN must be absolute paths');
  }
  const commands = Object.fromEntries(['postgres', 'initdb', 'pg_ctl', 'psql'].map(name => [name, join(bin, name)]));
  for (const executable of Object.values(commands)) await access(executable, constants.X_OK);
  if (advisorBin) await access(advisorBin, constants.X_OK);
  const plan = await buildReplayPlan(root, mode);
  // Never use Homebrew's default data directory or any existing cluster.
  const directory = await mkdtemp(join(temporaryRoot, 'trak-pg17-'));
  const data = join(directory, 'data');
  const socket = join(directory, 'socket');
  const serverLog = join(directory, 'server.log');
  const env = childEnvironment(bin, directory);
  const controller = new AbortController();
  const interrupted = () => controller.abort();
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  let startAttempted = false, failure, cleanupFailure;
  const command = (executable, commandArgs, options = {}) => runCommand(executable, commandArgs, {
    env, cwd: directory, signal: controller.signal, ...options,
  });
  try {
    await chmod(directory, 0o700);
    await mkdir(socket, { mode: 0o700 });
    const version = await command(commands.postgres, ['--version'], { timeoutMs: 10_000 });
    if (!/\(PostgreSQL\) 17\./.test(version.stdout)) throw new Error(`PostgreSQL 17 required; found ${version.stdout.trim()}`);
    await command(commands.initdb, ['-D', data, '-U', 'postgres', '--locale=C', '--encoding=UTF8', '--auth-local=trust', '--auth-host=reject', '--no-instructions']);
    startAttempted = true;
    await command(commands.pg_ctl, ['-D', data, '-l', serverLog, '-w', '-t', '30', '-o',
      `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c port=${socketPort} -c timezone=UTC`, 'start'], { timeoutMs: 40_000 });
    const replay = join(directory, 'replay.sql');
    await writeFile(replay, plan.sql, { mode: 0o600 });
    const result = await command(commands.psql, ['-X', '--no-password', '-h', socket, '-p', socketPort,
      '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', replay], { timeoutMs: 180_000 });
    console.log(result.stdout.split('\n').filter(line => line.startsWith('[native-db]')).join('\n'));
    if (mode === '--baseline' || mode === '--coach-departure-baseline') throw new Error('Vulnerable baseline unexpectedly passed its security assertions');
    if (advisorBin) {
      const advice = await command(advisorBin, ['db', 'advisors', '--db-url', advisorDatabaseUrl(socket),
        '--type', 'security', '--level', 'warn', '--fail-on', 'error'], { timeoutMs: 120_000 });
      console.log(`[native-db] Security advisor completed.\n${advice.stdout}${advice.stderr}`.trim());
    } else {
      console.log('[native-db] Security advisor not run (TRAK_TEST_SUPABASE_BIN not set).');
    }
  } catch (error) {
    failure = error;
    console.error(`[native-db] ${error.message}`);
    await printServerLog(serverLog);
  } finally {
    if (startAttempted) {
      try {
        // Ignore the cancelled run signal during cleanup. Address only our
        // explicit data directory, never pg_ctl's environment/default cluster.
        await command(commands.pg_ctl, ['-D', data, '-m', 'immediate', '-w', '-t', '15', 'stop'], { signal: undefined, timeoutMs: 20_000 });
        console.log('[native-db] Temporary cluster stopped.');
      } catch (error) {
        try {
          const status = await command(commands.pg_ctl, ['-D', data, 'status'], { signal: undefined, timeoutMs: 10_000, allowedCodes: [0, 3] });
          if (status.code !== 3) throw error;
          console.log('[native-db] Temporary cluster is already stopped.');
        } catch (statusError) {
          cleanupFailure = statusError;
          console.error(`[native-db] Shutdown failed: ${statusError.message}`);
          await printServerLog(serverLog);
        }
      }
    }
    // Do not unlink an active/unknown cluster's files if the OS refuses stop.
    // That exceptional cleanup failure is nonzero and names only our directory.
    if (!cleanupFailure) {
      try {
        await rm(directory, { recursive: true, force: true });
        console.log('[native-db] Temporary directory removed.');
      } catch (error) { cleanupFailure = error; }
    }
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
  }
  if (cleanupFailure) throw new Error(`Cleanup failed; inspect only ${directory}: ${cleanupFailure.message}`);
  if (failure) throw new Error('Native PostgreSQL verification failed; see diagnostics above.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runNative({ args: process.argv.slice(2), bin: process.env.TRAK_TEST_PG_BIN || defaultBin,
    advisorBin: process.env.TRAK_TEST_SUPABASE_BIN || undefined }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
