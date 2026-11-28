import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * TRAK-182: Schedule's event form is one step per screen (What, When, For
 * families, Review); an edit opens on What, filled in. Tests walk it the way a coach
 * does: Next and "Back to <step>".
 */
const STEPS = ['What', 'When', 'For families', 'Review'] as const
export type EventStep = typeof STEPS[number]

const current = (sheet: HTMLElement): number => {
  const label = sheet.querySelector('[aria-current="step"]')?.textContent ?? ''
  return STEPS.findIndex(step => label.includes(step))
}

/** Goes to a step. Next stops on a step with a problem, so fill it first. */
export async function eventStep(sheet: HTMLElement, step: EventStep) {
  const target = STEPS.indexOf(step)
  for (let guard = 0; guard < STEPS.length && current(sheet) !== target; guard++) {
    // TRAK-635: a training needs its title before Next, so walking on names it as it used to show.
    const title = current(sheet) < target ? within(sheet).queryByLabelText('Title', { exact: true }) : null
    if (title instanceof HTMLInputElement && !title.value) await userEvent.type(title, 'Training')
    await userEvent.click(current(sheet) < target
      ? within(sheet).getByRole('button', { name: 'Next' })
      : within(sheet).getByRole('button', { name: /^Back to / }))
  }
  expect(current(sheet)).toBe(target)
}

/** Review's buttons: Save draft, Publish, Save changes, "Save 4 drafts"… */
export async function saveEventWith(sheet: HTMLElement, name: string | RegExp) {
  await eventStep(sheet, 'Review')
  await userEvent.click(within(sheet).getByRole('button', { name }))
}
