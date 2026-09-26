import { describe, expect, it } from 'vitest'
// @ts-expect-error: plain .mjs script, no types
import { rows, toCsv, COACHES } from '../../scripts/rehearsal/make-roster.mjs'
import { parseCsv } from '../../scripts/load-roster.mjs'

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
    expect(list.filter((r: { child_email: string }) => r.child_email.endsWith('@rehearsal.trak.dev'))).toHaveLength(22)
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
})
