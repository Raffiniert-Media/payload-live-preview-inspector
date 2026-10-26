/**
 * The part of an element the page actually shows: its box, cut by every
 * ancestor that clips it and by the window.
 *
 * A mark in the top layer (`markHost.ts`) is above everything, so it would
 * also frame what the page has cut away - the half of a slide that is outside
 * its carousel's window, a picture's overflow in a rounded box. Framing only
 * what shows keeps the mark where the pointer is.
 *
 * Only ancestors that contain the box clip it: an absolutely positioned
 * element escapes the clipping of every ancestor below its positioned one,
 * a fixed one all of them.
 */

export type VisibleRect = { bottom: number; left: number; right: number; top: number }

/** The `overflow` values that cut away what reaches past the box. */
const CLIPPING = new Set(['auto', 'clip', 'hidden', 'scroll'])

export const visibleRectOf = (el: Element): null | VisibleRect => {
  const view = el.ownerDocument.defaultView
  if (!view) {
    return null
  }
  const rect = el.getBoundingClientRect()
  const visible = { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top }

  let position = view.getComputedStyle(el).position
  for (let ancestor = el.parentElement; ancestor && position !== 'fixed'; ancestor = ancestor.parentElement) {
    const style = view.getComputedStyle(ancestor)
    // An absolute box belongs to its nearest positioned ancestor, not to the static ones on the way.
    if (position === 'absolute' && (style.position || 'static') === 'static') {
      continue
    }
    // The shorthand too: a browser always answers the longhands, happy-dom does not.
    const clipsX = CLIPPING.has(style.overflowX || style.overflow)
    const clipsY = CLIPPING.has(style.overflowY || style.overflow)
    if (clipsX || clipsY) {
      const box = ancestor.getBoundingClientRect()
      if (clipsX) {
        visible.left = Math.max(visible.left, box.left)
        visible.right = Math.min(visible.right, box.right)
      }
      if (clipsY) {
        visible.top = Math.max(visible.top, box.top)
        visible.bottom = Math.min(visible.bottom, box.bottom)
      }
    }
    position = style.position
  }

  visible.left = Math.max(visible.left, 0)
  visible.top = Math.max(visible.top, 0)
  visible.right = Math.min(visible.right, view.innerWidth)
  visible.bottom = Math.min(visible.bottom, view.innerHeight)

  return visible.right - visible.left > 0 && visible.bottom - visible.top > 0 ? visible : null
}
