import { isRowIDSegment, rowIDFromSegment, rowIDSegment } from './pathAttribute.js'

/** Structurally compatible with `@payloadcms/ui`'s `FormState`, without depending on it. */
export type MinimalFormState = Record<string, { rows?: Array<{ id: string }>; value?: unknown } | undefined>

/** A string-valued form field, addressed by a `$rowId`-based path. */
export type DocumentLeafValue = { path: string; value: string }

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

/** The inverse of `resolveRowIDs`: `layout.0.heading` → `layout.$abc.heading`. */
const toRowIDPath = (path: string, formState: MinimalFormState): string => {
  const segments = path.split('.')
  const resolved: string[] = []
  let indexedPrefix = ''

  for (const segment of segments) {
    let resolvedSegment = segment
    if (/^\d+$/.test(segment)) {
      const rowId = formState[indexedPrefix]?.rows?.[Number(segment)]?.id
      if (rowId) {
        resolvedSegment = rowIDSegment(rowId)
      }
    }
    resolved.push(resolvedSegment)
    indexedPrefix = indexedPrefix ? `${indexedPrefix}.${segment}` : segment
  }

  return resolved.join('.')
}

/**
 * Collects every string-valued leaf of the live form state, addressed via
 * stable row ids (`layout.$abc.heading`) rather than current indexes, so a
 * match made in the Live Preview iframe stays valid after rows are
 * reordered. Sent to the iframe for value matching.
 */
export const collectLeafValues = (formState: MinimalFormState): DocumentLeafValue[] => {
  const leaves: DocumentLeafValue[] = []

  for (const [path, field] of Object.entries(formState)) {
    const value = field?.value
    if (typeof value !== 'string' || value.trim() === '') {
      continue
    }
    leaves.push({ path: toRowIDPath(path, formState), value })
  }

  return leaves
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

/** Safety net in case `scrollend` never fires (e.g. an older browser). */
const SCROLL_END_FALLBACK_MS = 1000
/** How many times to re-measure and correct after the scroll settles, in case layout shifted mid-scroll. */
const MAX_SCROLL_CORRECTIONS = 2
const SCROLL_CONVERGENCE_THRESHOLD_PX = 1

const waitForScrollEnd = (): Promise<void> =>
  new Promise((resolve) => {
    let settled = false

    const settle = () => {
      if (settled) {
        return
      }
      settled = true
      window.removeEventListener('scrollend', settle)
      clearTimeout(fallback)
      resolve()
    }

    const fallback = setTimeout(settle, SCROLL_END_FALLBACK_MS)
    window.addEventListener('scrollend', settle, { once: true })
  })

/**
 * Smooth-scrolls to `el` and resolves once the scroll actually finishes (via
 * the `scrollend` event, with a timeout fallback for browsers that don't
 * fire it), or immediately if the field is already visible in the viewport.
 * Callers use this to delay revealing the field (flash/focus) until the page
 * has stopped moving. A field that's already on screen is rarely
 * pixel-perfect at `offset`, so still nudging it there is worthwhile, but
 * not worth delaying the reveal over - that nudge just happens in the
 * background. Scrolling is instant instead of animated when the user
 * prefers reduced motion.
 *
 * The initial delta is measured before the scroll runs, so anything that
 * shifts layout while a long scroll animation is in flight (an accordion
 * still rendering, images/fonts loading in) can leave the element short of
 * `offset` once it stops. Rather than requiring the user to click again,
 * this re-measures once the scroll settles and issues further corrections
 * (using the same `behavior` as the initial scroll, so a correction never
 * looks like an abrupt jump after a smooth animation) until the position
 * converges or the retry budget runs out.
 */
export const scrollToElement = async (el: HTMLElement, offset: number = DEFAULT_SCROLL_OFFSET): Promise<void> => {
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'instant'
    : 'smooth'

  const bounds = el.getBoundingClientRect()
  const delta = bounds.top - offset

  if (Math.abs(delta) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
    return
  }

  window.scrollBy({ behavior, top: delta })

  const alreadyInViewport = bounds.top >= 0 && bounds.top <= window.innerHeight
  if (alreadyInViewport) {
    return
  }

  await waitForScrollEnd()

  for (let attempt = 0; attempt < MAX_SCROLL_CORRECTIONS; attempt++) {
    const correctedBounds = el.getBoundingClientRect()
    const correctedDelta = correctedBounds.top - offset

    if (Math.abs(correctedDelta) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
      return
    }

    window.scrollBy({ behavior, top: correctedDelta })
    await waitForScrollEnd()
  }
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
