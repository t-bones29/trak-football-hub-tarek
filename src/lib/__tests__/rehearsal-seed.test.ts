import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

interface SeedResult {
  exitCode: number
  done: boolean
  disclosedPassword: boolean
  consentDenied: number
  after: Record<string, number>
  final: Record<string, number>
  recovered: Record<string, number>
  thirdRun: { exitCode: number } | null
  rerun: { exitCode: number } | null
  targetAssessmentCount: number | null
  targetFeedback: boolean
  draftPreserved: boolean
  unrelatedDraftPreserved: boolean
  unrelatedPublished: number
  unrelatedNotePreserved: boolean
  signupAttempts: number
  playerAccounts: number
  foreignWrites: { consents: number; matches: number; assessments: number } | null
}
function run(scenario: string): SeedResult {
  return JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', 'scripts/testing/rehearsal-seed-fixture.mjs', scenario], {
    encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
  })) as SeedResult
}

describe('actual rehearsal seed CLI with synthetic authenticated Supabase responses', () => {
  it('grants consent before development writes and completes the intended 30-row, 15-family academy', () => {
    const result = run('fresh')
    expect(result.exitCode).toBe(0)
    expect(result.consentDenied).toBe(0)
    expect(result.playerAccounts).toBe(15)
    expect(result.after.squad_players).toBe(30)
    expect(result.after.player_parent_links).toBe(15)
    expect(result.after.parental_consents).toBe(15)
    expect(result.after.matches).toBe(75)
    expect(result.after.coach_assessments).toBeGreaterThanOrEqual(45)
    expect(result.disclosedPassword).toBe(false)
    expect(result.rerun?.exitCode).toBe(0)
    expect(result.final).toEqual(result.after)
  })
  it('repairs missing player history even when the coach already has assessments, then reruns without duplicates', () => {
    const result = run('partial-rerun')
    expect(result.exitCode).toBe(0)
    expect(result.targetAssessmentCount).toBeGreaterThanOrEqual(3)
    expect(result.targetFeedback).toBe(true)
    expect(result.rerun?.exitCode).toBe(0)
    expect(result.final).toEqual(result.after)
  })
  it('resumes after a match succeeds and its assessment fails, without duplicating that match', () => {
    const result = run('interrupted')
    expect(result.exitCode).toBe(1)
    expect(result.done).toBe(false)
    expect(result.after.matches).toBe(1)
    expect(result.rerun?.exitCode).toBe(0)
    expect(result.recovered.matches).toBe(75)
    expect(result.thirdRun?.exitCode).toBe(0)
    expect(result.final).toEqual(result.recovered)
  })
  it('preserves unrelated roster rows while completing its required fixtures', () => {
    const result = run('extra-roster')
    expect(result.exitCode).toBe(0)
    expect(result.after.squad_players).toBe(31)
    expect(result.final).toEqual(result.after)
  })
  it('stops when an intended roster identity is duplicated instead of deleting or merging it', () => {
    const result = run('duplicate-roster')
    expect(result.exitCode).toBe(1)
    expect(result.done).toBe(false)
    expect(result.after.squad_players).toBe(31)
  })
  it('preserves a legacy linked player in an intended unclaimed slot and prepares their synthetic family too', () => {
    const result = run('legacy-linked')
    expect(result.exitCode).toBe(0)
    expect(result.playerAccounts).toBe(16)
    expect(result.after.player_parent_links).toBe(16)
    expect(result.after.parental_consents).toBe(16)
    expect(result.after.matches).toBe(80)
    expect(result.rerun?.exitCode).toBe(0)
    expect(result.final).toEqual(result.after)
  })
  // The line the readiness doc draws: the seed fabricates consent and history
  // only for synthetic children. A real account on a rehearsal roster (a real
  // child who joined with the TRK code) must stop the run before any write.
  it('stops without writing anything into a real account linked to a rehearsal roster slot', () => {
    const result = run('foreign-linked')
    expect(result.exitCode).toBe(1)
    expect(result.done).toBe(false)
    expect(result.foreignWrites).toEqual({ consents: 0, matches: 0, assessments: 0 })
  })
  it('rejects limited standing consent without overwriting the guardian choices', () => {
    const result = run('limited-consent')
    expect(result.exitCode).toBe(1)
    expect(result.done).toBe(false)
    expect(result.after.parental_consents).toBe(15)
  })
  it('rejects ambiguous fixture histories without inventing a date anchor', () => {
    const result = run('ambiguous-fixtures')
    expect(result.exitCode).toBe(1)
    expect(result.done).toBe(false)
    expect(result.after.coach_calendar_events).toBe(13)
  })
  it('rejects an assessment insert that returns no row despite having no error', () => {
    const result = run('missing-row')
    expect(result.exitCode).toBe(1)
    expect(result.done).toBe(false)
  })
  it('redacts the configured password from a backend failure diagnostic', () => {
    const result = run('secret-error')
    expect(result.exitCode).toBe(1)
    expect(result.disclosedPassword).toBe(false)
  })
  it('retains #92 latest-note and published-feedback backfill on existing history', () => {
    const result = run('backfill')
    expect(result.exitCode).toBe(0)
    expect(result.targetFeedback).toBe(true)
    expect(result.rerun?.exitCode).toBe(0)
    expect(result.final).toEqual(result.after)
  })
  it('refuses to count a canonical draft as published feedback and leaves its content intact', () => {
    const result = run('draft-feedback')
    expect(result.exitCode).toBe(1)
    expect(result.done).toBe(false)
    expect(result.targetFeedback).toBe(false)
    expect(result.draftPreserved).toBe(true)
  })
  it('does not publish private notes on unrelated roster rows owned by the same coach', () => {
    const result = run('unrelated-notes')
    expect(result.exitCode).toBe(0)
    expect(result.unrelatedPublished).toBe(0)
    expect(result.unrelatedNotePreserved).toBe(true)
    expect(result.unrelatedDraftPreserved).toBe(true)
    expect(result.rerun?.exitCode).toBe(0)
    expect(result.final).toEqual(result.after)
  })
  it('stops with nonzero status when signup remains rate limited', () => {
    const result = run('signup-failure')
    expect(result.exitCode).toBe(1)
    expect(result.done).toBe(false)
    expect(result.signupAttempts).toBeLessThanOrEqual(4)
    expect(result.disclosedPassword).toBe(false)
  })
  it('retries transient signup throttling without losing a required player', () => {
    const result = run('signup-retry')
    expect(result.exitCode).toBe(0)
    expect(result.signupAttempts).toBe(3)
    expect(result.playerAccounts).toBe(15)
    expect(result.after.squad_players).toBe(30)
  })
  it('does not interpret a failed roster read as a missing roster or report success', () => {
    const result = run('read-failure')
    expect(result.exitCode).toBe(1)
    expect(result.done).toBe(false)
  })
})
