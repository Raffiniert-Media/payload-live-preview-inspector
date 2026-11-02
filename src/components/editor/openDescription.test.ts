// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from 'vitest'

import { DESCRIPTION_OPEN_ATTRIBUTE, holdOpenDescription } from './openDescription.js'

/**
 * The open description must not close under a click.
 *
 * With `:focus-within` a field's description closed the moment focus moved -
 * on mousedown - so everything below it moved up before the mouse came back
 * up, and the click landed on whatever had moved under the pointer. On a new
 * page in the theme's admin: type the title, click the first section, nothing
 * happens; the second click opens it.
 */

let stop: () => void
const field = (id: string) => {
  const el = document.createElement('div')

  el.className = 'field-type'
  el.innerHTML = `<input id="${id}" /><div class="field-description">…</div>`
  document.body.append(el)

  return el
}
const open = (el: Element) => el.hasAttribute(DESCRIPTION_OPEN_ATTRIBUTE)
const ticks = () => new Promise((resolve) => setTimeout(resolve, 10))

beforeEach(() => {
  document.body.innerHTML = ''
  stop = holdOpenDescription(document)
})

afterEach(() => stop())

it('opens the description of the field that has focus, and only that one', () => {
  const title = field('title')
  const other = field('other')

  title.querySelector('input')!.focus()
  expect(open(title)).toBe(true)
  expect(open(other)).toBe(false)

  other.querySelector('input')!.focus()
  expect(open(title)).toBe(false)
  expect(open(other)).toBe(true)
})

it('keeps it open while the mouse is down, and closes it after the click', async () => {
  const title = field('title')
  const below = document.createElement('button')

  document.body.append(below)
  title.querySelector('input')!.focus()

  below.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  below.focus()
  expect(open(title)).toBe(true)

  below.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  below.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(open(title)).toBe(true)

  await ticks()
  expect(open(title)).toBe(false)
})

it('closes at once when focus leaves by keyboard', () => {
  const title = field('title')
  const below = document.createElement('button')

  document.body.append(below)
  title.querySelector('input')!.focus()
  below.focus()

  expect(open(title)).toBe(false)
})
