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

/** Safety net in case `scrollend` never fires (e.g. an older browser). */
const SCROLL_END_FALLBACK_MS = 1000

/**
 * Smooth-scrolls to `el` and resolves once the scroll actually finishes (via
 * the `scrollend` event), or immediately if the field is already visible
 * in the viewport. Callers use this to delay revealing the field
 * (flash/focus) until the page has stopped moving, instead of racing the
 * scroll animation - but only when a real, noticeable scroll is happening.
 * A field that's already on screen is rarely pixel-perfect at `offset`, so
 * still nudging it there is worthwhile, but not worth delaying the reveal
 * over - that nudge just happens in the background.
 */
export const scrollToElement = (el: HTMLElement, offset: number = DEFAULT_SCROLL_OFFSET): Promise<void> => {
  const bounds = el.getBoundingClientRect()
  const delta = bounds.top - offset

  if (Math.abs(delta) < 1) {
    return Promise.resolve()
  }

  window.scrollBy({ behavior: 'smooth', top: delta })

  const alreadyInViewport = bounds.top >= 0 && bounds.top <= window.innerHeight
  if (alreadyInViewport) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
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
