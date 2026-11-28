import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TRAINING_THEMES, catalogueLink, trainingThemeFrom, trainingThemesFrom } from '@/lib/training-theme'
import { blankForm, formToRow, rowToForm, type EventRow } from '@/lib/coach-events'

/**
 * [scope] Training theme on New event: a coach setting up a training picks one
 * of the Coaching Session Catalogue's seven libraries as its theme, and can
 * open the catalogue on that library to choose sessions.
 */

const html = readFileSync(resolve(__dirname, '../../../public/trainings/coaching-session-catalogue.html'), 'utf8')
const json = (name: string) => JSON.parse(html.match(new RegExp(`const ${name} = (.*);\\r?$`, 'm'))![1])
const DATA: { library: string }[] = json('DATA')
const TOPIC_ORDER: Record<string, string[]> = json('TOPIC_ORDER')

describe('the seven themes are the catalogue libraries', () => {
  it('in the catalogue order, with its session and topic counts', () => {
    expect(TRAINING_THEMES.map(t => t.library)).toEqual(Object.keys(TOPIC_ORDER))
    for (const t of TRAINING_THEMES) {
      expect({ [t.label]: t.sessions }).toEqual({ [t.label]: DATA.filter(d => d.library === t.library).length })
      expect({ [t.label]: t.topics }).toEqual({ [t.label]: TOPIC_ORDER[t.library].length })
    }
  })

  it('uses the short names coaches see on the catalogue tabs', () => {
    expect(TRAINING_THEMES.map(t => t.label)).toEqual([
      'Technical', 'Attacking', 'Defending', 'Transition', 'Goalkeeping', 'Physical & movement', 'Psychological & social',
    ])
  })

  it('links to the Library opened on a theme, or on its first page (TRAK-264)', () => {
    expect(catalogueLink('defending')).toBe('/coach/trainings/defending')
    expect(catalogueLink(null)).toBe('/coach/trainings')
    expect(catalogueLink('')).toBe('/coach/trainings')
  })

  it('reads back only a known theme', () => {
    expect(trainingThemeFrom('goalkeeping')).toBe('goalkeeping')
    expect(trainingThemeFrom('Goalkeeping')).toBe('')
    expect(trainingThemeFrom(null)).toBe('')
  })
})

describe('TRAK-635: the event form stores the themes on trainings only', () => {
  const form = { ...blankForm('2030-01-07'), time: '17:00', title: 'Finishing' }

  it('writes every chosen theme on a training, or none', () => {
    expect(formToRow({ ...form, themes: ['transition'] })).toMatchObject({ training_themes: ['transition'] })
    expect(formToRow({ ...form, themes: ['attacking', 'transition'] })).toMatchObject({ training_themes: ['attacking', 'transition'] })
    expect(formToRow(form)).toMatchObject({ training_themes: [] })
  })

  it('drops them when the event is a match or other', () => {
    expect(formToRow({ ...form, kind: 'match', opponent: 'Synthetic FC', themes: ['transition'] })).toMatchObject({ training_themes: [] })
    expect(formToRow({ ...form, kind: 'other', title: 'Photo', themes: ['transition'] })).toMatchObject({ training_themes: [] })
  })

  it('reads them back for an edit: known keys only, each once, in the listed order', () => {
    const row: EventRow = {
      id: 'e1', title: 'Training', event_type: 'training', starts_at: '2030-01-07T13:00:00Z', published: false,
      training_themes: ['transition', 'attacking'],
    }
    expect(rowToForm(row).themes).toEqual(['attacking', 'transition'])
    expect(rowToForm({ ...row, training_themes: [] }).themes).toEqual([])
    expect(trainingThemesFrom(['physical', 'Physical', 'physical', null])).toEqual(['physical'])
    expect(trainingThemesFrom(null)).toEqual([])
  })
})

// TRAK-419 (11 Nov review): where Training is on, a theme's link opens Training › Drills, as near the theme as Drills can.
describe('drillsLink', () => {
  it('opens each theme on its drills where Drills can show them, and plain Drills otherwise', async () => {
    const { drillsLink } = await import('../training-theme')
    expect(drillsLink('technical')).toBe('/coach/training/drills/all?show=Technical')
    expect(drillsLink('goalkeeping')).toBe('/coach/training/drills/all?show=Goalkeeping')
    expect(drillsLink('attacking')).toBe('/coach/training/drills/all?q=attack')
    expect(drillsLink('defending')).toBe('/coach/training/drills/all?q=defend')
    expect(drillsLink('transition')).toBe('/coach/training/drills/all?q=transition')
    for (const none of ['physical', 'psychological', '', null, undefined, 'session', 'programmes', 'nope']) {
      expect(drillsLink(none)).toBe('/coach/training/drills')
    }
  })
})
