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
 * Resolves the full path only - a leaf field's `field-<path>` id, an
 * Array/Blocks row's `<parent>-row-<index>` wrapper id, or a
 * `data-field-path` attribute (Lexical rich-text fields render no
 * `field-<path>` id at all, only the attribute) - with no prefix fallback.
 * Returns `null` when that exact element isn't in the DOM (e.g. because it
 * lives inside an inactive tab, which Payload unmounts).
 */
export const resolveExactFieldElement = (path: string): HTMLElement | null => {
  const fieldEl = document.getElementById(fieldIDFromPath(path))
  if (fieldEl) {
    return fieldEl
  }

  const rowID = rowIDFromPath(path)
  const rowEl = rowID ? document.getElementById(rowID) : null
  if (rowEl) {
    return rowEl
  }

  return document.querySelector<HTMLElement>(`[data-field-path="${path.replace(/["\\]/g, '\\$&')}"]`)
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
    const el = resolveExactFieldElement(segments.join('.'))
    if (el) {
      return el
    }
    segments = segments.slice(0, -1)
  }

  return null
}

/**
 * Depth (in path segments) of the deepest prefix of `path` that resolves to
 * a rendered element - 0 when nothing resolves. Reveal steps compare this
 * before/after (a tab switch, an accordion expansion) to detect progress
 * toward a target whose exact element isn't mountable yet - e.g. a field
 * behind a collapsed row inside a not-yet-active tab.
 */
export const resolvedPathDepth = (path: string): number => {
  const segments = path.split('.')

  for (let length = segments.length; length > 0; length--) {
    if (resolveExactFieldElement(segments.slice(0, length).join('.'))) {
      return length
    }
  }

  return 0
}

/**
 * Trims a (possibly too deep) path to the longest prefix that is an actual
 * form field, using the live form state as the source of truth - e.g. a
 * stega path pointing inside a rich-text value collapses to the rich-text
 * field itself. Returns `null` when no prefix is a form-state key (e.g. a
 * bare row path like `layout.0`, which exists in the DOM but not in form
 * state).
 */
export const fieldPathFromFormState = (path: string, formState: MinimalFormState): null | string => {
  let segments = path.split('.')

  while (segments.length > 0) {
    const candidate = segments.join('.')
    if (formState[candidate] !== undefined) {
      return candidate
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
 *
 * A `$<rowId>` segment whose prefix isn't an Array/Blocks field at all (no
 * `rows` in form state) points inside a JSON-shaped field value instead -
 * e.g. a stega path into a rich-text value, where Lexical blocks/uploads
 * carry `id`s of their own but only the rich-text field itself is a form
 * field. The segments from there on can never resolve to form fields, so the
 * path is truncated to the prefix, which still identifies the owning field
 * via the usual prefix fallback.
 */
export const resolveRowIDs = (path: string, formState: MinimalFormState): null | string => {
  const segments = path.split('.')
  const resolved: string[] = []

  for (const segment of segments) {
    if (isRowIDSegment(segment)) {
      const arrayPath = resolved.join('.')
      const rows = formState[arrayPath]?.rows

      if (!rows) {
        return resolved.length > 0 ? arrayPath : null
      }

      const index = rows.findIndex((row) => row.id === rowIDFromSegment(segment))

      if (index === -1) {
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
 * Collects the string values under `text` keys anywhere inside a JSON-shaped
 * field value. That's where rich-text editor states keep their rendered text
 * runs (Lexical and Slate both use `text`), and it deliberately skips all the
 * structural strings around them (`type: 'paragraph'`, `format`, `mode`, ...)
 * that never render as page content.
 */
const collectTextRuns = (value: unknown, out: string[]): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextRuns(item, out)
    }
    return
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'text' && typeof item === 'string') {
        out.push(item)
      } else {
        collectTextRuns(item, out)
      }
    }
  }
}

/**
 * Collects every string-valued leaf of the live form state, addressed via
 * stable row ids (`layout.$abc.heading`) rather than current indexes, so a
 * match made in the Live Preview iframe stays valid after rows are
 * reordered. Object-valued fields (rich text) contribute their `text` runs,
 * each addressed by the owning field's path - so a paragraph rendered from a
 * rich-text value matches back to the rich-text field. Sent to the iframe
 * for value matching.
 */
export const collectLeafValues = (formState: MinimalFormState): DocumentLeafValue[] => {
  const leaves: DocumentLeafValue[] = []

  for (const [path, field] of Object.entries(formState)) {
    const value = field?.value

    if (typeof value === 'string') {
      if (value.trim() !== '') {
        leaves.push({ path: toRowIDPath(path, formState), value })
      }
      continue
    }

    if (value !== null && typeof value === 'object') {
      const runs: string[] = []
      collectTextRuns(value, runs)
      if (runs.length === 0) {
        continue
      }
      const rowIDPath = toRowIDPath(path, formState)
      for (const run of runs) {
        if (run.trim() !== '') {
          leaves.push({ path: rowIDPath, value: run })
        }
      }
    }
  }

  return leaves
}

/** Payload's tabs-field tab button (see `@payloadcms/ui`'s Tabs field). */
const TAB_BUTTON_SELECTOR = '.tabs-field__tab-button'
const TAB_BUTTON_ACTIVE_CLASS = 'tabs-field__tab-button--active'
/**
 * Max wait for a just-activated tab panel to render its fields, before
 * assuming the target isn't in that tab and moving to the next one.
 * Generous by design: Payload mounts a tab's fields fresh on activation
 * (rich-text editors, nested blocks, ...), which can comfortably take longer
 * than a couple of frames - too short a budget here means the sweep gives up
 * on the *correct* tab before its content finishes rendering, then tries the
 * remaining tabs and finally reverts, looking like nothing happened at all.
 */
export const DEFAULT_TAB_SWITCH_WAIT_MS = 1500
/** Rounds of re-querying tab buttons, so nested tabs revealed by a switch get swept too. */
const MAX_TAB_SWEEP_ROUNDS = 4

/** Resolves with `check`'s first non-null result, polling every frame up to `timeoutMs`. */
export const waitForElement = (check: () => HTMLElement | null, timeoutMs: number): Promise<HTMLElement | null> =>
  new Promise((resolve) => {
    const startedAt = performance.now()

    const tick = () => {
      const el = check()
      if (el) {
        resolve(el)
        return
      }
      if (performance.now() - startedAt >= timeoutMs) {
        resolve(null)
        return
      }
      requestAnimationFrame(tick)
    }

    tick()
  })

/**
 * Payload unmounts inactive tab panels, so a field inside another tab simply
 * isn't in the DOM until its tab is active. This clicks through inactive tab
 * buttons until `check` resolves, re-querying between rounds so nested tabs
 * revealed by a switch get swept too. When nothing is found anywhere, the
 * originally active tabs are clicked back so the sweep leaves no UI trace.
 *
 * `root` limits the sweep to tab buttons inside that subtree. Callers pass
 * the target's nearest rendered ancestor when one resolves: an ancestor in
 * the DOM proves the target's tab is already active, so only tabs *nested
 * inside* the ancestor could still be hiding it.
 */
export const revealTabForElement = async (
  check: () => HTMLElement | null,
  tabRenderWaitMs: number = DEFAULT_TAB_SWITCH_WAIT_MS,
  root: Document | HTMLElement = document,
): Promise<HTMLElement | null> => {
  const found = check()
  if (found) {
    return found
  }

  const originallyActive = Array.from(
    root.querySelectorAll<HTMLButtonElement>(`.${TAB_BUTTON_ACTIVE_CLASS}`),
  )
  const clicked = new Set<Element>()

  for (let round = 0; round < MAX_TAB_SWEEP_ROUNDS; round++) {
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(TAB_BUTTON_SELECTOR)).filter(
      (button) => !clicked.has(button) && !button.classList.contains(TAB_BUTTON_ACTIVE_CLASS),
    )

    if (buttons.length === 0) {
      break
    }

    for (const button of buttons) {
      clicked.add(button)
      button.click()

      const el = await waitForElement(check, tabRenderWaitMs)
      if (el) {
        return el
      }
    }
  }

  for (const button of originallyActive) {
    if (button.isConnected && !button.classList.contains(TAB_BUTTON_ACTIVE_CLASS)) {
      button.click()
    }
  }

  return null
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
const MAX_SCROLL_CORRECTIONS = 6
const SCROLL_CONVERGENCE_THRESHOLD_PX = 1
/** Frames the target's position must hold still before a measurement is trusted. */
const STABLE_POSITION_FRAMES = 3
/** Cap on waiting for the position to hold still (layout that never stops shifting). */
const STABLE_POSITION_TIMEOUT_MS = 400

/**
 * Resolves once `el`'s viewport position has held still for a few frames (or
 * after a cap). Payload mounts deferred fields right after a scroll settles -
 * measuring in that window reads a position that is about to shift again,
 * which made corrections chase a moving target and give up short of it.
 */
const waitForStablePosition = (el: HTMLElement): Promise<void> =>
  new Promise((resolve) => {
    const startedAt = performance.now()
    let lastTop = el.getBoundingClientRect().top
    let stableFrames = 0

    const tick = () => {
      const { top } = el.getBoundingClientRect()
      stableFrames = Math.abs(top - lastTop) < SCROLL_CONVERGENCE_THRESHOLD_PX ? stableFrames + 1 : 0
      lastTop = top

      if (stableFrames >= STABLE_POSITION_FRAMES || performance.now() - startedAt >= STABLE_POSITION_TIMEOUT_MS) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }

    requestAnimationFrame(tick)
  })

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
    await waitForStablePosition(el)
    const correctedDelta = el.getBoundingClientRect().top - offset

    if (Math.abs(correctedDelta) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
      return
    }

    const scrollYBefore = window.scrollY
    window.scrollBy({ behavior, top: correctedDelta })
    await waitForScrollEnd()

    // The page didn't move: the target can't reach the offset at all (e.g.
    // it sits near the bottom of the document). Retrying would just burn
    // the remaining attempts against the scrollend fallback timeout.
    if (Math.abs(window.scrollY - scrollYBefore) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
      return
    }
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
