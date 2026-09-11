import type { CaretHint } from './caret.js'

import { applyCaretHint } from './caret.js'
import { isRowIDSegment, rowIDFromSegment, rowIDSegment } from './pathAttribute.js'

/** Structurally compatible with `@payloadcms/ui`'s `FormState`, without depending on it. */
export type MinimalFormState = Record<string, { rows?: Array<{ id: string }>; value?: unknown } | undefined>

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
  { idleMs }: WaitForElementOptions = {},
): Promise<HTMLElement | null> =>
  new Promise((resolve) => {
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

    const finish = (el: HTMLElement | null) => {
      mutations?.disconnect()
      resources?.disconnect()
      resolve(el)
    }

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

export const waitForScrollEnd = (): Promise<void> =>
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

/**
 * Scrolls to `el` and resolves once the scroll actually finishes (via
 * the `scrollend` event, with a timeout fallback for browsers that don't
 * fire it), or immediately if the field is already visible in the viewport.
 * Callers use this to delay revealing the field (flash/focus) until the page
 * has stopped moving. A field that's already on screen is rarely
 * pixel-perfect at `offset`, so still nudging it there is worthwhile, but
 * not worth delaying the reveal over - that nudge just happens in the
 * background.
 *
 * `preferred` chooses between animating the journey and jumping. Animating
 * is the default because the motion is what tells the editor where the form
 * went, but it is also the single most expensive part of a reveal - measured
 * in the theme playground at 0.9-1.3s of a ~1.8s reveal, since the flash
 * waits for the page to stop moving. A reduced-motion preference always
 * wins over `preferred`.
 *
 * The initial delta is measured before the scroll runs, so anything that
 * shifts layout while a long scroll animation is in flight (an accordion
 * still rendering, images/fonts loading in) can leave the element short of
 * `offset` once it stops. Rather than requiring the user to click again,
 * this re-measures once the scroll settles and issues further corrections -
 * instant ones, see below - until the position converges or the retry budget
 * runs out.
 */
export const scrollToElement = async (
  el: HTMLElement,
  offset: number = DEFAULT_SCROLL_OFFSET,
  preferred: ScrollBehavior = 'smooth',
): Promise<void> => {
  const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'instant'
    : preferred

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
    // Corrections are instant even when the journey above was animated.
    // Animating them used to be the rule, so that a correction could not look
    // like an abrupt jump at the end of a smooth scroll - but a correction is
    // not a journey. It compensates for layout that shifted *during* the
    // scroll (an accordion still rendering, an image arriving), so the
    // element is already on screen and the remaining delta is small; and the
    // animation is the expensive part. Measured in the theme playground: the
    // scroll phase of a reveal took 0.9-1.6s, because each correction chained
    // another ~300-500ms of smooth animation onto the previous one, with the
    // reveal waiting on `scrollend` for every single one.
    window.scrollBy({ behavior: 'instant', top: correctedDelta })
    await waitForScrollEnd()

    // The page didn't move: the target can't reach the offset at all (e.g.
    // it sits near the bottom of the document). Retrying would just burn
    // the remaining attempts against the scrollend fallback timeout.
    if (Math.abs(window.scrollY - scrollYBefore) < SCROLL_CONVERGENCE_THRESHOLD_PX) {
      return
    }
  }
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
