import { collapsibleOf, isCollapsedCollapsible, PAYLOAD_CLASS, selectorOf } from './payloadAdmin.js'

/** How long a revealed area takes to fade in. */
const LIFT_MS = 220
/** How long something already on screen takes to fade out. */
const DRAW_MS = 120

export type Curtain = {
  /** Fades the area in. Safe to call more than once, and on nothing. */
  lift: () => void
}

/**
 * Hides an area while Payload renders into it, and fades it in once it is
 * done.
 *
 * Payload switches a tab's content in one frame, and fills an expanded row
 * in stages: the row grows, then its fields appear, then rich-text editors
 * grow again as they start. Watched, that is content popping in piece by
 * piece. Behind the curtain it happens unseen, and what appears is the
 * finished area.
 *
 * Only opacity changes - no layout, and the fade runs on the compositor, so
 * it stays smooth while the page is still busy rendering. Payload's own
 * rendering doesn't mind either: its IntersectionObservers ignore opacity.
 */
export const drawCurtain = (el: HTMLElement | null | undefined, { fade = false } = {}): Curtain => {
  if (!el) {
    return { lift: () => {} }
  }

  // Something the editor can see goes softly; an area that is about to
  // open (still zero high) has nothing to fade.
  if (fade) {
    el.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: DRAW_MS, easing: 'ease-in' })
  }
  el.style.opacity = '0'
  let lifted = false

  return {
    lift: () => {
      if (lifted) {
        return
      }
      lifted = true
      el.style.removeProperty('opacity')
      el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: LIFT_MS, easing: 'ease-out' })
    },
  }
}

/** The part of a row or collapsible that opens: Payload's animated content box. */
export const openingAreaOf = (collapsible: Element | null | undefined): HTMLElement | null =>
  collapsible?.querySelector<HTMLElement>(`:scope > ${selectorOf(PAYLOAD_CLASS.animatedContent)}`) ?? null

/** The part of a tabs field that a tab switch replaces. */
export const tabContentOf = (tabsEl: Element | null | undefined): HTMLElement | null =>
  tabsEl?.querySelector<HTMLElement>(`:scope > ${selectorOf(PAYLOAD_CLASS.tabsContentWrap)}`) ?? null

/**
 * The closed rows after `row` in its list that are on screen - pushed down
 * in bursts while `row` fills, which reads as the list jumping.
 *
 * Only closed ones: an open row is content the editor may just have been
 * looking at (the column they revealed a moment ago, next to the one opening
 * now), and fading it out and in again replayed an animation for something
 * that never changed.
 */
export const visibleRowsAfter = (row: Element | null | undefined): HTMLElement[] => {
  const rows: HTMLElement[] = []
  for (let sibling = row?.nextElementSibling; sibling instanceof HTMLElement; sibling = sibling.nextElementSibling) {
    if (sibling.getBoundingClientRect().top >= window.innerHeight) {
      break
    }
    if (isCollapsedCollapsible(collapsibleOf(sibling))) {
      rows.push(sibling)
    }
  }
  return rows
}

/** Areas still holding room after their reveal ended - see `holdScrollRoom`. */
const keptRooms = new Set<HTMLElement>()

/**
 * Keeps a tab's area from making the page shorter than the view needs while
 * the tab switches.
 *
 * Payload swaps a tab's content and renders the new fields a few frames
 * later. In between the page can be shorter than the place it is scrolled
 * to, and the browser pulls the scroll position back - only for the content
 * to arrive and the reveal to scroll down again: a jerk up and down while the
 * page was meant to rest (measured: 21 px back and 20 forth, a tab switched
 * from 145 px down). Held at the height the current scroll position needs -
 * no more, so a short tab gains nothing once its fields are there.
 *
 * Released when the reveal ends; an area whose own content still falls short
 * keeps the hold (letting go would pull the page back under the field just
 * revealed) until the next reveal starts.
 */
export const holdScrollRoom = (area: HTMLElement | null | undefined): { release: () => void } => {
  const view = area?.ownerDocument.defaultView
  if (!area || !view) {
    return { release: () => {} }
  }
  const page = area.ownerDocument.documentElement
  const needed = Math.ceil(view.scrollY + view.innerHeight - (page.scrollHeight - area.getBoundingClientRect().height))
  if (needed <= 0) {
    return { release: () => {} }
  }
  area.style.minHeight = `${needed}px`
  keptRooms.delete(area)
  return {
    release: () => {
      if (area.getBoundingClientRect().height > needed + 0.5) {
        area.style.removeProperty('min-height')
      } else {
        keptRooms.add(area)
      }
    },
  }
}

/** Lets go of every hold a finished reveal had to keep - a new one starts, or the editor goes. */
export const releaseKeptRooms = (): void => {
  for (const area of keptRooms) {
    area.style.removeProperty('min-height')
  }
  keptRooms.clear()
}
