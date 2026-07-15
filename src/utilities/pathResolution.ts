import { isRowIDSegment, rowIDFromSegment } from './pathAttribute.js'

/** Structurally compatible with `@payloadcms/ui`'s `FormState`, without depending on it. */
export type MinimalFormState = Record<string, { rows?: Array<{ id: string }> } | undefined>

export const DEFAULT_COLLAPSIBLE_ANIMATION_MS = 350
export const DEFAULT_SCROLL_OFFSET = 100

export const fieldIDFromPath = (path: string): string => `field-${path.replace(/\./g, '__')}`

export const rowIDFromPath = (path: string): null | string => {
  const match = /^(.*)\.(\d+)$/.exec(path)

  if (!match) {
    return null
  }

  const [, parentPath, rowIndex] = match

  return `${parentPath.replace(/\./g, '-')}-row-${rowIndex}`
}

/**
 * Resolves a (possibly deep) field path to the closest matching DOM element
 * rendered by Payload's admin form: a leaf field's `field-<path>` id, or an
 * Array/Blocks row's `<parent>-row-<index>` wrapper id. Falls back to
 * progressively shorter prefixes of the path so a path one level too deep
 * still resolves to its nearest visible ancestor.
 */
export const resolveFieldElement = (path: string): HTMLElement | null => {
  let segments = path.split('.')

  while (segments.length > 0) {
    const candidatePath = segments.join('.')

    const fieldEl = document.getElementById(fieldIDFromPath(candidatePath))
    if (fieldEl) {
      return fieldEl
    }

    const rowID = rowIDFromPath(candidatePath)
    if (rowID) {
      const rowEl = document.getElementById(rowID)
      if (rowEl) {
        return rowEl
      }
    }

    segments = segments.slice(0, -1)
  }

  return null
}

/**
 * Replaces any `$<rowId>` segments (from `pathOf`/`inspectable`) with that
 * row's current index, by looking up the array/blocks field's `rows` in the
 * live form state - so the mapping still works after rows are reordered,
 * inserted, or removed above it. Returns `null` if a row id no longer exists
 * (e.g. the row was deleted).
 */
export const resolveRowIDs = (path: string, formState: MinimalFormState): null | string => {
  const segments = path.split('.')
  const resolved: string[] = []

  for (const segment of segments) {
    if (isRowIDSegment(segment)) {
      const arrayPath = resolved.join('.')
      const rows = formState[arrayPath]?.rows
      const index = rows?.findIndex((row) => row.id === rowIDFromSegment(segment))

      if (index === undefined || index === -1) {
        return null
      }

      resolved.push(String(index))
    } else {
      resolved.push(segment)
    }
  }

  return resolved.join('.')
}

/**
 * Expands any collapsed Array/Blocks row accordions that are hiding `el`,
 * whether `el` is a field nested inside one (ancestor lookup) or the row
 * wrapper itself (its collapsible is a direct child, not an ancestor).
 */
export const expandCollapsedAncestors = (el: HTMLElement): boolean => {
  const collapsibles = new Set<HTMLElement>()

  let ancestor = el.closest<HTMLElement>('.collapsible')
  while (ancestor) {
    collapsibles.add(ancestor)
    ancestor = ancestor.parentElement?.closest<HTMLElement>('.collapsible') ?? null
  }

  const ownCollapsible = el.querySelector<HTMLElement>('.collapsible')
  if (ownCollapsible) {
    collapsibles.add(ownCollapsible)
  }

  let expanded = false

  for (const collapsible of collapsibles) {
    if (collapsible.classList.contains('collapsible--collapsed')) {
      collapsible
        .querySelector<HTMLButtonElement>(':scope > .collapsible__toggle-wrap > .collapsible__toggle')
        ?.click()
      expanded = true
    }
  }

  return expanded
}

/**
 * Resolves once `el` has a layout box (nonzero height), or after `timeoutMs`.
 * Payload keeps collapsed accordion content at `display: none`, so a field
 * inside a just-expanded row isn't measurable until React re-renders after
 * the toggle click - usually within a frame or two. Once it has layout, its
 * document position is already final even while the height animation is
 * still running, because that animation only clips the content downward -
 * so there's no need to wait for the animation itself.
 */
export const waitForElementLayout = (
  el: HTMLElement,
  timeoutMs: number = DEFAULT_COLLAPSIBLE_ANIMATION_MS,
): Promise<void> =>
  new Promise((resolve) => {
    const startedAt = performance.now()

    const check = () => {
      if (el.getBoundingClientRect().height > 0 || performance.now() - startedAt >= timeoutMs) {
        resolve()
        return
      }
      requestAnimationFrame(check)
    }

    check()
  })

const SCROLL_CONVERGENCE_THRESHOLD_PX = 1
/** Consecutive frames the element must hold within the threshold to count as arrived. */
const SCROLL_SETTLE_FRAMES = 3
/** Consecutive motionless frames after which the scroll is considered stalled and re-aimed. */
const SCROLL_STALL_FRAMES = 3
/** Absolute cap on the whole scroll, in case layout never stops churning. */
const SCROLL_MAX_DURATION_MS = 4000

let cancelActiveScroll: (() => void) | undefined

/**
 * Smooth-scrolls to `el` and resolves once the element actually sits at
 * `offset` - `true` when it arrived (or got as close as the page allows),
 * `false` when the scroll was interrupted by the user or superseded by a
 * newer `scrollToElement` call, so callers know not to flash/focus a field
 * the viewport never reached. A field already visible in the viewport
 * resolves `true` immediately; the nudge toward `offset` still happens, just
 * in the background, so the reveal isn't delayed over a minor adjustment.
 *
 * A single `scrollBy` with a pre-measured delta isn't enough: on long pages,
 * content above the target keeps loading in (rich-text editors hydrating,
 * image previews) while the smooth scroll is in flight, moving the target
 * out from under the animation. So this re-measures every animation frame,
 * and whenever the scroll comes to rest short of the target it re-aims a
 * smooth scroll at the element's *current* position, until the position
 * converges and holds still. This also avoids the `scrollend` event, which
 * older Safari versions don't fire.
 */
export const scrollToElement = (el: HTMLElement, offset: number = DEFAULT_SCROLL_OFFSET): Promise<boolean> => {
  cancelActiveScroll?.()

  const behavior: ScrollBehavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'instant'
    : 'smooth'

  const bounds = el.getBoundingClientRect()
  const delta = bounds.top - offset

  if (Math.abs(delta) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
    return Promise.resolve(true)
  }

  window.scrollBy({ behavior, top: delta })

  const alreadyInViewport = bounds.top >= 0 && bounds.top <= window.innerHeight
  if (alreadyInViewport) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    let raf = 0
    let settleFrames = 0
    let stallFrames = 0
    let fruitlessRetargets = 0
    let lastScrollY = window.scrollY
    const startedAt = performance.now()

    const finish = (arrived: boolean) => {
      cancelAnimationFrame(raf)
      window.removeEventListener('wheel', interrupt)
      window.removeEventListener('touchstart', interrupt)
      if (cancelActiveScroll === interrupt) {
        cancelActiveScroll = undefined
      }
      resolve(arrived)
    }

    const interrupt = () => finish(false)
    cancelActiveScroll = interrupt

    window.addEventListener('wheel', interrupt, { passive: true })
    window.addEventListener('touchstart', interrupt, { passive: true })

    const tick = (now: DOMHighResTimeStamp) => {
      const remaining = el.getBoundingClientRect().top - offset

      if (Math.abs(remaining) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
        settleFrames += 1
        if (settleFrames >= SCROLL_SETTLE_FRAMES) {
          finish(true)
          return
        }
      } else {
        settleFrames = 0

        if (window.scrollY === lastScrollY) {
          stallFrames += 1
          if (stallFrames >= SCROLL_STALL_FRAMES) {
            fruitlessRetargets += 1
            if (fruitlessRetargets > 1) {
              // Re-aiming didn't move the page at all - it can't get any
              // closer (e.g. the field sits near the bottom edge). Reveal
              // at the best position reachable.
              finish(true)
              return
            }
            window.scrollBy({ behavior, top: remaining })
            stallFrames = 0
          }
        } else {
          stallFrames = 0
          fruitlessRetargets = 0
        }
      }

      lastScrollY = window.scrollY

      if (now - startedAt >= SCROLL_MAX_DURATION_MS) {
        finish(true)
        return
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
  })
}

export const focusElement = (el: HTMLElement): void => {
  const focusable = el.matches('input, textarea, select, [contenteditable="true"]')
    ? el
    : el.querySelector<HTMLElement>('input, textarea, select, [contenteditable="true"]')

  focusable?.focus({ preventScroll: true })
}

export type FlashOptions = {
  className: string
  color?: string
  durationMs?: number
}

export const flashElement = (el: HTMLElement, { className, color, durationMs }: FlashOptions): void => {
  el.classList.remove(className)

  if (color) {
    el.style.setProperty('--payload-live-preview-inspector-flash-color', color)
  }
  if (durationMs) {
    el.style.animationDuration = `${durationMs}ms`
  }

  // Force a reflow so the animation restarts if the element was just flashed.
  void el.offsetWidth
  el.classList.add(className)

  el.addEventListener(
    'animationend',
    () => {
      el.classList.remove(className)
      el.style.removeProperty('--payload-live-preview-inspector-flash-color')
      el.style.removeProperty('animation-duration')
    },
    { once: true },
  )
}
