/** The `overflow` values that cut away what reaches past the box. */
const CLIPPING = new Set(['auto', 'clip', 'hidden', 'scroll'])

/**
 * Whether a mark drawn `reach` px outside `el` would be cut away by the page.
 *
 * The hover outline sits 2 px outside the element, so a picture in a box of
 * its own size with `overflow: hidden` - rounded corners are made that way,
 * and so are cards, portraits and before/after pairs - showed no outline at
 * all: the click went to the right field, the pointer saw nothing to click.
 * Measured on the first customer site: an image of 153 × 204 px in a wrapper
 * of 153 × 204 px, `overflow: hidden`.
 *
 * Every ancestor that clips counts, not only the nearest: a slide at the edge
 * of a carousel loses its outline to the carousel's own window. Called when
 * the hovered element changes, not per frame.
 */
export const outlineIsClipped = (el: Element, reach: number): boolean => {
  const view = el.ownerDocument.defaultView
  if (!view) {
    return false
  }
  const rect = el.getBoundingClientRect()
  const outer = {
    bottom: rect.bottom + reach,
    left: rect.left - reach,
    right: rect.right + reach,
    top: rect.top - reach,
  }

  for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor)
    // The shorthand too: a browser always answers the longhands, happy-dom does not.
    const clipsX = CLIPPING.has(style.overflowX || style.overflow)
    const clipsY = CLIPPING.has(style.overflowY || style.overflow)
    if (!clipsX && !clipsY) {
      continue
    }
    const box = ancestor.getBoundingClientRect()
    if (clipsX && (outer.left < box.left || outer.right > box.right)) {
      return true
    }
    if (clipsY && (outer.top < box.top || outer.bottom > box.bottom)) {
      return true
    }
  }

  return false
}
