import { formProblem, formToRow, type EventForm, type EventRow } from './coach-events'
import { displayEventTime } from './event-time'
import { fixtureKey, type Fixture } from './fixtures-csv'

/**
 * League fixtures from a CSV onto the coach's schedule (J8.6, TRAK-129).
 *
 * Each fixture goes through the same form and row mapping as an event the
 * coach types (J8.4's formToRow), so an imported match and a typed one are the
 * same row. Imports are drafts (Imad's publish step, 9 Oct) and are saved in
 * one insert, so an import lands whole or not at all.
 */

/**
 * TRAK-162: parked by the founders in the J8 live run (11 Oct). The import
 * reads only its own template's columns, and we don't yet know how UAE
 * leagues send fixtures, so coaches aren't offered it. Everything stays built
 * and tested; set this to true when the feature comes back.
 */
export const FIXTURE_IMPORT_ENABLED = false

export function fixtureToForm(fixture: Fixture): EventForm {
  return {
    kind: fixture.kind,
    // TRAK-635: a training needs a title and a CSV row has none, so it is named as it always showed.
    title: fixture.kind === 'training' ? 'Training' : '',
    date: fixture.date,
    time: fixture.kickoff ?? '',
    duration: 90,
    venue: fixture.venue ?? '',
    meetTime: fixture.meetTime ?? '',
    opponent: fixture.opponent ?? '',
    homeAway: fixture.homeAway ?? '',
    kit: fixture.kit ?? '',
    familyNote: '',
    themes: [],
    competition: '',
  }
}

/** The fixtures already on the schedule, keyed like the CSV rows, so a re-import adds nothing. */
export function scheduleFixtureKeys(rows: EventRow[]): Set<string> {
  return new Set(rows.map(row => {
    const shown = displayEventTime(row)
    return fixtureKey({ date: shown.date, kickoff: shown.time, opponent: row.opponent ?? null })
  }))
}

/** The rows one import inserts. Throws if a fixture can't be saved, so nothing is inserted. */
export function fixtureInsertRows(fixtures: Fixture[], coachUserId: string) {
  return fixtures.map(fixture => {
    const form = fixtureToForm(fixture)
    const problem = formProblem(form)
    if (problem) throw new Error(`Line ${fixture.line}: ${problem}`)
    return { ...formToRow(form), coach_user_id: coachUserId, published: false, source: 'csv' }
  })
}
