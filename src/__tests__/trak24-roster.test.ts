import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
// @ts-expect-error: plain .mjs script, no types
import { rows, toCsv, COACHES, insideRepo, SYNTHETIC_DOMAIN, isSyntheticDomain } from '../../scripts/rehearsal/make-roster.mjs'
import { parseCsv } from '../../scripts/load-roster.mjs'

const REPO_ROOT = resolve(__dirname, '../..')
const TODAY = new Date('2026-09-27T00:00:00Z')
const PILOT_END = new Date('2026-11-29T00:00:00Z')
const ageOn = (dob: string, day: Date) => {
  const b = new Date(`${dob}T00:00:00Z`)
  let a = day.getUTCFullYear() - b.getUTCFullYear()
  if (day.getUTCMonth() < b.getUTCMonth() || (day.getUTCMonth() === b.getUTCMonth() && day.getUTCDate() < b.getUTCDate())) a--
  return a
}

describe('TRAK-24 rehearsal roster', () => {
  const list = rows('tester@example.com', TODAY)

  it('has 25 children: 3 phone children at the tester inbox, 22 at the synthetic domain', () => {
    expect(list).toHaveLength(25)
    expect(list.filter((r: { child_email: string }) => r.child_email.endsWith('@example.com'))).toHaveLength(3)
    expect(list.filter((r: { child_email: string }) => r.child_email.endsWith(`@${SYNTHETIC_DOMAIN}`))).toHaveLength(22)
  })

  // TRAK-89: trak.dev belongs to someone else. A synthetic address must be on
  // a domain nobody can register or receive mail at, and one J7's
  // pilot_synthetic_user_ids() already counts as synthetic (it matches %.test).
  it('puts no address on trak.dev, and uses a reserved .test domain J7 treats as synthetic', () => {
    expect(SYNTHETIC_DOMAIN).toBe('rehearsal.trak.test')
    expect(isSyntheticDomain(SYNTHETIC_DOMAIN)).toBe(true)
    const addresses = list.flatMap((r: Record<string, string>) => [r.child_email, r.guardian_emails, r.coach_email])
    expect(addresses.filter((a: string) => /trak\.dev$/i.test(a))).toEqual([])
    expect(Object.values(COACHES).every(c => (c as string).endsWith(`@${SYNTHETIC_DOMAIN}`))).toBe(true)
  })

  it('accepts only domains J7 would count as synthetic, so a rehearsal never pollutes the pilot numbers', () => {
    for (const ok of ['rehearsal.trak.test', 'x.example', 'example.org', 'a.invalid']) expect(isSyntheticDomain(ok), ok).toBe(true)
    for (const bad of ['rehearsal.trakfootball.com', 'gmail.com', 'rehearsal.trak.dev', 'test', 'evil.test.com']) expect(isSyntheticDomain(bad), bad).toBe(false)
    const other = rows('tester@example.com', TODAY, 'squad.example')
    expect(other.filter((r: { child_email: string }) => r.child_email.endsWith('@squad.example'))).toHaveLength(22)
    expect(() => rows('tester@example.com', TODAY, 'rehearsal.trakfootball.com')).toThrow(/synthetic/)
  })

  // Only the 3 phone families should ever get invitations (load-roster's
  // --send-invites applies to every row in a file); the 22 synthetic
  // guardians are undeliverable. --phone-out splits them into their own file.
  it('writes the 3 phone families and the 22 synthetic children to separate files with --phone-out', () => {
    const dir = resolve(REPO_ROOT, '..')
    const all = resolve(dir, `trak24-split-all-${process.pid}.csv`)
    const phone = resolve(dir, `trak24-split-phone-${process.pid}.csv`)
    try {
      const run = spawnSync(process.execPath, ['scripts/rehearsal/make-roster.mjs', '--inbox', 'tester@example.com',
        '--out', all, '--phone-out', phone], { cwd: REPO_ROOT, encoding: 'utf8' })
      expect(run.status, run.stderr).toBe(0)
      // parseCsv returns the header row first; child_email is column 3.
      const synth = parseCsv(readFileSync(all, 'utf8')).slice(1)
      const phones = parseCsv(readFileSync(phone, 'utf8')).slice(1)
      expect(phones.map((r: string[]) => r[3])).toEqual(
        ['tester+sib1@example.com', 'tester+sib2@example.com', 'tester+withheld@example.com'])
      expect(synth).toHaveLength(22)
      expect(synth.every((r: string[]) => r[3].endsWith(`@${SYNTHETIC_DOMAIN}`))).toBe(true)
    } finally { rmSync(all, { force: true }); rmSync(phone, { force: true }) }
  })

  it('refuses a --phone-out inside the repository too, and writes nothing', () => {
    const outside = resolve(REPO_ROOT, '..', `trak24-split-ok-${process.pid}.csv`)
    const run = spawnSync(process.execPath, ['rehearsal/make-roster.mjs', '--inbox', 'tester@example.com',
      '--out', outside, '--phone-out', '../leak-phone.csv'], { cwd: resolve(REPO_ROOT, 'scripts'), encoding: 'utf8' })
    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/outside the repository/)
    expect(existsSync(resolve(REPO_ROOT, 'leak-phone.csv'))).toBe(false)
    expect(existsSync(outside)).toBe(false)
  })

  it('can be imported without a script path (node -e, a REPL) without crashing', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const m = await import(${JSON.stringify(resolve(REPO_ROOT, 'scripts/rehearsal/make-roster.mjs'))}); console.log(m.rows('t@example.com').length)`],
      { encoding: 'utf8' })
    expect(run.stderr).toBe('')
    expect(run.stdout.trim()).toBe('25')
  })

  it('keeps every child under 18 and over 12 for the whole pilot, so every one needs consent', () => {
    for (const r of list) {
      expect(ageOn(r.date_of_birth, TODAY), r.child_name).toBeGreaterThanOrEqual(13)
      expect(ageOn(r.date_of_birth, PILOT_END), r.child_name).toBeLessThan(18)
    }
  })

  it('gives the two siblings one guardian, and the withheld child a different one', () => {
    const [sib1, sib2, withheld] = list
    expect(sib1.guardian_emails).toBe(sib2.guardian_emails)
    expect(withheld.guardian_emails).not.toBe(sib1.guardian_emails)
    expect(new Set(list.map((r: { child_email: string }) => r.child_email)).size).toBe(25)
  })

  it('assigns each age group to its rehearsal coach', () => {
    for (const r of list) expect(r.coach_email).toBe(COACHES[r.age_group as 'U15' | 'U17'])
  })

  it('writes a CSV the loader parses back to the same 25 rows', () => {
    const parsed = parseCsv(toCsv(list))
    expect(parsed[0]).toEqual(['child_name', 'date_of_birth', 'age_group', 'child_email', 'guardian_emails', 'coach_email'])
    expect(parsed).toHaveLength(26)
  })

  it('refuses an inbox that already carries a +tag', () => {
    expect(() => rows('tester+x@example.com', TODAY)).toThrow(/plain address/)
  })

  // Kostas's #169 review: the guard compared against the folder the script
  // was run from, so `cd scripts && … --out ../x.csv` wrote real inboxes into
  // the public repository.
  it('treats any path under the repository root as inside, wherever it is run from', () => {
    expect(insideRepo(resolve(REPO_ROOT, 'x.csv'), REPO_ROOT)).toBe(true)
    expect(insideRepo(resolve(REPO_ROOT, 'scripts', '..', 'x.csv'), REPO_ROOT)).toBe(true)
    expect(insideRepo(resolve(REPO_ROOT, '..data', 'x.csv'), REPO_ROOT)).toBe(true)
    expect(insideRepo(resolve(REPO_ROOT, '..', 'outside.csv'), REPO_ROOT)).toBe(false)
  })

  it('refuses --out ../x.csv when run from scripts/, and writes nothing', () => {
    const target = resolve(REPO_ROOT, 'leak-test.csv')
    rmSync(target, { force: true })
    const run = spawnSync(process.execPath, ['rehearsal/make-roster.mjs', '--inbox', 'tester@example.com', '--out', '../leak-test.csv'],
      { cwd: resolve(REPO_ROOT, 'scripts'), encoding: 'utf8' })
    const leaked = existsSync(target)
    rmSync(target, { force: true })
    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/outside the repository/)
    expect(leaked).toBe(false)
  })
})
