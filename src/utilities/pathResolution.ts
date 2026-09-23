import type { CaretHint } from './caret.js'

import { applyCaretHint } from './caret.js'
import { isRowIDSegment, rowIDFromSegment, rowIDSegment } from './pathAttribute.js'

/** Structurally compatible with `@payloadcms/ui`'s `FormState`, without depending on it. */
export type MinimalFormState = Record<
  string,
  { rows?: Array<{ blockType?: string; collapsed?: boolean; id: string }>; value?: unknown } | undefined
>

/** A string-valued form field, addressed by a `$rowId`-based path. */
export type DocumentLeafValue = { path: string; value: string }

export const DEFAULT_COLLAPSIBLE_ANIMATION_MS = 350
export const DEFAULT_SCROLL_OFFSET = 100

export const fieldIDFromPath = (path: string): string => `field-${path.replace(/\./g, '__')}`

/** Prefix used by every non-rich-text field's `id`, set on whichever element is its actual control. */
const FIELD_ID_PREFIX = 'field-'

/**
 * The inverse of `fieldIDFromPath`/Payload's own `data-field-path`: given a
 * DOM element inside the admin form (typically the one that just received
 * focus), climbs to the nearest ancestor that identifies a field and returns
 * its path - with current numeric row indices, not `$rowId` markers (see
 * `toRowIDPath` to convert). `null` when `el` isn't inside a field at all
 * (e.g. a sidebar button).
 *
 * Checked in one upward walk rather than two separate `closest()` calls, so
 * whichever attribute sits closest to `el` wins - e.g. a field nested inside
 * a Lexical block's sub-editor resolves to that nested field, not the
 * enclosing rich-text field's `data-field-path`.
 */
export const pathFromFieldElement = (el: HTMLElement): null | string => {
  let node: HTMLElement | null = el

  while (node) {
    const dataFieldPath = node.getAttribute('data-field-path')
    if (dataFieldPath) {
      return dataFieldPath
    }
    if (node.id.startsWith(FIELD_ID_PREFIX)) {
      return node.id.slice(FIELD_ID_PREFIX.length).replace(/__/g, '.')
    }
    node = node.parentElement
  }

  return null
}

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
export const toRowIDPath = (path: string, formState: MinimalFormState): string => {
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
/**
 * Row bookkeeping every Array/Blocks row carries in form state. Never content:
 * a `blockType` is shared by every block of its kind, so it could only ever be
 * an ambiguous match, and was sent - and logged as skipped - for every row.
 */
const STRUCTURAL_KEYS = new Set(['blockType', 'id'])

export const collectLeafValues = (formState: MinimalFormState): DocumentLeafValue[] => {
  const leaves: DocumentLeafValue[] = []

  for (const [path, field] of Object.entries(formState)) {
    if (STRUCTURAL_KEYS.has(path.slice(path.lastIndexOf('.') + 1))) {
      continue
    }

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

/**
 * How long the admin must stay completely still before a `waitForElement`
 * that opted in stops waiting for its timeout and gives up early.
 *
 * Only meaningful where nothing was triggered - see `WaitForElementOptions`.
 */
export const IDLE_GIVE_UP_MS = 250

export type WaitForElementOptions = {
  /**
   * Give up this many ms after the last sign of activity, even with budget
   * left.
   *
   * Off by default, and it has to stay that way: a caller that just *clicked*
   * something (a tab button, an accordion toggle) is waiting for a reaction,
   * and silence there means "hasn't landed yet", not "nothing is coming".
   * Payload really does mount a tab's fields a few hundred silent
   * milliseconds after the click - there is a regression test for exactly
   * that, from the last time this was a flat 250ms.
   *
   * Pass it only where the caller triggered nothing and is purely observing,
   * so that `check` - a pure function of the DOM - provably cannot start
   * answering differently on its own. There, spending the rest of the budget
   * re-evaluating it once per frame buys nothing: measured against the theme
   * playground, the last thing before the flash in five reveals out of five
   * was such a wait burning 1200-1440ms of its 1500ms budget in complete
   * silence, i.e. 45% of a ~3.1s reveal.
   */
  idleMs?: number
  /** Resolves `null` as soon as this aborts - a newer reveal took over. */
  signal?: AbortSignal
}

/**
 * Resolves with `check`'s first non-null result, polling every frame up to
 * `timeoutMs` - or until `options.idleMs` of inactivity, when the caller
 * opted into that.
 *
 * "Inactivity" is deliberately wider than "no DOM mutation": a field whose
 * chunk is still downloading has rendered its placeholder already (one
 * mutation) and then goes quiet for as long as the network takes. A finished
 * resource load therefore counts as activity too, which hands the mount that
 * follows it a fresh idle window instead of being cut off mid-flight.
 */
export const waitForElement = (
  check: () => HTMLElement | null,
  timeoutMs: number,
  { idleMs, signal }: WaitForElementOptions = {},
): Promise<HTMLElement | null> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(null)
      return
    }

    const startedAt = performance.now()
    let lastActivityAt = startedAt

    const noteActivity = () => {
      lastActivityAt = performance.now()
    }

    let mutations: MutationObserver | undefined
    let resources: PerformanceObserver | undefined

    if (idleMs !== undefined) {
      mutations = new MutationObserver(noteActivity)
      mutations.observe(document.documentElement, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      })

      try {
        resources = new PerformanceObserver(noteActivity)
        resources.observe({ entryTypes: ['resource'] })
      } catch {
        // Resource timing is unavailable - the mutation half still applies.
      }
    }

    let frame = 0

    const finish = (el: HTMLElement | null) => {
      mutations?.disconnect()
      resources?.disconnect()
      cancelAnimationFrame(frame)
      signal?.removeEventListener('abort', onAbort)
      resolve(el)
    }

    const onAbort = () => finish(null)
    signal?.addEventListener('abort', onAbort, { once: true })

    const tick = () => {
      const el = check()
      if (el) {
        finish(el)
        return
      }

      const now = performance.now()
      const idledOut = idleMs !== undefined && now - lastActivityAt >= idleMs

      if (now - startedAt >= timeoutMs || idledOut) {
        finish(null)
        return
      }

      frame = requestAnimationFrame(tick)
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
  signal?: AbortSignal,
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
      if (signal?.aborted) {
        // A newer reveal owns the tabs now - restoring the original ones
        // here would undo whatever tab *it* just switched to.
        return null
      }

      clicked.add(button)
      button.click()

      const el = await waitForElement(check, tabRenderWaitMs, { signal })
      if (el) {
        return el
      }
    }
  }

  if (signal?.aborted) {
    return null
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
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve) => {
    const startedAt = performance.now()

    const check = () => {
      if (
        signal?.aborted ||
        el.getBoundingClientRect().height > 0 ||
        performance.now() - startedAt >= timeoutMs
      ) {
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

export const waitForScrollEnd = (signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    let settled = false

    const settle = () => {
      if (settled) {
        return
      }
      settled = true
      window.removeEventListener('scrollend', settle)
      signal?.removeEventListener('abort', settle)
      clearTimeout(fallback)
      resolve()
    }

    if (signal?.aborted) {
      settle()
      return
    }

    const fallback = setTimeout(settle, SCROLL_END_FALLBACK_MS)
    window.addEventListener('scrollend', settle, { once: true })
    signal?.addEventListener('abort', settle, { once: true })
  })

/**
 * How much of `el`'s top edge is hidden behind something painted over it, in
 * pixels. `0` when nothing is.
 *
 * ## Why this exists rather than a bigger offset
 *
 * The offset is a number - 100 by default - and a number cannot be right.
 * Measured in the Payload admin: the document controls are a *sticky* bar, and
 * after a reveal the field landed at y=1 with `doc-controls__content` painted
 * over it. Raising the constant would fix that admin, at that window size,
 * until a banner appears above the bar or a site changes its chrome.
 *
 * So the question is asked of the page instead: what is actually painted where
 * the field's top is? If it is the field, or something inside or around it,
 * nothing covers it. If it is a `sticky` or `fixed` element, that element's
 * bottom edge is where the free space starts, and the difference is what has to
 * be scrolled away.
 *
 * An overlay reaching the bottom of the viewport is ignored on purpose: a modal
 * backdrop covers the field wherever it is put, and scrolling cannot uncover it
 * - only burn the correction budget trying.
 */
export const hiddenBehindOverlay = (el: HTMLElement): number => {
  const rect = el.getBoundingClientRect()

  if (rect.width === 0) {
    return 0
  }

  const x = Math.round(rect.left + Math.min(rect.width, 200) / 2)

  /*
   * Two points, and the one above the element is the one that matters.
   *
   * Probing only *inside* the element is systematically optimistic: measured,
   * a correction left the element's top at 98 with a header ending at 99, and
   * the probe at 100 found nothing to complain about. The element was flush
   * against the bar, which is not what "visible" means to a person. The point
   * just above it asks the real question — is there still something there?
   */
  const samples = [Math.round(rect.top) - 1, Math.round(rect.top) + 2]
  let lowestEdge = 0

  for (const y of samples) {
    if (y < 0 || y > window.innerHeight) {
      continue
    }

    const painted = document.elementFromPoint(x, y)

    if (!painted || painted === el || el.contains(painted) || painted.contains(el)) {
      continue
    }

    let node: Element | null = painted

    while (node && node !== document.body) {
      const { position } = window.getComputedStyle(node)

      if (position === 'fixed' || position === 'sticky') {
        const overlay = node.getBoundingClientRect()

        // An overlay that reaches the bottom of the viewport is a backdrop: it
        // covers the element wherever it is put, and scrolling cannot help.
        if (overlay.bottom < window.innerHeight) {
          lowestEdge = Math.max(lowestEdge, overlay.bottom)
        }

        break
      }

      node = node.parentElement
    }
  }

  return Math.max(0, lowestEdge - rect.top)
}

/** A little air between an overlay's edge and the element, so it reads as clear. */
export const UNCOVER_MARGIN_PX = 12

/**
 * Scrolls `el` out from under whatever covers it, if anything does.
 *
 * A loop rather than one correction, and that is measured: a header that hides
 * on scroll *reappears* when the page is scrolled up, so the first correction
 * gives back most of what it just won. One round moved the element from y=-1
 * to y=98 with the header occupying 0-99 — still one pixel short. The second
 * round is what finishes it.
 *
 * Instant, because this is not a journey: the element is already on screen and
 * this only repairs the part of "visible" that an offset cannot know.
 */
export const uncover = async (el: HTMLElement): Promise<void> => {
  for (let attempt = 0; attempt < MAX_SCROLL_CORRECTIONS; attempt++) {
    const hidden = hiddenBehindOverlay(el)

    if (hidden <= 0) {
      return
    }

    const scrollYBefore = window.scrollY

    window.scrollBy({ behavior: 'instant', top: -(hidden + UNCOVER_MARGIN_PX) })
    await waitForScrollEnd()

    // Already as far up as the page goes: retrying would only wait out the
    // scrollend fallback again.
    if (Math.abs(window.scrollY - scrollYBefore) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
      return
    }
  }
}

/** What a scroll heads for: an element, or a getter asked afresh every frame. */
export type ScrollTarget = (() => HTMLElement | null) | HTMLElement

/**
 * Where the target should end up, in pixels below the viewport top - a
 * number, or a getter asked afresh every frame (the preview's sticky header
 * can grow, shrink or hide while the page moves).
 */
export type ScrollOffset = (() => number) | number

const resolveScrollTarget = (target: ScrollTarget): HTMLElement | null =>
  typeof target === 'function' ? target() : target

const resolveOffset = (offset: ScrollOffset): number => (typeof offset === 'function' ? offset() : offset)

/** Shortest and longest a reveal's scroll animation takes, whatever the distance. */
const SCROLL_MIN_DURATION_MS = 250
const SCROLL_MAX_DURATION_MS = 550
/** Extra milliseconds per pixel travelled, between those two bounds. */
const SCROLL_MS_PER_PX = 0.08
/** Duration of the short glide that absorbs a shift after the main scroll. */
const CORRECTION_DURATION_MS = 180
/**
 * Most animation time one frame may account for. A frame the page spent
 * rendering (Payload mounting a row's fields mid-scroll) would otherwise be
 * caught up in one leap; capped, the motion slows for a moment instead.
 */
const MAX_FRAME_MS = 34

export const scrollDuration = (distance: number): number =>
  Math.min(SCROLL_MAX_DURATION_MS, SCROLL_MIN_DURATION_MS + Math.abs(distance) * SCROLL_MS_PER_PX)

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Input that means the editor is scrolling for themselves. */
const USER_SCROLL_EVENTS = ['keydown', 'touchstart', 'wheel'] as const

/**
 * Animates the page so `target` ends up `offset` below the viewport top.
 *
 * The browser's own smooth scroll can't do what a reveal needs, measured on
 * the complex dev page: it takes its time over long distances (0.7-0.9s for
 * forty sections), it aims at a position fixed when it starts, and Payload
 * shifts that position while it runs - rows expanding, deferred fields
 * mounting as they come near. The result was a second, corrective scroll
 * after every long one.
 *
 * Three things keep this one calm while the page changes under it:
 *
 * - Every frame moves a share of the distance that is *left*, re-measured
 *   then. A target that shifts (or a getter that swaps in a deeper element)
 *   bends the motion instead of making it leap - a curve over absolute
 *   positions jumped by however far the target had moved.
 * - Time is counted per frame and capped (`MAX_FRAME_MS`): after a frame the
 *   main thread spent rendering, the motion resumes where it was, instead of
 *   covering the lost time in one jump. Traced on the dev page, that jump was
 *   up to 184px in a single frame.
 * - The duration is short and capped, whatever the distance.
 */
const animateScroll = (
  target: ScrollTarget,
  offset: ScrollOffset,
  signal: AbortSignal | undefined,
  durationMs?: number,
): Promise<void> =>
  new Promise((resolve) => {
    const first = resolveScrollTarget(target)
    if (!first || signal?.aborted) {
      resolve()
      return
    }

    const duration = durationMs ?? scrollDuration(first.getBoundingClientRect().top - resolveOffset(offset))
    let elapsed = 0
    let lastFrameAt: number | undefined
    let eased = 0
    let frame = 0

    const stop = () => {
      cancelAnimationFrame(frame)
      signal?.removeEventListener('abort', stop)
      resolve()
    }

    signal?.addEventListener('abort', stop, { once: true })

    const tick = (now: number) => {
      elapsed += lastFrameAt === undefined ? 0 : Math.min(MAX_FRAME_MS, now - lastFrameAt)
      lastFrameAt = now

      const el = resolveScrollTarget(target)
      if (!el) {
        stop()
        return
      }

      const progress = Math.min(1, elapsed / duration)
      const nextEased = easeInOutCubic(progress)
      // The share of what is left that this frame covers: the eased step
      // relative to the eased distance still ahead. Exactly 1 on the last frame.
      const share = progress >= 1 ? 1 : (nextEased - eased) / (1 - eased)
      eased = nextEased

      const remaining = el.getBoundingClientRect().top - resolveOffset(offset)
      if (share > 0) {
        window.scrollBy({ behavior: 'instant', top: remaining * share })
      }

      if (progress >= 1) {
        stop()
        return
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
  })

/** The scroll `scrollToElement` currently runs - a newer one cancels it. */
let activeScroll: AbortController | undefined

/**
 * Scrolls to `target` and resolves once the page has stopped moving - or
 * right away if the target is already on screen, since nudging a visible
 * field to the exact offset isn't worth delaying its flash for; that nudge
 * finishes in the background. Callers delay revealing the field (flash,
 * focus) until this resolves.
 *
 * `preferred` chooses between animating the journey (see `animateScroll`)
 * and jumping. A reduced-motion preference always wins over it.
 *
 * Once the journey ends, the target's position is watched until it holds
 * still for a few frames and, when something mounting right after the scroll
 * moved it again, brought back - with a short glide when animating, since a
 * jump at the end of a smooth scroll is exactly the jolt it exists to avoid.
 * A correction that doesn't move the page (the target sits too close to the
 * document's end to reach `offset`) ends the loop.
 *
 * `untilSettled` waits for the end even when the target starts on screen -
 * for a caller whose next step would itself move the page.
 */
export const scrollToElement = async (
  target: ScrollTarget,
  offset: ScrollOffset = DEFAULT_SCROLL_OFFSET,
  preferred: ScrollBehavior = 'smooth',
  callerSignal?: AbortSignal,
  untilSettled = false,
): Promise<void> => {
  const el = resolveScrollTarget(target)
  if (!el) {
    return
  }

  // One scroll at a time: a scroll still finishing in the background (see
  // below) would otherwise steer the page against this one, frame by frame.
  activeScroll?.abort()
  const own = new AbortController()
  activeScroll = own
  callerSignal?.addEventListener('abort', () => own.abort(), { once: true })
  const { signal } = own

  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'instant'
    : preferred

  const { top } = el.getBoundingClientRect()
  const initialDelta = top - resolveOffset(offset)
  if (Math.abs(initialDelta) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
    return
  }

  // The editor's own wheel, touch or key input ends the scroll on the spot,
  // corrections included - steering the page against them is never right.
  const letGo = () => own.abort()
  for (const type of USER_SCROLL_EVENTS) {
    window.addEventListener(type, letGo, { passive: true })
  }

  const alreadyInViewport = top >= 0 && top <= window.innerHeight

  const settled = (async () => {
    if (behavior === 'smooth') {
      await animateScroll(target, offset, signal)
    } else {
      window.scrollBy({ behavior: 'instant', top: initialDelta })
    }

    for (let attempt = 0; attempt < MAX_SCROLL_CORRECTIONS; attempt++) {
      if (signal.aborted) {
        return
      }

      const current = resolveScrollTarget(target)
      if (!current) {
        return
      }

      await waitForStablePosition(current)
      const correctedDelta = current.getBoundingClientRect().top - resolveOffset(offset)

      if (Math.abs(correctedDelta) < SCROLL_CONVERGENCE_THRESHOLD_PX || signal.aborted) {
        return
      }

      const scrollYBefore = window.scrollY
      if (behavior === 'smooth') {
        await animateScroll(target, offset, signal, CORRECTION_DURATION_MS)
      } else {
        window.scrollBy({ behavior: 'instant', top: correctedDelta })
      }

      if (Math.abs(window.scrollY - scrollYBefore) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
        return
      }
    }
  })()

  void settled.finally(() => {
    for (const type of USER_SCROLL_EVENTS) {
      window.removeEventListener(type, letGo)
    }
  })

  if (untilSettled || !alreadyInViewport) {
    await settled
  }
}

/**
 * How far down from the viewport top the page is covered by bars that stay
 * put while it scrolls - a sticky site header, a fixed cookie bar above it -
 * over `el`'s column. `0` when nothing is.
 *
 * Asked of the page rather than configured, for the same reason as
 * `hiddenBehindOverlay`: the height of a site's header is not something this
 * plugin can know. Bars stacked on top of each other are followed down, one
 * probe below the last.
 */
export const topInset = (el: HTMLElement): number => {
  const rect = el.getBoundingClientRect()
  const x = Math.min(window.innerWidth - 1, Math.max(0, Math.round(rect.left + Math.min(rect.width, 200) / 2)))
  let inset = 0

  for (let bar = 0; bar < 3; bar++) {
    const painted = document.elementFromPoint(x, inset + 1)
    if (!painted || painted === el || el.contains(painted)) {
      break
    }

    let node: Element | null = painted
    let bottom = 0
    while (node && node !== document.body && node !== document.documentElement) {
      const { position } = window.getComputedStyle(node)
      if ((position === 'fixed' || position === 'sticky') && !node.contains(el)) {
        const box = node.getBoundingClientRect()
        // A backdrop reaching the viewport's bottom covers everything -
        // scrolling cannot get out from under it.
        if (box.bottom < window.innerHeight) {
          bottom = box.bottom
        }
        break
      }
      node = node.parentElement
    }

    if (bottom <= inset) {
      break
    }
    inset = bottom
  }

  return inset
}

const FOCUSABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]'

/**
 * Focuses the field's editable control. With a `caret` hint from the click,
 * the cursor is placed at the text position the user actually clicked rather
 * than at the start of the editor - a long rich-text field would otherwise
 * always focus at the top, leaving them to find the spot again themselves.
 * Returns the element that received the caret (for scrolling it into view),
 * or `null` when the hint couldn't be applied and this fell back to plain
 * focusing.
 */
export const focusElement = (el: HTMLElement, caret?: CaretHint): HTMLElement | null => {
  if (caret) {
    const caretEl = applyCaretHint(el, caret)
    if (caretEl) {
      return caretEl
    }
  }

  const focusable = el.matches(FOCUSABLE_SELECTOR) ? el : el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)

  focusable?.focus({ preventScroll: true })

  return null
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
