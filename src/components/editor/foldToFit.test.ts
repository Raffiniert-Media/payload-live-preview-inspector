// @vitest-environment happy-dom
import { expect, it } from 'vitest'

import { BAR_FOLDS, FOLDED_ATTRIBUTE } from './editorStyles.js'
import { foldToFit } from './foldToFit.js'

/**
 * A bar `width` wide whose content is `needs` wide with nothing folded, and
 * gives back `saves[fold]` for each fold in effect - the layout happy-dom
 * does not do, so the folding can be held to numbers.
 */
const bar = (width: number, needs: number, saves: Record<string, number>) => {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientWidth', { get: () => width })
  Object.defineProperty(el, 'scrollWidth', {
    get: () => {
      const folded = (el.getAttribute(FOLDED_ATTRIBUTE) ?? '').split(' ').filter(Boolean)
      return Math.max(width, needs - folded.reduce((sum, fold) => sum + (saves[fold] ?? 0), 0))
    },
  })
  return el
}

const SAVES = { breakpoint: 100, hint: 300, size: 120 }

it('folds nothing while everything fits', () => {
  const el = bar(1000, 900, SAVES)
  foldToFit(el, BAR_FOLDS)
  expect(el.hasAttribute(FOLDED_ATTRIBUTE)).toBe(false)
})

it('folds the least important first, and only as much as it takes', () => {
  const el = bar(1000, 1200, SAVES)
  foldToFit(el, BAR_FOLDS)
  expect(el.getAttribute(FOLDED_ATTRIBUTE)).toBe('hint')

  const narrower = bar(800, 1200, SAVES)
  foldToFit(narrower, BAR_FOLDS)
  expect(narrower.getAttribute(FOLDED_ATTRIBUTE)).toBe('hint size')
})

it('keeps a known hint folded however wide the bar', () => {
  const el = bar(2000, 900, SAVES)
  foldToFit(el, BAR_FOLDS, 1)
  expect(el.getAttribute(FOLDED_ATTRIBUTE)).toBe('hint')
})

it('folds everything when nothing is enough', () => {
  const el = bar(100, 1200, SAVES)
  foldToFit(el, BAR_FOLDS)
  expect(el.getAttribute(FOLDED_ATTRIBUTE)).toBe('hint size breakpoint')
})
