import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guards the fix from 20260614000001.
 *
 * Every write policy on coach- and club-owned tables used to read
 *   WITH CHECK (coach_user_id = auth.uid())
 * which asks "are you claiming to be yourself?" but never "are you a coach?".
 * Signed in as an ordinary player it was therefore possible to insert coach
 * assessments and recognition awards about oneself — data that feeds the band,
 * Evolution Card, passport, parent view and club dashboard.
 *
 * These are static checks over the migration files. They cannot prove the live
 * database is correct (that was verified by hand against Supabase), but they do
 * fail if someone reintroduces an ownership-only write policy on these tables.
 */

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

// TRAK-48 slice 4 (20260926170000) closed app-role inserts on squad_players:
// the operator's roster load is the only writer. A check over the INSERT
// policies must then prove the grant is revoked rather than pass vacuously,
// and still holds any INSERT policy a later migration adds.
function expectSquadInsertsClosedOrGuarded(inserts: unknown[]) {
  if (inserts.length > 0) return
  const revoked = readdirSync(MIGRATIONS).some(f =>
    readFileSync(join(MIGRATIONS, f), 'utf8').includes('REVOKE INSERT ON TABLE public.squad_players FROM PUBLIC, anon, authenticated'))
  expect(revoked, 'no squad_players INSERT policy is live, yet no migration revokes the INSERT grant').toBe(true)
}

/** Tables where a write must require the caller to hold a role, not just claim ownership. */
const ROLE_GUARDED: Record<string, string> = {
  coach_assessments: 'is_coach',
  recognition_awards: 'is_coach',
  squad_players: 'is_coach',
  coach_sessions: 'is_coach',
  coach_calendar_events: 'is_coach',
  organizations: 'is_club_admin',
}

interface Policy { name: string; table: string; op: string; body: string; file: string }

// A literal false WITH CHECK admits no new row on INSERT or UPDATE. It needs
// no role/ownership predicate. Keep checking every policy that can admit one;
// do not treat a broader expression such as (false OR true) as a denial.
// Actual privileges and overlapping policies are exercised by the SQL suite.
const deniesEveryWrite = (policy: Policy) =>
  /\bWITH\s+CHECK\s*\(\s*false\s*\)\s*$/i.test(policy.body)

function loadPolicies(): Policy[] {
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
  const created: Policy[] = []
  const dropped: { name: string; table: string; file: string }[] = []

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const dropRe = /DROP POLICY IF EXISTS\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)/gi
    for (let m; (m = dropRe.exec(sql)); ) {
      dropped.push({ name: m[1], table: m[2], file })
    }
    const createRe =
      /CREATE POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)\s+(?:AS\s+\w+\s+)?FOR\s+(INSERT|UPDATE|ALL|SELECT|DELETE)([\s\S]*?);/gi
    for (let m; (m = createRe.exec(sql)); ) {
      created.push({ name: m[1], table: m[2], op: m[3].toUpperCase(), body: m[4], file })
    }
  }

  // A policy is live if its newest CREATE is not followed by a later DROP.
  // A DROP in the same file counts as superseded, because migrations drop and
  // recreate a policy together to redefine it.
  return created.filter(p => {
    const lastCreate = created
      .filter(c => c.name === p.name && c.table === p.table)
      .map(c => c.file)
      .sort()
      .at(-1)!
    const lastDrop = dropped
      .filter(d => d.name === p.name && d.table === p.table)
      .map(d => d.file)
      .sort()
      .at(-1)
    return p.file === lastCreate && (!lastDrop || lastDrop <= lastCreate)
  })
}

describe('RLS write policies require a role, not just claimed ownership', () => {
  const live = loadPolicies()

  it('finds write policies to check', () => {
    expect(live.length).toBeGreaterThan(0)
  })

  for (const [table, guard] of Object.entries(ROLE_GUARDED)) {
    it(`${table}: every live INSERT/UPDATE policy denies writes or calls ${guard}()`, () => {
      const writes = live.filter(p => p.table === table && ['INSERT', 'UPDATE', 'ALL'].includes(p.op))
      expect(writes.length, `no write policy found for ${table} — did it get renamed?`).toBeGreaterThan(0)

      for (const p of writes) {
        expect(
          deniesEveryWrite(p) || p.body.includes(`${guard}()`),
          `Policy "${p.name}" on ${table} (${p.file}) permits a write without checking ${guard}(). ` +
            `An ownership-only check lets any authenticated user set the owner column to their own id.`,
        ).toBe(true)
      }
    })
  }

  it('get_profile_role is restricted to the caller', () => {
    // Must not be dropped: the "users can update own profile" policy relies on it
    // to pin role to its current value, which is what stops self-promotion.
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    let latest = ''
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const i = sql.indexOf('FUNCTION public.get_profile_role')
      if (i >= 0) latest = sql.slice(i, i + 600)
    }
    expect(latest, 'get_profile_role has been removed — profile role-change protection depends on it').not.toBe('')
    expect(
      latest.includes('auth.uid()'),
      'get_profile_role no longer restricts to the caller — it would leak any user’s role',
    ).toBe(true)
  })
})

/**
 * Guards K1 (X2) from 20260917000001.
 *
 * Checking the role is not the same as checking ownership. Before the fix,
 * coach_assessments.INSERT read
 *   (coach_user_id = auth.uid()) AND is_coach() AND NOT consent_required(...)
 * with nothing at all constraining squad_player_id, session_id or
 * organization_id. A coach in academy B could therefore write a permanent
 * assessment onto a child in academy A — permanent because DELETE is `false`
 * on that table — and stamp it with academy A's organization_id so it
 * surfaced on their dashboard.
 *
 * Static checks over the migration files, like the suite above. They cannot
 * prove the live database is correct; they fail if someone reintroduces a
 * write policy that references another table's row without proving ownership.
 */
describe('RLS writes prove ownership of the row they reference', () => {
  const live = loadPolicies()

  /** table -> helpers every live write policy on it must call */
  const REFERENCE_GUARDED: Record<string, string[]> = {
    coach_assessments: ['squad_player_is_mine'],
    recognition_awards: ['squad_player_is_mine'],
    session_attendance: ['coach_session_is_mine'],
    coach_assessment_notes: ['squad_player_is_mine'],
  }

  for (const [table, helpers] of Object.entries(REFERENCE_GUARDED)) {
    it(`${table}: every live INSERT/UPDATE policy denies writes or proves ownership`, () => {
      const writes = live.filter(p => p.table === table && ['INSERT', 'UPDATE', 'ALL'].includes(p.op))
      expect(writes.length, `no write policy found for ${table} — did it get renamed?`).toBeGreaterThan(0)

      for (const p of writes) {
        const called = deniesEveryWrite(p) || helpers.some(h => p.body.includes(`${h}(`))
        expect(
          called,
          `Policy "${p.name}" on ${table} (${p.file}) writes a row that references another ` +
            `table without calling one of ${helpers.join(', ')}. That lets a coach write against ` +
            `a player, session or academy that is not theirs.`,
        ).toBe(true)
      }
    })
  }

  it('assessments and awards cannot be stamped with an arbitrary academy', () => {
    const inserts = live.filter(
      p => ['coach_assessments', 'recognition_awards'].includes(p.table) && p.op === 'INSERT',
    )
    expect(inserts.length).toBeGreaterThan(0)
    for (const p of inserts) {
      expect(
        deniesEveryWrite(p) || p.body.includes('my_coach_organization_id()'),
        `Policy "${p.name}" on ${p.table} (${p.file}) does not pin organization_id to the writer's ` +
          `own academy. The BEFORE INSERT trigger only fills a NULL, so a supplied value survives ` +
          `and the row appears on another academy's dashboard.`,
      ).toBe(true)
    }
  })
})

/**
 * Guards K2 (X3) from 20260917000002.
 *
 * remove_coach_from_org() nulls the coach's organization_id and marks their
 * roster rows 'coach_departed', but every coach policy is keyed on
 * coach_user_id, which departure does not touch. A removed coach kept read
 * and write access to the academy's children, and could set status back to
 * 'active' to undo their own removal.
 */
describe('a departed coach keeps nothing', () => {
  const live = loadPolicies()

  it('squad_player_is_mine() excludes departed rows', () => {
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    let latest = ''
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const i = sql.indexOf('FUNCTION public.squad_player_is_mine')
      if (i >= 0) latest = sql.slice(i, i + 600)
    }
    expect(latest, 'squad_player_is_mine() is missing — the coach write policies depend on it').not.toBe('')
    expect(
      latest.includes('coach_departed'),
      'squad_player_is_mine() no longer excludes coach_departed rows, so a removed coach ' +
        'keeps write access to the academy’s children',
    ).toBe(true)
  })

  it('squad_players policies exclude departed rows, so removal cannot be undone', () => {
    // INSERT is covered separately: a row being created is never already
    // departed, so the invariant there is a different one.
    const own = live.filter(
      p =>
        p.table === 'squad_players' &&
        ['SELECT', 'UPDATE', 'DELETE', 'ALL'].includes(p.op) &&
        p.body.includes('coach_user_id = auth.uid()'),
    )
    expect(own.length, 'no coach-owned squad_players policy found — did it get renamed?').toBeGreaterThan(0)
    for (const p of own) {
      expect(
        p.body.includes('coach_departed'),
        `Policy "${p.name}" on squad_players (${p.file}) still grants a coach access by ownership ` +
          `alone. A removed coach can read the squad, and on UPDATE can set status back to 'active'.`,
      ).toBe(true)
    }
  })

  it('a roster row cannot be created already departed', () => {
    const inserts = live.filter(p => p.table === 'squad_players' && p.op === 'INSERT')
    expectSquadInsertsClosedOrGuarded(inserts)
    for (const p of inserts) {
      expect(
        p.body.includes('coach_departed'),
        `Policy "${p.name}" on squad_players (${p.file}) lets a coach insert a row that is already ` +
          `'coach_departed' — invisible to them, but still counted by the academy.`,
      ).toBe(true)
    }
  })

  it('coach reads of assessments and awards route through the roster row', () => {
    const reads = live.filter(
      p =>
        ['coach_assessments', 'recognition_awards'].includes(p.table) &&
        p.op === 'SELECT' &&
        p.body.includes('coach_user_id = auth.uid()'),
    )
    expect(reads.length).toBeGreaterThan(0)
    for (const p of reads) {
      expect(
        p.body.includes('squad_player_is_mine('),
        `Policy "${p.name}" on ${p.table} (${p.file}) lets a coach read by coach_user_id alone, ` +
          `so a departed coach keeps every record they wrote about that academy's children.`,
      ).toBe(true)
    }
  })

  it('a roster row with no academy can still acquire one', () => {
    // 20260917000002 pinned organization_id on every UPDATE, which also pinned
    // NULL: a row orphaned by ON DELETE SET NULL on the coach FK could never
    // gain an academy again, so a coach adopting it left the player invisible
    // to the academy. 20260917000003 pins only a real academy.
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    let latest = ''
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const i = sql.indexOf('FUNCTION public.set_squad_player_org_id')
      if (i >= 0) latest = sql.slice(i, i + 1600)
    }
    expect(latest, 'set_squad_player_org_id() is missing').not.toBe('')
    expect(
      latest.includes('OLD.organization_id IS NOT NULL'),
      'set_squad_player_org_id() pins organization_id on update without checking whether there ' +
        'is one. That pins NULL too, so an orphaned roster row can never join an academy and the ' +
        'player stays invisible to it.',
    ).toBe(true)
    expect(
      latest.includes('coach_details'),
      'set_squad_player_org_id() no longer derives the academy from the coach on the row',
    ).toBe(true)
  })

  it('F2: coach authority follows the academy on the row, not its status', () => {
    // remove_coach_from_org() converted only 'active', and the K2 gate was
    // status <> 'coach_departed', so a row the coach archived before leaving
    // survived removal and stayed writable. status is a value the departing
    // coach can set; the academy on the row is not.
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    let latest = ''
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const i = sql.indexOf('FUNCTION public.squad_player_is_mine')
      if (i >= 0) latest = sql.slice(i, i + 900)
    }
    expect(latest, 'squad_player_is_mine() is missing').not.toBe('')
    expect(
      latest.includes('my_coach_organization_id()'),
      'squad_player_is_mine() gates on status alone. A coach who archives a row before being ' +
        'removed keeps read and write access to that child afterwards (audit finding F2).',
    ).toBe(true)

    const own = live.filter(
      p =>
        p.table === 'squad_players' &&
        ['SELECT', 'UPDATE', 'DELETE'].includes(p.op) &&
        p.body.includes('coach_user_id = auth.uid()'),
    )
    expect(own.length).toBeGreaterThan(0)
    for (const p of own) {
      expect(
        p.body.includes('my_coach_organization_id()'),
        `Policy "${p.name}" on squad_players (${p.file}) gates on status alone, so a removed ` +
          `coach keeps access to any row that was not 'active' at the moment of removal.`,
      ).toBe(true)
    }
  })

  it('F3: direct roster inserts constrain the asserted player id', () => {
    // K1 checked that the referenced roster row belonged to the writer, but a
    // coach could create a new row carrying another academy's child's
    // linked_player_id — so the ownership check passed on a relationship the
    // coach invented. link_player_to_coach() always sets linked_player_id to
    // auth.uid(), so "only the caller may be linked" admits real INSERTs.
    // UPDATE must also allow a coach to edit an unchanged legitimate child
    // link. Requiring child ID = coach auth.uid() there rejects normal edits.
    // The self-link trigger denies retargeting; actual UPDATE denial AND
    // legitimate-edit regressions run in academy_access_security.sql in CI.
    const inserts = live.filter(p => p.table === 'squad_players' && p.op === 'INSERT')
    expectSquadInsertsClosedOrGuarded(inserts)
    for (const p of inserts) {
      expect(
        p.body.includes('linked_player_id'),
        `Policy "${p.name}" on squad_players (${p.file}) does not constrain linked_player_id, so a ` +
          `coach can attach any child to their squad by user id and then write about them (F3).`,
      ).toBe(true)
    }

    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    const guarded = files.some(f =>
      readFileSync(join(MIGRATIONS, f), 'utf8').includes('FUNCTION public.enforce_self_linked_player'),
    )
    expect(
      guarded,
      'No trigger enforces self-linking. RLS alone is not enough: link_player_to_coach() is ' +
        'SECURITY DEFINER, so policies do not apply on that path.',
    ).toBe(true)
  })

  it('F5: the match RPC checks departure, not just ownership', () => {
    // log_match_for_player() is SECURITY DEFINER, so RLS does not apply inside
    // it — K1's write policies and K2's departure gate are both invisible on
    // this path. It authorised on ownership alone, so a removed coach could
    // still log matches for that academy's children.
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    let latest = ''
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const i = sql.indexOf('FUNCTION public.log_match_for_player')
      if (i >= 0) latest = sql.slice(i, i + 3000)
    }
    expect(latest, 'log_match_for_player() is missing').not.toBe('')
    expect(
      latest.includes('squad_player_is_mine('),
      'log_match_for_player() authorises on ownership alone. A coach removed from the academy, ' +
        'or transferred away from it, can still log matches for its children (audit finding F5). ' +
        'RLS cannot cover this: the function is SECURITY DEFINER.',
    ).toBe(true)
    expect(
      latest.includes('is_coach()'),
      'log_match_for_player() stamps logged_by_role = \'coach\' without checking the role.',
    ).toBe(true)
  })

  it('F4: attendance reads and deletes follow the roster, not just the session', () => {
    // K1 rewrote session_attendance INSERT and UPDATE to prove ownership of the
    // roster row and left SELECT and DELETE checking the session alone, so a
    // departed coach kept reading and deleting former players' attendance.
    // Coach policies are the ones routed through the session; the player's
    // own-attendance policy is keyed on linked_player_id and is not in scope.
    const attendance = live.filter(
      p =>
        p.table === 'session_attendance' &&
        ['SELECT', 'DELETE', 'ALL'].includes(p.op) &&
        p.body.includes('coach_session'),
    )
    expect(attendance.length, 'no coach attendance read/delete policy found').toBeGreaterThan(0)
    for (const p of attendance) {
      expect(
        p.body.includes('squad_player_is_mine('),
        `Policy "${p.name}" on session_attendance (${p.file}) checks session ownership only, so a ` +
          `coach who has left the academy keeps reading and deleting its children's attendance (F4).`,
      ).toBe(true)
    }
  })

  it('K9: no live policy lets a player read a coach note', () => {
    // April made coach_assessment_notes coach-only; May added an unconditional
    // player SELECT and nobody noticed, because the table has no publication
    // concept that would have made the policy look wrong. 8 notes existed live,
    // 4 readable by a linked player.
    const playerReads = live.filter(
      p =>
        p.table === 'coach_assessment_notes' &&
        ['SELECT', 'ALL'].includes(p.op) &&
        p.body.includes('linked_player_id'),
    )
    expect(
      playerReads.map(p => `${p.name} (${p.file})`),
      'a policy on coach_assessment_notes still resolves to a player. Private coach notes are ' +
        'not publishable in place — shared feedback belongs in coach_shared_feedback.',
    ).toEqual([])
  })

  it('K9: a player only reads shared feedback that was explicitly published', () => {
    const playerReads = live.filter(
      p =>
        p.table === 'coach_shared_feedback' &&
        ['SELECT', 'ALL'].includes(p.op) &&
        p.body.includes('linked_player_id'),
    )
    expect(playerReads.length, 'no player read policy on coach_shared_feedback').toBeGreaterThan(0)
    for (const p of playerReads) {
      expect(
        p.body.includes('published_at IS NOT NULL'),
        `Policy "${p.name}" (${p.file}) lets a player read shared feedback without checking ` +
          `published_at, so a coach's unpublished draft is visible to the child it is about.`,
      ).toBe(true)
    }
  })

  it('K9: writing shared feedback needs the coach role and a current roster row', () => {
    const writes = live.filter(
      p => p.table === 'coach_shared_feedback' && ['INSERT', 'UPDATE', 'ALL'].includes(p.op),
    )
    expect(writes.length, 'no write policy on coach_shared_feedback').toBeGreaterThan(0)
    for (const p of writes) {
      expect(
        p.body.includes('is_coach()'),
        `Policy "${p.name}" (${p.file}) does not require the coach role.`,
      ).toBe(true)
      expect(
        p.body.includes('squad_player_is_mine('),
        `Policy "${p.name}" (${p.file}) does not route through squad_player_is_mine(), so a ` +
          `departed or transferred coach can still publish feedback to a former player.`,
      ).toBe(true)
    }
  })

  it('K9: no migration copies a private note into shared feedback', () => {
    // "No auto-copy" is the part that cannot be expressed as a policy. If some
    // future migration backfills coach_shared_feedback.body from
    // coach_assessment_notes.note, every private note ever written becomes
    // publishable in bulk and the separation stops meaning anything.
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    const offenders = files.filter(f => {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const writesFeedback = /INSERT\s+INTO\s+(?:public\.)?coach_shared_feedback|UPDATE\s+(?:public\.)?coach_shared_feedback/i
      return writesFeedback.test(sql) && /coach_assessment_notes/i.test(sql)
    })
    expect(
      offenders,
      'a migration writes coach_shared_feedback while referencing coach_assessment_notes. ' +
        'Shared feedback is written by a coach for a child to read; it is never derived from ' +
        'the private note.',
    ).toEqual([])
  })

  it('K7: the academy read policy resolves the COACH org, not the club admin org', () => {
    // squad_player_in_my_org(uuid) sounds like a coach helper and is not: it
    // resolves my_organization_id(), which is organizations.admin_user_id =
    // auth.uid() — the club admin. Using it in a coach policy silently grants
    // nothing, because it returns NULL for every coach.
    const academy = live.filter(
      p => p.table === 'coach_assessments' && ['SELECT', 'ALL'].includes(p.op) &&
           /my_coach_org|squad_player_in_my_coach_org/.test(p.body),
    )
    expect(academy.length, 'no academy-scoped read policy on coach_assessments').toBeGreaterThan(0)
    for (const p of academy) {
      expect(
        /squad_player_in_my_org\s*\(/.test(p.body),
        `Policy "${p.name}" (${p.file}) uses squad_player_in_my_org(), which resolves the CLUB ` +
          `ADMIN's organisation and is NULL for a coach. Use squad_player_in_my_coach_org().`,
      ).toBe(false)
      expect(
        p.body.includes('is_coach()'),
        `Policy "${p.name}" (${p.file}) does not require the coach role.`,
      ).toBe(true)
    }
  })

  it('K7: widening assessment reads does not widen the private note', () => {
    // A colleague seeing a band must not become a colleague reading what the
    // assessing coach wrote to themselves. K9 made notes coach-private and K7
    // must not quietly undo it.
    const notes = live.filter(
      p => p.table === 'coach_assessment_notes' && ['SELECT', 'ALL'].includes(p.op),
    )
    for (const p of notes) {
      expect(
        /my_coach_org|organization_id/.test(p.body),
        `Policy "${p.name}" (${p.file}) makes coach notes academy-visible. Notes are private to ` +
          `the coach who wrote them; only coach_shared_feedback is shareable.`,
      ).toBe(false)
    }
  })

  it("a roster row's academy comes from the row, not from its coach's current club", () => {
    const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()
    let latest = ''
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
      const i = sql.indexOf('FUNCTION public.squad_player_in_my_org')
      if (i >= 0) latest = sql.slice(i, i + 600)
    }
    expect(latest, 'squad_player_in_my_org() is missing').not.toBe('')
    expect(
      latest.includes('coach_in_my_org'),
      'squad_player_in_my_org() resolves the academy through the coach again. Moving a coach ' +
        'from academy A to academy B then hands B every roster row A’s coach still owns.',
    ).toBe(false)
  })
})
