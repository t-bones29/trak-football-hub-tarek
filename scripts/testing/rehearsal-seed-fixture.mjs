// Runs the actual CLI module in a VM with no filesystem/network access inside it.
// The fake models authenticated role changes, consent-gated writes and durable
// rows across runs. It never imports the real Supabase client or reads .env.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'

const source = readFileSync(process.argv[3] ?? new URL('../../seed-pilot-rehearsal.mjs', import.meta.url), 'utf8')
const scenario = process.argv[2]
const password = randomUUID()
const domain = 'rehearsal.trak.dev'
const tables = {}
const accounts = new Map()
const attempts = new Map()
let current = null
let nextId = 0
let enforceConsent = true
let target = null
let injectedFailure = false
let clockTime = Date.parse('2026-09-21T15:00:00Z')
const rows = table => tables[table] ??= []
const uid = prefix => `${prefix}-${++nextId}`
const ok = data => ({ data, error: null })
const fail = message => ({ data: null, error: { code: '42501', message } })
const permitted = player => rows('parental_consents').some(row => row.player_user_id === player && row.withdrawn_at == null && row.superseded_by == null && row.purposes?.coaching_records === true)
const counts = () => Object.fromEntries(Object.entries(tables).map(([table, data]) => [table, data.length]))
const auth = {
  async signInWithPassword({ email }) {
    const user = accounts.get(email)
    if (user) { current = user; return ok({ user }) }
    return { data: { user: null }, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } }
  },
  async signUp({ email }) {
    const n = (attempts.get(email) ?? 0) + 1
    attempts.set(email, n)
    if ((scenario === 'signup-failure' || scenario === 'signup-retry') && email === `andreas.papadakis@${domain}` && (scenario === 'signup-failure' || n < 3)) {
      return { data: { user: null }, error: { code: 'over_request_rate_limit', status: 429, message: 'rate limit exceeded' } }
    }
    const user = { id: uid('user'), email }
    accounts.set(email, user)
    return ok({ user })
  },
}

function from(table) {
  let mode = 'read', payload, filters = [], single = false, limit, ordering, count = false
  const query = {
    select(_columns, options) { count = !!options?.count; return query },
    eq(key, value) { filters.push(row => row[key] === value); return query },
    is(key, value) { filters.push(row => (row[key] ?? null) === value); return query },
    in(key, values) { filters.push(row => values.includes(row[key])); return query },
    gte(key, value) { filters.push(row => row[key] >= value); return query },
    lt(key, value) { filters.push(row => row[key] < value); return query },
    limit(value) { limit = value; return query },
    order(key, options) { ordering = [key, options?.ascending !== false]; return query },
    maybeSingle() { single = true; return query },
    insert(value) { mode = 'insert'; payload = value; return query },
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        if (scenario === 'read-failure' && table === 'squad_players' && mode === 'read') return fail('synthetic roster read failed')
        let result
        if (mode === 'insert') {
          if (scenario === 'interrupted' && table === 'coach_assessments' && !injectedFailure) {
            injectedFailure = true
            return fail('synthetic assessment failure after successful match')
          }
          const values = Array.isArray(payload) ? payload : [payload]
          for (const value of values) {
            if (value.coach_user_id && value.coach_user_id !== current?.id) return fail('wrong authenticated coach')
            const assessment = rows('coach_assessments').find(row => row.id === value.assessment_id)
            const roster = rows('squad_players').find(row => row.id === (value.squad_player_id ?? assessment?.squad_player_id))
            if (enforceConsent && ['coach_assessments', 'recognition_awards'].includes(table) && roster?.linked_player_id && !permitted(roster.linked_player_id)) return fail('parental consent required below 18')
          }
          result = values.map(value => ({ id: uid('row'), ...value }))
          rows(table).push(...result)
        } else {
          result = rows(table).filter(row => filters.every(filter => filter(row)))
          if (table === 'matches') result = result.filter(row => row.user_id === current?.id)
          if (table === 'parental_consents') result = result.filter(row => row.parent_user_id === current?.id)
          if (ordering) result.sort((a, b) => String(a[ordering[0]]).localeCompare(String(b[ordering[0]])) * (ordering[1] ? 1 : -1))
        }
        const total = result.length
        if (limit !== undefined) result = result.slice(0, limit)
        return { data: scenario === 'missing-row' && table === 'coach_assessments' && mode === 'insert' ? null : single ? result[0] ?? null : result.map(row => ({ ...row })), error: null, count: count ? total : null }
      }).then(resolve, reject)
    },
  }
  return query
}

const client = { auth, from, async rpc(name, args) {
  if (name === 'provision_my_profile') {
    if (scenario === 'secret-error') return fail(`synthetic error containing ${password}`)
    const p = args.p
    if (!rows('profiles').some(row => row.user_id === current.id)) rows('profiles').push({ user_id: current.id, role: p.role, full_name: p.full_name, invite_code: uid('code') })
    if (p.role === 'club' && !rows('organizations').some(row => row.admin_user_id === current.id)) rows('organizations').push({ id: 'org', admin_user_id: current.id, name: 'Rehearsal FC', join_code: 'REHRS' })
    if (p.role === 'coach' && !rows('coach_details').some(row => row.user_id === current.id)) rows('coach_details').push({ user_id: current.id, organization_id: 'org', team: p.coach_details.team })
    if (p.role === 'player' && !rows('squad_players').some(row => row.linked_player_id === current.id)) {
      const coach = rows('profiles').find(row => row.invite_code === p.coach_invite_code)
      rows('squad_players').push({ id: uid('squad'), coach_user_id: coach.user_id, linked_player_id: current.id, player_name: p.full_name, position: p.player_details.position })
    }
    if (p.role === 'parent') for (const invite of rows('parent_invites').filter(row => row.email === current.email)) {
      if (!rows('player_parent_links').some(row => row.parent_user_id === current.id && row.player_user_id === invite.player_user_id)) rows('player_parent_links').push({ parent_user_id: current.id, player_user_id: invite.player_user_id })
    }
    return ok({ warnings: [] })
  }
  if (name === 'create_parent_invite') {
    if (!rows('parent_invites').some(row => row.player_user_id === current.id)) rows('parent_invites').push({ player_user_id: current.id, email: args.p_email })
    return ok({})
  }
  if (name === 'record_parental_consent') {
    if (!rows('player_parent_links').some(row => row.parent_user_id === current.id && row.player_user_id === args.p_player_user_id)) return fail('parent not linked')
    rows('parental_consents').push({ id: uid('consent'), player_user_id: args.p_player_user_id, parent_user_id: current.id, purposes: args.p_purposes, withdrawn_at: null, superseded_by: null })
    return ok({})
  }
  if (name === 'my_consent_status') return ok({ granted: permitted(current.id), required: !permitted(current.id), threshold: 18 })
  if (name === 'log_match_for_player') {
    if (args.p_goals > args.p_team_score) return fail('goals exceed team score')
    rows('matches').push({ id: uid('match'), user_id: args.p_user_id, logged_by: current.id, opponent: args.p_opponent, match_date: args.p_match_date })
    return ok({})
  }
  throw new Error(`Fixture must explicitly model RPC ${name}`)
} }

async function run() {
  const logs = []
  const fakeProcess = { env: { VITE_SUPABASE_URL: 'https://synthetic.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-key', TRAK_REHEARSAL_PASSWORD: password }, argv: ['node', 'seed-pilot-rehearsal.mjs'], exitCode: 0, exit(code) { this.exitCode = code; throw new Error(`EXIT ${code}`) } }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clockTime])) }
    static now() { return clockTime }
  }
  const context = vm.createContext({ Date: ClockDate, process: fakeProcess, console: { log: (...values) => logs.push(values.join(' ')), error: (...values) => logs.push(values.join(' ')), table: value => logs.push(JSON.stringify(value)) }, setTimeout: callback => { callback(); return 1 } })
  const module = new vm.SourceTextModule(source, { context, identifier: 'seed-pilot-rehearsal.mjs' })
  await module.link(specifier => {
    if (!['@supabase/supabase-js', 'node:fs'].includes(specifier)) throw new Error(`Unexpected import ${specifier}`)
    return new vm.SyntheticModule(specifier === 'node:fs' ? ['readFileSync'] : ['createClient'], function () {
      if (specifier === 'node:fs') this.setExport('readFileSync', () => { throw new Error('No fixture .env') })
      else this.setExport('createClient', () => client)
    }, { context })
  })
  try { await module.evaluate() } catch (error) { fakeProcess.exitCode ||= 1; logs.push(error.message) }
  return { exitCode: fakeProcess.exitCode, done: logs.includes('\n=== Done ==='), disclosedPassword: logs.some(line => line.includes(password)), consentDenied: logs.filter(line => line.includes('parental consent required')).length, logs }
}

let before
let foreign = null
if (['partial-rerun', 'backfill', 'extra-roster', 'duplicate-roster', 'legacy-linked', 'foreign-linked', 'ambiguous-fixtures', 'limited-consent', 'draft-feedback', 'unrelated-notes'].includes(scenario)) {
  enforceConsent = false
  await run()
  enforceConsent = true
  target = rows('squad_players').find(row => row.linked_player_id)
  const targetAssessments = rows('coach_assessments').filter(row => row.squad_player_id === target.id)
  const latest = targetAssessments.sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  if (scenario === 'partial-rerun') {
    tables.coach_assessments = rows('coach_assessments').filter(row => row.squad_player_id !== target.id)
    tables.matches = rows('matches').filter(row => row.user_id !== target.linked_player_id)
    tables.coach_assessment_notes = rows('coach_assessment_notes').filter(row => !targetAssessments.some(a => a.id === row.assessment_id))
    tables.coach_shared_feedback = rows('coach_shared_feedback').filter(row => !targetAssessments.some(a => a.id === row.assessment_id))
  } else if (scenario === 'backfill') {
    tables.coach_assessment_notes = rows('coach_assessment_notes').filter(row => row.assessment_id !== latest.id)
    tables.coach_shared_feedback = rows('coach_shared_feedback').filter(row => row.assessment_id !== latest.id)
  }
  if (scenario === 'extra-roster') rows('squad_players').push({ id: uid('extra'), coach_user_id: target.coach_user_id, player_name: 'Separate demo player', linked_player_id: null })
  if (scenario === 'duplicate-roster') rows('squad_players').push({ ...target, id: uid('duplicate') })
  if (scenario === 'legacy-linked') {
    const legacy = rows('squad_players').find(row => !row.linked_player_id)
    const email = `${legacy.player_name.toLowerCase().replace(/[^a-z]+/g, '.')}@${domain}`
    const user = { id: uid('legacy'), email }
    accounts.set(email, user)
    rows('profiles').push({ user_id: user.id, role: 'player', full_name: legacy.player_name })
    legacy.linked_player_id = user.id
    rows('coach_assessments').push({ id: uid('legacy-assessment'), squad_player_id: legacy.id, coach_user_id: legacy.coach_user_id, created_at: '2026-09-04T15:00:00Z' })
  }
  // A REAL account (not the rehearsal domain) linked to an intended roster
  // slot, e.g. a real child who joined a rehearsal coach with the TRK code.
  // The seed must stop before writing anything into that child's record.
  if (scenario === 'foreign-linked') {
    const slot = rows('squad_players').find(row => !row.linked_player_id)
    const user = { id: uid('foreign'), email: 'real.child@example.test' }
    accounts.set(user.email, user)
    rows('profiles').push({ user_id: user.id, role: 'player', full_name: slot.player_name })
    slot.linked_player_id = user.id
    foreign = { user: user.id, slot: slot.id }
  }
  if (scenario === 'ambiguous-fixtures') {
    const fixture = rows('coach_calendar_events')[0]
    rows('coach_calendar_events').push({ ...fixture, id: uid('duplicate-fixture'), starts_at: new Date(new Date(fixture.starts_at).getTime() + 86400000).toISOString() })
  }
  if (scenario === 'extra-roster') rows('coach_calendar_events').push({ id: uid('unrelated-event'), coach_user_id: target.coach_user_id, title: 'Training', opponent: null, event_type: 'training', starts_at: '2026-09-20T15:00:00Z' })
  if (scenario === 'limited-consent') rows('parental_consents')[0].purposes = { coaching_records: true, recognition: false, parent_visibility: false }
  if (scenario === 'draft-feedback') {
    const feedback = rows('coach_shared_feedback').find(row => row.assessment_id === latest.id)
    feedback.published_at = null
    feedback.body = 'Unpublished synthetic draft'
  }
  if (scenario === 'unrelated-notes') {
    rows('squad_players').push({ id: 'unrelated-roster', coach_user_id: target.coach_user_id, player_name: 'Outside Required Fixtures', linked_player_id: null })
    rows('coach_assessments').push({ id: 'unrelated-assessment', squad_player_id: 'unrelated-roster', coach_user_id: target.coach_user_id, created_at: '2026-09-04T15:00:00Z' })
    rows('coach_assessment_notes').push({ id: 'unrelated-private-note', assessment_id: 'unrelated-assessment', coach_user_id: target.coach_user_id, note: 'Private synthetic note outside required fixtures' })
    rows('coach_assessments').push({ id: 'unrelated-draft-assessment', squad_player_id: 'unrelated-roster', coach_user_id: target.coach_user_id, created_at: '2026-09-05T15:00:00Z' })
    rows('coach_shared_feedback').push({ id: 'unrelated-draft', assessment_id: 'unrelated-draft-assessment', coach_user_id: target.coach_user_id, published_at: null, body: 'Unrelated draft stays private' })
  }
  before = counts()
}
const result = await run()
const after = counts()
clockTime += 2 * 86400000
const rerun = result.exitCode === 0 || scenario === 'interrupted' ? await run() : null
const recovered = counts()
const thirdRun = scenario === 'interrupted' ? await run() : null
const latest = target && rows('coach_assessments').filter(row => row.squad_player_id === target.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
console.log(JSON.stringify({ ...result, logs: result.logs.filter(line => !line.includes(password)), before, after, recovered, thirdRun: thirdRun && { exitCode: thirdRun.exitCode }, final: counts(), rerun: rerun && { exitCode: rerun.exitCode }, targetAssessmentCount: target ? rows('coach_assessments').filter(row => row.squad_player_id === target.id).length : null, targetFeedback: !!latest && rows('coach_shared_feedback').some(row => row.assessment_id === latest.id && row.published_at != null), draftPreserved: !!latest && rows('coach_shared_feedback').some(row => row.assessment_id === latest.id && row.published_at === null && row.body === 'Unpublished synthetic draft'), unrelatedDraftPreserved: rows('coach_shared_feedback').some(row => row.id === 'unrelated-draft' && row.published_at === null && row.body === 'Unrelated draft stays private'), unrelatedPublished: rows('coach_shared_feedback').filter(row => row.assessment_id === 'unrelated-assessment').length, unrelatedNotePreserved: rows('coach_assessment_notes').some(row => row.id === 'unrelated-private-note' && row.note === 'Private synthetic note outside required fixtures'), signupAttempts: attempts.get(`andreas.papadakis@${domain}`), playerAccounts: rows('profiles').filter(row => row.role === 'player').length, foreignWrites: foreign && { consents: rows('parental_consents').filter(row => row.player_user_id === foreign.user).length, matches: rows('matches').filter(row => row.user_id === foreign.user).length, assessments: rows('coach_assessments').filter(row => row.squad_player_id === foreign.slot).length } }))
