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
  collapsible?.querySelector<HTMLElement>(':scope > .rah-static') ?? null

/** The part of a tabs field that a tab switch replaces. */
export const tabContentOf = (tabsEl: Element | null | undefined): HTMLElement | null =>
  tabsEl?.querySelector<HTMLElement>(':scope > .tabs-field__content-wrap') ?? null

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
    if (sibling.querySelector('.collapsible')?.classList.contains('collapsible--collapsed')) {
      rows.push(sibling)
    }
  }
  return rows
}
