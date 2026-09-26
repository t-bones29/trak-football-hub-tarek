#!/usr/bin/env node
// Real concurrent RPC calls against an exclusively owned temporary PG17 cluster.
// No application connection settings, existing cluster, TCP listener or live DB.
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReplayPlan, childEnvironment, runCommand, temporaryRoot } from './test-native-db.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--historical-link-rpc')) {
  throw new Error('Usage: node scripts/test-link-concurrency.mjs [--historical-link-rpc]');
}
const historical = args[0] === '--historical-link-rpc';
const root = fileURLToPath(new URL('../', import.meta.url));
const bin = process.env.TRAK_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
if (!isAbsolute(bin)) throw new Error('TRAK_TEST_PG_BIN must be an absolute PostgreSQL 17 binary directory');
const port = '55441';
const directory = await mkdtemp(join(temporaryRoot, 'trak-link-race-'));
const data = join(directory, 'data');
const socket = join(directory, 'socket');
const env = childEnvironment(bin, directory);
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const command = (name, args, options = {}) => runCommand(join(bin, name), args, {
  cwd: directory, env, signal: controller.signal, ...options,
});
const psqlArgs = ['-X', '--no-password', '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'];
const query = sql => command('psql', [...psqlArgs, '-c', sql], { timeoutMs: 20_000 });
const uid = n => `94000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

// A persistent third connection holds a row/table lock until both independent
// RPC connections reach a lock wait. This controls scheduling, not application
// logic: no migration/function is replaced and no extra trigger is installed.
function controlConnection() {
  const child = spawn(join(bin, 'psql'), psqlArgs, { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', errors = '', pending, sequence = 0, closed = false;
  child.stdout.on('data', data => {
    buffer += data;
    if (pending && buffer.includes(pending.marker)) {
      const value = buffer.slice(0, buffer.indexOf(pending.marker));
      buffer = buffer.slice(buffer.indexOf(pending.marker) + pending.marker.length).trimStart();
      clearTimeout(pending.timer);
      pending.resolve(value.trim());
      pending = undefined;
    }
    if (buffer.length > 16384) buffer = buffer.slice(-16384);
  });
  child.stderr.on('data', data => { errors = (errors + data).slice(-16384); });
  child.on('error', error => { pending?.reject(error); });
  child.on('close', code => {
    closed = true;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(`Control psql exited ${code}: ${errors}`)); pending = undefined; }
  });
  return {
    async sql(text) {
      if (pending || closed) throw new Error('Control connection unavailable');
      const marker = `__TRAK_CONTROL_${++sequence}__`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Control connection exceeded 10s deadline')); }, 10_000);
        pending = { marker, resolve, reject, timer };
        child.stdin.write(`${text};\n\\echo ${marker}\n`);
      });
    },
    stop() { child.stdin.end('ROLLBACK;\n\\q\n'); if (!closed) child.kill('SIGTERM'); },
  };
}

let startAttempted = false, control, cleanupFailure, failure;
try {
  await chmod(directory, 0o700);
  await mkdir(socket, { mode: 0o700 });
  const version = await command('postgres', ['--version'], { timeoutMs: 10_000 });
  if (!/\(PostgreSQL\) 17\./.test(version.stdout)) throw new Error('PostgreSQL 17 required');
  console.log(`[link-concurrency] ${version.stdout.trim()}`);
  await command('initdb', ['-D', data, '-U', 'postgres', '--locale=C', '--encoding=UTF8', '--auth-local=trust', '--auth-host=reject', '--no-instructions']);
  startAttempted = true;
  await command('pg_ctl', ['-D', data, '-l', join(directory, 'server.log'), '-w', '-t', '30', '-o',
    `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c port=${port} -c timezone=UTC`, 'start'], { timeoutMs: 40_000 });
  const plan = await buildReplayPlan(root, 'all');
  const replay = join(directory, 'replay.sql');
  await writeFile(replay, plan.sql, { mode: 0o600 });
  await command('psql', [...psqlArgs, '-f', replay], { timeoutMs: 180_000 });
  console.log(`[link-concurrency] Replayed ${plan.migrationCount} real migrations and sequential suites.`);
  if (historical) {
    // Use the actual immutable historical function, not a hand-written mock or
    // text substitution in the fix. Leave every other schema object intact.
    const original = await readFile(join(root, 'supabase/migrations/20260901000006_link_player_adopts_roster_row.sql'), 'utf8');
    const start = original.indexOf('CREATE OR REPLACE FUNCTION public.link_player_to_coach');
    const end = original.indexOf('$fn$;', start);
    if (start < 0 || end < start) throw new Error('Historical link RPC definition not found');
    await query(original.slice(start, end + '$fn$;'.length));
    console.log('[link-concurrency] Historical link RPC loaded; safety assertions MUST fail.');
  }
  await query(`
    INSERT INTO auth.users(id,email,email_confirmed_at)
      SELECT ('94000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'race-'||i||'@test.invalid',now() FROM generate_series(1,4) i;
    INSERT INTO profiles(user_id,role,full_name,invite_code) VALUES
      ('${uid(1)}','coach','Race Coach','RACE01'),
      ('${uid(2)}','player','Race Player',NULL),
      ('${uid(3)}','player','Race Player',NULL),
      ('${uid(4)}','player','Race Player',NULL);
    INSERT INTO coach_details(user_id) VALUES ('${uid(1)}');
    INSERT INTO player_details(user_id,date_of_birth) VALUES ('${uid(2)}','2000-01-01'),('${uid(3)}','2000-01-01'),('${uid(4)}','2000-01-01');
  `);
  control = controlConnection();
  const results = [];
  for (const [name, players, stub] of [
    ['same_player_empty_roster', [2, 2], false],
    ['same_player_one_stub', [2, 2], true],
    ['different_players_one_stub', [3, 4], true],
  ]) {
    await query(`DELETE FROM squad_players WHERE coach_user_id='${uid(1)}';`);
    if (stub) await query(`INSERT INTO squad_players(id,coach_user_id,player_name) VALUES ('${uid(20)}','${uid(1)}','Race Player'); INSERT INTO coach_assessments(coach_user_id,squad_player_id) VALUES ('${uid(1)}','${uid(20)}');`);
    await control.sql(stub
      ? `BEGIN; SELECT id FROM public.squad_players WHERE id='${uid(20)}' FOR UPDATE`
      : 'BEGIN; LOCK TABLE public.squad_players IN SHARE MODE');
    const calls = players.map((player, index) => query(`
      SET application_name='trak_link_race_${index}';
      BEGIN;
      SET LOCAL statement_timeout='15s';
      -- TRAK-48 slice 4: app roles can no longer call link_player_to_coach; the
      -- race is still exercised, as the owner, with each player's identity.
      SELECT set_config('request.jwt.claims','{"sub":"${uid(player)}","role":"authenticated"}',true);
      SELECT public.link_player_to_coach('TRK-RACE01');
      COMMIT;
    `).then(result => ({ ok: true, ids: result.stdout.split('\n').filter(line => /^[0-9a-f-]{36}$/.test(line)) }), error => ({ ok: false, error: error.message })));
    let waiting = 0, waitStates = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      // pg_stat_activity caches its snapshot for this long-lived blocker
      // transaction. Explicitly refresh before observing the two other PIDs.
      await control.sql('SELECT pg_stat_clear_snapshot()');
      waitStates = JSON.parse(await control.sql("SELECT coalesce(json_agg(json_build_object('pid',pid,'client',application_name,'state',state,'wait_type',wait_event_type,'wait_event',wait_event)), '[]'::json) FROM pg_stat_activity WHERE application_name IN ('trak_link_race_0','trak_link_race_1')"));
      waiting = waitStates.filter(state => state.wait_type === 'Lock').length;
      if (waiting === 2) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    await control.sql('COMMIT');
    const responses = await Promise.all(calls);
    if (waiting !== 2) throw new Error(`${name}: did not observe both independent RPC connections waiting; schedule unproven. Last wait states=${JSON.stringify(waitStates)}; responses=${JSON.stringify(responses)}`);
    const { stdout } = await query(`SELECT json_build_object(
      'rows', (SELECT count(*) FROM squad_players WHERE coach_user_id='${uid(1)}'),
      'duplicate_players', (SELECT count(*) FROM (SELECT linked_player_id FROM squad_players WHERE coach_user_id='${uid(1)}' AND linked_player_id IS NOT NULL GROUP BY linked_player_id HAVING count(*)>1) d),
      'links', (SELECT json_agg(json_build_object('id',id,'player',linked_player_id) ORDER BY id) FROM squad_players WHERE coach_user_id='${uid(1)}'),
      'stub_owner', (SELECT linked_player_id FROM squad_players WHERE id='${uid(20)}'),
      'history_rows', (SELECT count(*) FROM coach_assessments WHERE squad_player_id='${uid(20)}')
    );`);
    const observed = JSON.parse(stdout.trim());
    const expectedRows = new Set(players).size;
    const passed = responses.every((response, index) => response.ok && response.ids.length === 1
      && observed.links.some(link => link.id === response.ids[0] && link.player === uid(players[index])))
      && observed.rows === expectedRows && observed.duplicate_players === 0
      && (!stub || (players.map(uid).includes(observed.stub_owner) && observed.history_rows === 1));
    const result = { name, passed, waitStates, responses, observed };
    results.push(result);
    console.log(`[link-concurrency] ${JSON.stringify(result)}`);
  }
  if (results.some(result => !result.passed)) throw new Error('Concurrent link safety assertions failed; duplicates/errors above are unresolved.');
  if (historical) throw new Error('Historical link RPC unexpectedly passed its concurrency safety assertions.');
} catch (error) {
  failure = error;
  console.error(`[link-concurrency] ${error.message}`);
  try { console.error((await readFile(join(directory, 'server.log'), 'utf8')).slice(-2000)); } catch { /* startup may not have produced a log */ }
} finally {
  control?.stop();
  if (startAttempted) {
    try {
      await command('pg_ctl', ['-D', data, '-m', 'immediate', '-w', '-t', '15', 'stop'], { signal: undefined, timeoutMs: 20_000 });
    } catch (error) {
      const status = await command('pg_ctl', ['-D', data, 'status'], { signal: undefined, timeoutMs: 10_000, allowedCodes: [0, 3] }).catch(() => undefined);
      if (status?.code !== 3) cleanupFailure = error;
    }
  }
  if (!cleanupFailure) {
    await rm(directory, { recursive: true, force: true });
    console.log('[link-concurrency] Temporary cluster stopped and directory removed.');
  } else console.error(`[link-concurrency] Cleanup failed; inspect only ${directory}: ${cleanupFailure.message}`);
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
if (failure || cleanupFailure) process.exitCode = 1;
