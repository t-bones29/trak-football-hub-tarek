/**
 * Throwaway academy for the week −2 pilot rehearsal.
 *
 * Builds a complete, believable academy — club admin, 3 coaches, 2 squads,
 * ~30 players, linked parents, a fixture list, match history, assessments and
 * awards — shaped so that EVERY pilot_* view returns a real number rather than
 * an empty set. Rehearsing against empty views teaches nothing; the point is to
 * see the scorecard populated before a real child's data exists.
 *
 * Run:   node seed-pilot-rehearsal.mjs
 * Reset: node seed-pilot-rehearsal.mjs --purge
 *
 * Everything it creates lives under the @rehearsal.trak.dev domain and the
 * organisation named "Rehearsal FC", so it is unambiguous what is throwaway.
 *
 * PREREQUISITE: migrations 20260901000001-3 must be applied. The script checks
 * and stops with instructions rather than half-seeding.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

/* ── config ──────────────────────────────────────────────────────────────── */

function env(key, fallback) {
  if (process.env[key]) return process.env[key]
  try {
    const line = readFileSync('.env', 'utf8')
      .split('\n')
      .find(l => l.startsWith(`${key}=`))
    if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
  } catch { /* no .env — fall through */ }
  return fallback
}

// The project standardised on VITE_SUPABASE_PUBLISHABLE_KEY; VITE_SUPABASE_ANON_KEY
// is accepted as an alias so either naming works.
const SUPABASE_URL = env('VITE_SUPABASE_URL')
const SUPABASE_ANON_KEY = env('VITE_SUPABASE_PUBLISHABLE_KEY') || env('VITE_SUPABASE_ANON_KEY')

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (env or .env).')
  process.exit(1)
}

const DOMAIN = 'rehearsal.trak.dev'
// Never commit this. The repository is public, and these accounts are created
// in whatever project VITE_SUPABASE_URL points at — which the runbook points at
// the pilot project. A literal here is a working credential for a live account
// holding children's data, readable by anyone.
const PW = process.env.TRAK_REHEARSAL_PASSWORD
if (!PW || PW.length < 16) {
  console.error('Set TRAK_REHEARSAL_PASSWORD (16+ characters) in the environment before seeding.')
  console.error('Do not pass it as a command-line argument — it would land in shell history.')
  process.exit(1)
}
const ORG_NAME = 'Rehearsal FC'
const JOIN_CODE = 'REHRS'

// Mirrors src/lib/consent.ts (CONSENT_NOTICE_VERSION, CONSENT_STATEMENT) — a
// .mjs cannot import the TS module. Change both together, as the app does.
const CONSENT_NOTICE_VERSION = '2026-09-12.1'
const CONSENT_STATEMENT =
  'I confirm I hold parental responsibility for this child and I authorise the processing I have selected above. ' +
  'I understand I can withdraw at any time from my profile, and that withdrawing stops future processing.'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/* ── helpers ─────────────────────────────────────────────────────────────── */

const day = 86400000
const today = new Date()
const dateOnly = d => d.toISOString().slice(0, 10)
const daysAgo = n => dateOnly(new Date(today.getTime() - n * day))
const isoDaysAgo = n => new Date(today.getTime() - n * day).toISOString()
const pick = (arr, i) => arr[i % arr.length]

let step = 0
const log = msg => console.log(`  ${msg}`)
const heading = msg => console.log(`\n${++step}. ${msg}`)

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function signInOrUp(email) {
  let { data } = await supabase.auth.signInWithPassword({ email, password: PW })
  if (data?.user) return data.user
  // Creating an account is rate limited. A burst of ~30 signups trips it and
  // the failures are silent from the caller's side, which is what left the
  // second squad half-built on the first run.
  await sleep(400)
  const { error: suErr } = await supabase.auth.signUp({ email, password: PW })
  if (suErr && !/already registered/i.test(suErr.message)) {
    log(`sign-up failed for ${email}: ${suErr.message}`)
  }
  const retry = await supabase.auth.signInWithPassword({ email, password: PW })
  if (!retry.data?.user) {
    log(`sign-in failed for ${email}: ${retry.error?.message ?? 'unknown'}`)
    log('If this says "Email not confirmed", disable Confirm email in Supabase Auth settings.')
  }
  return retry.data?.user ?? null
}

/**
 * The one supported way to create a profile.
 *
 * Direct inserts do not work and must not be used: RLS blocks self-assigning
 * role='club' (20260526000005), blocks a player writing squad_players, and
 * blocks player_parent_links entirely. provision_my_profile is the SECURITY
 * DEFINER path the app itself uses, so seeding through it exercises exactly
 * what a real signup exercises.
 */
async function provision(payload) {
  const { data, error } = await supabase.rpc('provision_my_profile', { p: payload })
  if (error) {
    log(`provision ${payload.role} "${payload.full_name}": ${error.message}`)
    return null
  }
  const warnings = data?.warnings ?? []
  for (const w of warnings) log(`  warning: ${w}`)
  return data ?? {}
}

async function myProfile(userId) {
  // Filter explicitly: a club admin can read every profile, so an unfiltered
  // maybeSingle() would error rather than return the caller's own row.
  const { data } = await supabase.from('profiles')
    .select('user_id, role, full_name, invite_code')
    .eq('user_id', userId).maybeSingle()
  return data
}

/* ── content ─────────────────────────────────────────────────────────────── */

const FIRST = ['Andreas','Nikos','Yiannis','Stavros','Dimitris','Petros','Kostas','Marios',
               'Alexis','Thanasis','Vasilis','Christos','Manos','Giorgos','Lefteris',
               'Panos','Sotiris','Ilias','Fotis','Tasos','Michalis','Spyros','Antonis',
               'Haris','Leonidas','Nikolas','Angelos','Theo','Grigoris','Stelios']
const LAST = ['Papadakis','Georgiou','Ioannou','Vlachos','Nikolaou','Dimitriou','Petrou',
              'Antoniou','Christou','Stavrou','Markou','Lambrou','Savvas','Economou','Rizos']
const POSITIONS = ['Goalkeeper','Defender','Defender','Defender','Midfielder','Midfielder',
                   'Midfielder','Attacker','Attacker']
const OPPONENTS = ['Olympiacos Academy','AEK Youth','Panathinaikos U','Aris Juniors',
                   'PAOK Academy','Atromitos Youth']
const COACH_NOTES = [
  'First touch under pressure — take it away from the defender, not into them.',
  'Positioning at defensive set pieces. Know your man before the ball moves.',
  'Head up earlier when receiving. The pass was on twice in the second half.',
  'Recovery runs after losing the ball. You stopped twice this week.',
]

const AWARD_NOTES = [
  'Tracked back all game without being asked.',
  'Kept their head after a bad call went against them.',
  'Best week of training this month.',
  'Talked the back four through the whole second half.',
]

const SQUADS = [
  { coachEmail: `coach.u15@${DOMAIN}`, coachName: 'Alex Marinos',  team: 'U15s', ageGroup: 'U15', size: 16 },
  { coachEmail: `coach.u17@${DOMAIN}`, coachName: 'Dora Fotiadi',  team: 'U17s', ageGroup: 'U17', size: 14 },
]
const EXTRA_COACH = { email: `coach.gk@${DOMAIN}`, name: 'Marcos Tselios', team: 'U15s', role: 'Goalkeeping Coach' }

/* ── preflight ───────────────────────────────────────────────────────────── */

async function preflight() {
  heading('Checking the pilot migrations are applied')
  const { error: mErr } = await supabase.from('matches').select('match_date').limit(1)
  if (mErr && /match_date/.test(mErr.message)) {
    console.error('\n  matches.match_date is missing.')
    console.error('  Apply 20260901000002_pilot_measurement_columns.sql first.\n')
    return false
  }
  log('matches.match_date present')

  // telemetry_events is insert-only, so a select returns zero rows when the
  // table exists and an error mentioning the relation when it does not.
  const { error: tErr } = await supabase.from('telemetry_events').select('id').limit(1)
  if (tErr && /does not exist|schema cache/i.test(tErr.message)) {
    console.error('\n  telemetry_events is missing.')
    console.error('  Apply 20260901000001_pilot_telemetry.sql first.\n')
    return false
  }
  log('telemetry_events present')
  return true
}

/* ── purge ───────────────────────────────────────────────────────────────── */

async function purge() {
  console.log(`\nPurging the rehearsal academy.\n`)
  const admin = await signInOrUp(`director@${DOMAIN}`)
  if (!admin) { console.error('Could not sign in as the rehearsal director.'); return }

  const { data: org } = await supabase
    .from('organizations').select('id').eq('admin_user_id', admin.id).maybeSingle()

  for (const s of SQUADS) {
    const coach = await signInOrUp(s.coachEmail)
    if (!coach) continue
    await supabase.from('coach_calendar_events').delete().eq('coach_user_id', coach.id)
    await supabase.from('recognition_awards').delete().eq('coach_user_id', coach.id)
    await supabase.from('squad_players').delete().eq('coach_user_id', coach.id)
    log(`cleared ${s.coachName}'s squad, fixtures and awards`)
  }

  if (org) {
    await signInOrUp(`director@${DOMAIN}`)
    await supabase.from('organizations').delete().eq('id', org.id)
    log('removed the organisation')
  }

  console.log('\nDone. Auth users remain — delete them from the Supabase dashboard')
  console.log(`if you want the ${DOMAIN} accounts gone entirely.\n`)
}

/* ── seed ────────────────────────────────────────────────────────────────── */

async function seed() {
  console.log(`\n=== Rehearsal academy: ${ORG_NAME} ===`)
  console.log(`All accounts use the password: ${PW}\n`)

  if (!(await preflight())) return

  const created = { squadRows: 0, linked: 0, unlinked: 0, fixtures: 0, sessions: 0, notes: 0,
                    matches: 0, assessments: 0, awards: 0, parents: 0, consents: 0, sharedFeedback: 0 }

  /* --- director + organisation ------------------------------------------ */
  heading('Director and organisation')
  const director = await signInOrUp(`director@${DOMAIN}`)
  if (!director) return

  await provision({
    role: 'club',
    full_name: 'Eleni Sarri',
    club_details: { academy_name: ORG_NAME },
  })

  const { data: org } = await supabase
    .from('organizations').select('id, name, join_code')
    .eq('admin_user_id', director.id).maybeSingle()
  if (!org) { console.error('  organisation was not created — stopping.'); return }
  log(`${org.name} — academy join code ${org.join_code}`)

  let nameIdx = 0

  for (const squad of SQUADS) {
    heading(`Coach ${squad.coachName} — ${squad.team}`)
    const coach = await signInOrUp(squad.coachEmail)
    if (!coach) continue

    await provision({
      role: 'coach',
      full_name: squad.coachName,
      coach_details: { team: squad.team, coach_role: 'Head Coach', academy_code: org.join_code },
    })

    const coachProfile = await myProfile(coach.id)
    const coachCode = coachProfile?.invite_code
    if (!coachCode) { log('coach has no invite code — skipping squad'); continue }
    log(`coach code TRK-${coachCode}`)

    /* Players. Half sign up for themselves through the real signup path, which
       creates their squad row; the rest stay as roster entries the coach typed
       and nobody has claimed. That gap is what makes activation measurable. */
    const names = []
    for (let i = 0; i < squad.size; i++) {
      names.push({ i, name: `${pick(FIRST, nameIdx)} ${pick(LAST, nameIdx + i)}` })
      nameIdx++
    }

    // Names already on this coach's roster. Without this the unlinked rows are
    // re-inserted on every run, because squad_players has no natural key and
    // nothing stops a coach holding two players with the same name.
    const { data: priorRoster } = await supabase
      .from('squad_players').select('player_name').eq('coach_user_id', coach.id)
    const alreadyOnRoster = new Set((priorRoster ?? []).map(r => r.player_name))

    for (const { i, name } of names) {
      if (i % 2 === 0) {
        const slug = name.toLowerCase().replace(/[^a-z]+/g, '.')
        // link_player_to_coach is itself idempotent, so re-running is safe.
        const playerUser = await signInOrUp(`${slug}@${DOMAIN}`)
        if (!playerUser) continue
        await provision({
          role: 'player',
          full_name: name,
          player_details: {
            position: pick(POSITIONS, i),
            shirt_number: String(i + 1),
            age_group: squad.ageGroup,
            date_of_birth: `${2026 - (squad.ageGroup === 'U15' ? 15 : 17)}-05-12`,
          },
          coach_invite_code: coachCode,
        })
        created.linked++
      } else {
        if (alreadyOnRoster.has(name)) continue
        await signInOrUp(squad.coachEmail)
        // squad_players has no organization_id — org scoping is derived through
        // the coach. Errors are logged, never swallowed: a silent failure here
        // is what made the first seeding run look like it had worked.
        const { error } = await supabase.from('squad_players').insert({
          coach_user_id: coach.id,
          player_name: name,
          position: pick(POSITIONS, i),
          shirt_number: i + 1,
          age_group: squad.ageGroup,
          status: 'active',
        })
        if (error) log(`roster row "${name}": ${error.message}`)
        else created.unlinked++
      }
    }

    /* everything below is the coach's own data */
    await signInOrUp(squad.coachEmail)
    const { data: roster } = await supabase
      .from('squad_players').select('id, player_name, position, linked_player_id')
      .eq('coach_user_id', coach.id)
    created.squadRows += roster?.length ?? 0
    log(`roster: ${roster?.length ?? 0} rows (${created.linked} claimed, ${created.unlinked} awaiting signup)`)

    /* fixtures — the denominator for match coverage */
    const fixtureDays = [41, 34, 27, 20, 13, 6]
    const { data: haveFix } = await supabase
      .from('coach_calendar_events').select('id').eq('coach_user_id', coach.id).limit(1)
    if (!haveFix?.length) {
      for (let i = 0; i < fixtureDays.length; i++) {
        const { error } = await supabase.from('coach_calendar_events').insert({
          coach_user_id: coach.id,
          title: `vs ${pick(OPPONENTS, i)}`,
          event_type: 'match',
          starts_at: isoDaysAgo(fixtureDays[i]),
          venue: i % 2 === 0 ? 'Home' : 'Away',
          opponent: pick(OPPONENTS, i),
          published: true,
          source: 'manual',
        })
        if (error) log(`fixture ${i + 1}: ${error.message}`)
        else created.fixtures++
      }
    }
    log(`fixtures: ${created.fixtures}`)

    /* coach_sessions — what the assessment screen's session dropdown reads.
       Fixtures live in coach_calendar_events and are a different thing: the
       calendar is the plan, a session is the thing that happened. Without
       these the dropdown is empty and a coach's first assessment looks
       blocked, even though the field is optional. */
    const { data: haveSessions } = await supabase
      .from('coach_sessions').select('id').eq('coach_user_id', coach.id).limit(1)
    if (!haveSessions?.length) {
      for (let i = 0; i < fixtureDays.length; i++) {
        const { error } = await supabase.from('coach_sessions').insert({
          coach_user_id: coach.id,
          session_type: 'match',
          title: `vs ${pick(OPPONENTS, i)}`,
          session_date: daysAgo(fixtureDays[i]),
          competition: 'League',
          venue: i % 2 === 0 ? 'Home' : 'Away',
        })
        if (error) log(`session ${i + 1}: ${error.message}`)
        else created.sessions++
      }
      // a couple of training sessions too, so the dropdown is not all matches
      for (let i = 0; i < 2; i++) {
        const { error } = await supabase.from('coach_sessions').insert({
          coach_user_id: coach.id,
          session_type: 'training',
          title: i === 0 ? 'Pressing shape' : 'Finishing under pressure',
          session_date: daysAgo(fixtureDays[i] + 3),
          training_type: 'Tactical',
          venue: 'Home',
        })
        if (!error) created.sessions++
      }
      log(`sessions: ${created.sessions}`)
    } else {
      log('sessions already present — reusing')
    }

    /* matches + assessments for the claimed players.
       Guarded: neither is naturally idempotent, and re-running the script used
       to stack a fresh set on top of the last, inflating the assessment rate
       the rehearsal is meant to demonstrate. */
    const claimed = (roster ?? []).filter(r => r.linked_player_id)
    const { count: existingAssessments } = await supabase
      .from('coach_assessments')
      .select('id', { count: 'exact', head: true })
      .eq('coach_user_id', coach.id)

    if (existingAssessments && existingAssessments > 0) {
      log(`matches and assessments already present (${existingAssessments}) — skipping`)
    } else
    for (let n = 0; n < claimed.length; n++) {
      const r = claimed[n]
      /* PlayerHome shows the feedback card only for the LATEST assessment
         (order('created_at', {ascending:false})), so a note has to land on
         the actual last one this player gets — not just the last fixture
         day, since the %6 and %4 skips below can remove the match or the
         assessment for any given f. Tarek measured that without this, the
         existing 1-in-3 note sampling put a note on the true latest
         assessment for only 2 of 15 seeded players. lastF is the highest f
         that survives both skips, i.e. the last f with a real assessment row. */
      const lastF = [...fixtureDays.keys()].filter(f => (n + f) % 6 && (n + f) % 4).at(-1)
      for (let f = 0; f < fixtureDays.length; f++) {
        /* one fixture in six goes unlogged, so coverage is not a flat 100% */
        if ((n + f) % 6 === 0) continue
        const rating = 4.5 + ((n * 7 + f * 3) % 45) / 10
        const { error } = await supabase.rpc('log_match_for_player', {
          p_user_id: r.linked_player_id,
          p_opponent: pick(OPPONENTS, f),
          p_team_score: (f + n) % 4,
          p_opponent_score: (f * 2 + n) % 3,
          p_competition: 'League',
          p_venue: f % 2 === 0 ? 'Home' : 'Away',
          p_position: r.position ?? 'Midfielder',
          p_age_group: squad.ageGroup,
          p_minutes_played: [90, 90, 75, 60, 90, 45][f % 6],
          p_goals: (n + f) % 5 === 0 ? 1 : 0,
          p_assists: (n + f) % 7 === 0 ? 1 : 0,
          p_card_received: (n + f) % 11 === 0 ? 'Yellow' : 'None',
          p_body_condition: 'Average',
          p_self_rating: 'Average',
          p_computed_rating: Math.round(rating * 10) / 10,
          p_match_date: daysAgo(fixtureDays[f]),
        })
        if (error) log(`match for ${r.player_name}: ${error.message}`)
        else created.matches++

        /* assessment inside the 48h window for most, missed for some */
        if ((n + f) % 4 === 0) continue
        const base = 4 + ((n * 3 + f * 2) % 6)
        const { data: aRow, error: aErr } = await supabase.from('coach_assessments').insert({
          coach_user_id: coach.id,
          squad_player_id: r.id,
          appearance: 'started',
          work_rate: Math.min(10, base + 1),
          tactical: base,
          attitude: Math.min(10, base + 2),
          technical: base,
          physical: Math.min(10, base + 1),
          coachability: Math.min(10, base + 2),
          flag: 'fair',
          organization_id: org.id,
          coach_name_snapshot: squad.coachName,
          created_at: isoDaysAgo(fixtureDays[f] - 1),
        }).select('id').maybeSingle()
        if (aErr) log(`assessment for ${r.player_name}: ${aErr.message}`)
        else {
          created.assessments++
          /* A written note on roughly every third assessment, plus always on
             the last one (f === lastF) so every player's latest assessment
             — the one PlayerHome actually shows — has a route into
             /player/feedback, not just whichever player the %3 sampling
             happens to hit. */
          if (((n + f) % 3 === 0 || f === lastF) && aRow?.id) {
            const { error: nErr } = await supabase.from('coach_assessment_notes').insert({
              assessment_id: aRow.id,
              coach_user_id: coach.id,
              note: pick(COACH_NOTES, n + f),
            })
            if (nErr) log(`note for ${r.player_name}: ${nErr.message}`)
            else created.notes++
          }
        }
      }
    }
    log(`matches: ${created.matches}, assessments: ${created.assessments}`)

    /* Latest-assessment notes, backfilled. The loop above is skipped once the
       coach has any assessment, so the lastF note only lands on a FRESH seed.
       The live rehearsal academy already had 78 assessments on 21 Sep with a
       note on the latest one for 0 of 28 players (read-only count), so without
       this the "player sees coach feedback" step shows nothing to anyone.
       PlayerHome shows feedback for the latest assessment only; give each
       claimed player's latest one a note if it has none. Runs on every pass,
       before publishing, so these notes are published below too. */
    for (let n = 0; n < claimed.length; n++) {
      const r = claimed[n]
      const { data: latest, error: latestErr } = await supabase
        .from('coach_assessments').select('id')
        .eq('coach_user_id', coach.id).eq('squad_player_id', r.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (latestErr) { log(`latest assessment for ${r.player_name}: ${latestErr.message}`); continue }
      if (!latest) continue
      const { data: hasNote, error: hasNoteErr } = await supabase
        .from('coach_assessment_notes').select('assessment_id').eq('assessment_id', latest.id).maybeSingle()
      if (hasNoteErr) { log(`note lookup for ${r.player_name}: ${hasNoteErr.message}`); continue }
      if (hasNote) continue
      const { error: nErr } = await supabase.from('coach_assessment_notes').insert({
        assessment_id: latest.id,
        coach_user_id: coach.id,
        note: pick(COACH_NOTES, n),
      })
      if (nErr) log(`latest note for ${r.player_name}: ${nErr.message}`)
      else created.notes++
    }

    /* Shared feedback. K9 (#44) made coach_assessment_notes coach-private, so
       the player and parent screens now read coach_shared_feedback. Publish
       one for every assessment that carries a note and has none yet, or the
       seeded history shows no feedback at all. Runs on every pass, not only
       when an assessment is created, so an academy seeded before K9 is
       backfilled too. The UNIQUE on assessment_id is the second guard. */
    const { data: noted, error: notedErr } = await supabase
      .from('coach_assessment_notes').select('assessment_id, note').eq('coach_user_id', coach.id)
    if (notedErr) log(`notes lookup: ${notedErr.message}`)
    const { data: shared, error: sharedErr } = await supabase
      .from('coach_shared_feedback').select('assessment_id').eq('coach_user_id', coach.id)
    if (sharedErr) log(`shared feedback lookup: ${sharedErr.message}`)
    const alreadyShared = new Set((shared ?? []).map(s => s.assessment_id))
    for (const row of noted ?? []) {
      if (alreadyShared.has(row.assessment_id)) continue
      const { error } = await supabase.from('coach_shared_feedback').insert({
        assessment_id: row.assessment_id,
        coach_user_id: coach.id,
        body: row.note,
        published_at: new Date().toISOString(),
      })
      if (error) log(`shared feedback: ${error.message}`)
      else created.sharedFeedback++
    }
    log(`shared feedback published this run: ${created.sharedFeedback}`)

    /* awards */
    const { data: haveAwards } = await supabase
      .from('recognition_awards').select('id').eq('coach_user_id', coach.id).limit(1)
    if (!haveAwards?.length && roster?.length) {
      for (let w = 0; w < 4; w++) {
        const target = roster[(w * 3) % roster.length]
        const { error } = await supabase.from('recognition_awards').insert({
          coach_user_id: coach.id,
          squad_player_id: target.id,
          award_type: 'player_of_the_week',
          awarded_for: pick(AWARD_NOTES, w),
          organization_id: org.id,
          coach_name_snapshot: squad.coachName,
          created_at: isoDaysAgo(w * 7 + 2),
        })
        if (error) log(`award ${w + 1}: ${error.message}`)
        else created.awards++
      }
    }

    /* parents — every claimed player gets one, and the parent grants consent.
       Every seeded player is U15/U17, so once consent_threshold_age() is 18
       (#80) a player with no consent row cannot be assessed: the "coach
       assesses a player" demo step would refuse on stage. The grant goes
       through the same RPC the parent screen calls, with the same wording. */
    for (const r of claimed) {
      const slug = r.player_name.toLowerCase().replace(/[^a-z]+/g, '.')
      const parentEmail = `parent.${slug}@${DOMAIN}`

      const playerAcct = await signInOrUp(`${slug}@${DOMAIN}`)
      if (!playerAcct) continue
      await supabase.rpc('create_parent_invite', { p_email: parentEmail })

      const parentUser = await signInOrUp(parentEmail)
      if (!parentUser) continue
      await provision({ role: 'parent', full_name: `Parent of ${r.player_name}` })
      created.parents++

      // Re-running must not stack a new consent on top of a standing one.
      const { data: standing, error: readErr } = await supabase
        .from('parental_consents').select('id')
        .eq('player_user_id', playerAcct.id).is('withdrawn_at', null).limit(1)
      if (readErr) { log(`consent check for ${r.player_name}: ${readErr.message}`); continue }
      if (standing?.length) continue

      const { error } = await supabase.rpc('record_parental_consent', {
        p_player_user_id: playerAcct.id,
        p_relationship: 'parent',
        p_purposes: { coaching_records: true, recognition: true, parent_visibility: true },
        p_notice_version: CONSENT_NOTICE_VERSION,
        p_consent_text: CONSENT_STATEMENT,
      })
      if (error) log(`consent for ${r.player_name}: ${error.message}`)
      else created.consents++
    }
    await signInOrUp(squad.coachEmail)
    log(`parents linked: ${created.parents}, consents granted this run: ${created.consents}`)
  }

  /* --- a specialist coach with no squad of their own -------------------- */
  heading(`Coach ${EXTRA_COACH.name} — specialist`)
  const gkCoach = await signInOrUp(EXTRA_COACH.email)
  if (gkCoach) {
    await provision({
      role: 'coach',
      full_name: EXTRA_COACH.name,
      coach_details: { team: EXTRA_COACH.team, coach_role: EXTRA_COACH.role, academy_code: org.join_code },
    })
    log('added — gives the club view a coach with no assessments, which is a real case')
  }

  console.log('\n=== Done ===')
  console.table(created)
  console.log(`
Sign in with any of these — password ${PW}

  Director   director@${DOMAIN}
  Coach      ${SQUADS[0].coachEmail}   (${SQUADS[0].team})
  Coach      ${SQUADS[1].coachEmail}   (${SQUADS[1].team})
  Players    <firstname>.<lastname>@${DOMAIN}
  Parents    parent.<firstname>.<lastname>@${DOMAIN}

  Academy join code   ${org.join_code}

Then confirm the scorecard in the reviewed project's authorized operator SQL
editor, or through a separate trusted server-side service-role connection:

  SELECT * FROM public.pilot_scorecard;

Application anon/authenticated credentials, including a club account, cannot
read operational reports. Do not put a service key in this script's client or
in VITE_* configuration. See docs/pilot-runbook.md for S3 verification.

telemetry_events stays EMPTY after this script — it is written by the app, not
by seeding. Metrics 4, 6 and 7 stay blank until you click through the smoke
test in a browser. If they are still blank afterwards, the instrumentation is
broken and the pilot cannot be measured.

Reset with:  node seed-pilot-rehearsal.mjs --purge
`)
}

/* ── main ────────────────────────────────────────────────────────────────── */

if (process.argv.includes('--purge')) {
  await purge()
} else {
  await seed()
}
