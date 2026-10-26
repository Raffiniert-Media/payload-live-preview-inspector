import { markHost, raiseMarkHost, releaseMarkHost } from './markHost.js'
import { type VisibleRect, visibleRectOf } from './visibleRect.js'

/**
 * The hover frame around what the pointer is on, and the flash on what a
 * reveal arrived at - drawn in the top layer (`markHost.ts`), over the part
 * of the element the page shows (`visibleRect.ts`).
 *
 * They used to be an outline on the page's own element, and the page decided
 * whether it showed: a picture in a rounded box of its own size lost it to the
 * box's `overflow: hidden`, and drawn inside instead, to the pictures in it.
 * The element still gets the classes - the cursor, and the hook a site styles
 * its own hover with - but the frame is ours.
 *
 * The frame follows the element while it moves - a scroll, a carousel turning
 * - frame by frame, and checks less often once it has held still.
 */

export type MarkClasses = {
  /** The flash after a reveal: one shape, animated, removed when it ends. */
  flash: string
  /** The hover frame. */
  hover: string
  /** The layer both are drawn in, inside the host. */
  layer: string
}

export type Marks = {
  destroy: () => void
  flash: (el: HTMLElement) => void
  hover: (el: HTMLElement | null) => void
}

/** Outside the element by this much, where the window leaves room. */
const OUTSET = 3
/** Frames the hovered element has to hold still before the frame checks less often. */
const STILL_FRAMES = 20
const RESTING_CHECK_MS = 200
const FLASH_MS = 1_200

/** The frame's box: the visible part, a little outside it, kept inside the window. */
const frameBox = (view: Window, visible: VisibleRect) => {
  const left = Math.max(visible.left - OUTSET, 1)
  const top = Math.max(visible.top - OUTSET, 1)
  const right = Math.min(visible.right + OUTSET, view.innerWidth - 1)
  const bottom = Math.min(visible.bottom + OUTSET, view.innerHeight - 1)
  return { height: bottom - top, left, top, width: right - left }
}

/** The element's own corner, when the frame is around all of it - a rounded card gets a rounded frame. */
const cornerOf = (view: Window, el: HTMLElement, visible: VisibleRect): string => {
  const rect = el.getBoundingClientRect()
  const whole =
    Math.abs(rect.left - visible.left) < 1 &&
    Math.abs(rect.top - visible.top) < 1 &&
    Math.abs(rect.right - visible.right) < 1 &&
    Math.abs(rect.bottom - visible.bottom) < 1
  const radius = whole ? Number.parseFloat(view.getComputedStyle(el).borderTopLeftRadius) || 0 : 0
  return `${Math.round(radius + OUTSET)}px`
}

export const createMarks = (doc: Document, classes: MarkClasses): Marks => {
  const view = doc.defaultView ?? window
  let layer: HTMLDivElement | undefined
  let frame: HTMLDivElement | undefined
  let hovered: HTMLElement | null = null
  let animation = 0
  let resting = 0
  let stillFor = 0
  let lastPlaced = ''

  const ensureLayer = (): HTMLDivElement => {
    if (!layer || !layer.isConnected) {
      layer = doc.createElement('div')
      layer.className = classes.layer
      layer.setAttribute('aria-hidden', 'true')
      markHost(doc).append(layer)
    } else {
      raiseMarkHost(layer.parentElement as HTMLElement)
    }
    return layer
  }

  /** Puts `box` over `el`; false when nothing of `el` shows. */
  const place = (box: HTMLElement, el: HTMLElement): boolean => {
    const visible = el.isConnected ? visibleRectOf(el) : null
    if (!visible) {
      box.style.display = 'none'
      return false
    }
    const { height, left, top, width } = frameBox(view, visible)
    box.style.removeProperty('display')
    box.style.transform = `translate(${left}px, ${top}px)`
    box.style.width = `${width}px`
    box.style.height = `${height}px`
    box.style.borderRadius = cornerOf(view, el, visible)
    return true
  }

  const stop = () => {
    view.cancelAnimationFrame(animation)
    view.clearTimeout(resting)
    animation = 0
    resting = 0
  }

  const follow = () => {
    animation = 0
    if (!hovered || !frame) {
      return
    }
    place(frame, hovered)
    const placed = `${frame.style.transform}|${frame.style.width}|${frame.style.height}|${frame.style.display}`
    stillFor = placed === lastPlaced ? stillFor + 1 : 0
    lastPlaced = placed
    if (stillFor < STILL_FRAMES) {
      animation = view.requestAnimationFrame(follow)
    } else {
      resting = view.setTimeout(() => {
        resting = 0
        animation = view.requestAnimationFrame(follow)
      }, RESTING_CHECK_MS)
    }
  }

  // A scroll or a resized window moves everything at once - from rest, too.
  const wake = () => {
    if (!hovered) {
      return
    }
    stillFor = 0
    if (resting) {
      view.clearTimeout(resting)
      resting = 0
    }
    if (!animation) {
      animation = view.requestAnimationFrame(follow)
    }
  }
  view.addEventListener('scroll', wake, { capture: true, passive: true })
  view.addEventListener('resize', wake, { passive: true })

  return {
    destroy: () => {
      stop()
      view.removeEventListener('scroll', wake, { capture: true })
      view.removeEventListener('resize', wake)
      layer?.remove()
      layer = undefined
      frame = undefined
      releaseMarkHost(doc)
    },
    flash: (el) => {
      const flash = doc.createElement('div')
      flash.className = classes.flash
      ensureLayer().append(flash)
      const started = view.performance.now()
      const track = () => {
        if (!flash.isConnected) {
          return
        }
        if (view.performance.now() - started > FLASH_MS) {
          flash.remove()
          return
        }
        place(flash, el)
        view.requestAnimationFrame(track)
      }
      track()
    },
    hover: (el) => {
      if (el === hovered) {
        return
      }
      hovered = el
      stop()
      if (!el) {
        if (frame) {
          frame.style.display = 'none'
        }
        return
      }
      if (!frame || !frame.isConnected) {
        frame = doc.createElement('div')
        frame.className = classes.hover
        ensureLayer().append(frame)
      } else {
        ensureLayer()
      }
      stillFor = 0
      lastPlaced = ''
      follow()
    },
  }
}
