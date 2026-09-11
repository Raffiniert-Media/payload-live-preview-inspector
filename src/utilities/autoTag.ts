import type { DocumentLeafValue } from './pathResolution.js'

import { collapsedTextOf, NON_CONTENT_TAGS } from './caret.js'
import { isRowIDSegment, LIVE_PREVIEW_AUTO_ATTRIBUTE, LIVE_PREVIEW_PATH_ATTRIBUTE } from './pathAttribute.js'
import { findStegaPaths, hasStegaHint, stegaClean } from './stega.js'

/** Text-bearing attributes also scanned for stega-encoded paths. */
const STEGA_ATTRIBUTES = ['alt', 'aria-label', 'placeholder', 'title']

/** Minimum normalized length for value matching - shorter values are too ambiguous. */
const MIN_MATCH_LENGTH = 3

const setAutoTag = (el: Element, path: string, source: 'container' | 'match' | 'stega'): void => {
  el.setAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE, path)
  el.setAttribute(LIVE_PREVIEW_AUTO_ATTRIBUTE, source)
}

const isTaggable = (el: Element | null): el is Element =>
  el !== null && !NON_CONTENT_TAGS.has(el.tagName) && !el.hasAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)

const documentOf = (root: Document | Element): Document =>
  root.ownerDocument ?? (root)

/**
 * Every text node under `root` that is rendered content - the contents of
 * script, style, template and noscript elements are skipped.
 *
 * `isTaggable` already refuses to tag an element inside one of those, so this
 * changes no outcome; what it removes is the work of getting there. A Next.js
 * page carries its RSC flight payload in inline `<script>` tags, and those
 * are single text nodes tens or hundreds of kilobytes long - measured at
 * 452KB on one twelve-section page, i.e. more than 99% of all text in the
 * document. Value matching normalizes every text node it is handed (a regex
 * pass plus two string allocations), and the scan runs on every render batch
 * of a live preview, so that payload was being rewritten several times a
 * second to be thrown away.
 */
const walkTextNodes = (root: Document | Element, visit: (node: Text) => void): void => {
  const walker = documentOf(root).createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && NON_CONTENT_TAGS.has(node.parentElement.tagName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })

  let node = walker.nextNode()
  while (node) {
    visit(node as Text)
    node = walker.nextNode()
  }
}

const elementsWithAttributes = (root: Document | Element): Element[] => {
  const selector = STEGA_ATTRIBUTES.map((attr) => `[${attr}]`).join(',')
  const elements = Array.from(root.querySelectorAll(selector))
  if (root instanceof Element && root.matches(selector)) {
    elements.unshift(root)
  }
  return elements
}

/**
 * Decodes stega-encoded paths from rendered text (and a few text-bearing
 * attributes) and tags each containing element. Elements that already carry
 * a path attribute - explicit `pathOf()` tagging or an earlier pass - are
 * left untouched.
 */
export const scanStega = (root: Document | Element): void => {
  walkTextNodes(root, (node) => {
    const text = node.nodeValue
    if (!text || !hasStegaHint(text)) {
      return
    }

    const el = node.parentElement
    if (!isTaggable(el)) {
      return
    }

    const [path] = findStegaPaths(text)
    if (path) {
      setAutoTag(el, path, 'stega')
    }
  })

  for (const el of elementsWithAttributes(root)) {
    if (!isTaggable(el)) {
      continue
    }

    for (const attr of STEGA_ATTRIBUTES) {
      const value = el.getAttribute(attr)
      if (!value || !hasStegaHint(value)) {
        continue
      }

      const [path] = findStegaPaths(value)
      if (path) {
        setAutoTag(el, path, 'stega')
        break
      }
    }
  }
}

const normalizeText = (text: string): string => stegaClean(text).replace(/\s+/g, ' ').trim()

/** Ambiguous values already reported, so the dev-only notice logs once per value. */
const warnedAmbiguousValues = new Set<string>()

/** Dev-only: say *why* a value can never be matched (scans rerun constantly, so log once). */
const warnAmbiguousValues = (leaves: DocumentLeafValue[], pathByValue: Map<string, null | string>): void => {
  const ambiguous = new Map<string, string[]>()

  for (const { path, value } of leaves) {
    const normalized = normalizeText(value)
    if (pathByValue.get(normalized) !== null || warnedAmbiguousValues.has(normalized)) {
      continue
    }
    const paths = ambiguous.get(normalized) ?? []
    if (!paths.includes(path)) {
      paths.push(path)
    }
    ambiguous.set(normalized, paths)
  }

  for (const [value, paths] of ambiguous) {
    warnedAmbiguousValues.add(value)
    const excerpt = value.length > 80 ? `${value.slice(0, 80)}…` : value
    // eslint-disable-next-line no-console -- intentional dev-only diagnostic
    console.info(
      `[payload-live-preview-inspector] Value matching skipped "${excerpt}": the fields ${paths.join(', ')} share this exact value, so a match would be ambiguous. Tag the element with pathOf() or render it through the stega proxy.`,
    )
  }
}

/**
 * Tags elements whose entire text content equals a document field's value -
 * the zero-config layer that needs no frontend data changes at all. Only
 * unambiguous values are used: a value shared by several fields is skipped,
 * and only whole-text-node matches count. Never overwrites existing tags.
 */
export const applyValueMatching = (root: Document | Element, leaves: DocumentLeafValue[]): void => {
  // A value mapping to more than one path is ambiguous - mark it `null`.
  const pathByValue = new Map<string, null | string>()

  for (const { path, value } of leaves) {
    const normalized = normalizeText(value)
    if (normalized.length < MIN_MATCH_LENGTH) {
      continue
    }
    const existing = pathByValue.get(normalized)
    pathByValue.set(normalized, existing === undefined || existing === path ? path : null)
  }

  if (process.env.NODE_ENV !== 'production') {
    warnAmbiguousValues(leaves, pathByValue)
  }

  if (pathByValue.size === 0) {
    return
  }

  walkTextNodes(root, (node) => {
    const text = node.nodeValue
    if (!text) {
      return
    }

    const normalized = normalizeText(text)
    if (normalized.length < MIN_MATCH_LENGTH) {
      return
    }

    const path = pathByValue.get(normalized)
    if (!path) {
      return
    }

    const el = node.parentElement
    if (isTaggable(el)) {
      setAutoTag(el, path, 'match')
    }
  })
}

/**
 * The most specific tagged element at a viewport point, looking *through*
 * elements that merely cover it - e.g. a full-card overlay link (`<a
 * class="absolute inset-0">`) that swallows every pointer event, so the
 * tagged heading/text beneath it never becomes an event target.
 * `elementsFromPoint` returns the whole stack at the point (topmost first),
 * obscured elements included.
 *
 * "Most specific" = smallest bounding box first: the overlay itself is
 * often tagged too (its `aria-label` carries e.g. a link label's stega
 * path), and since it spans the whole card, always preferring the topmost
 * element would resolve every point on the card to the link. The card-sized
 * overlay only wins where no smaller tagged element sits underneath.
 *
 * Ties (equal-sized boxes - e.g. a wrapper that tightly hugs its only
 * child, so parent and child share the same rect) go to the element with
 * the deeper (longer) path: a leaf field's path is always at least as long
 * as its containing row's, so this prefers the more specific target over a
 * same-sized container without depending on DOM/paint order, which - unlike
 * path length - doesn't reliably correlate with semantic specificity for
 * siblings (an overlay `<a>` and a content `<p>` are siblings, not
 * ancestor/descendant).
 */
export const findTaggedElementAt = (doc: Document, x: number, y: number): HTMLElement | null => {
  if (typeof doc.elementsFromPoint !== 'function') {
    return null
  }

  let best: HTMLElement | null = null
  let bestArea = Infinity
  let bestDepth = -1

  for (const el of doc.elementsFromPoint(x, y)) {
    if (!(el instanceof HTMLElement)) {
      continue
    }
    const path = el.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)
    if (path === null) {
      continue
    }

    const rect = el.getBoundingClientRect()
    const area = rect.width * rect.height
    const depth = path.split('.').length

    if (area < bestArea || (area === bestArea && depth > bestDepth)) {
      best = el
      bestArea = area
      bestDepth = depth
    }
  }

  return best
}

const escapeAttributeValue = (value: string): string => value.replace(/["\\]/g, '\\$&')

const elementWithExactPath = (doc: Document, path: string): HTMLElement | null =>
  doc.querySelector<HTMLElement>(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}="${escapeAttributeValue(path)}"]`)

/**
 * The element under `path` whose own text holds the caret's surroundings.
 * Candidates are scanned in document order, so a paragraph is preferred over
 * an inline run tagged inside it. When the caret's context is *wider* than
 * any single one of them - the admin sends a whole paragraph, the preview
 * tagged only the words stega could encode - the longest run contained in it
 * wins instead; anything shorter than `MIN_MATCH_LENGTH` is too weak to be
 * evidence of anything.
 */
const elementRenderingCaret = (doc: Document, path: string, caretText: string): HTMLElement | null => {
  const candidates = doc.querySelectorAll<HTMLElement>(
    `[${LIVE_PREVIEW_PATH_ATTRIBUTE}="${escapeAttributeValue(path)}"], [${LIVE_PREVIEW_PATH_ATTRIBUTE}^="${escapeAttributeValue(`${path}.`)}"]`,
  )

  let widestContained: HTMLElement | null = null
  let widestLength = 0

  for (const candidate of candidates) {
    const text = collapsedTextOf(candidate)

    if (text.length > 0 && text.includes(caretText)) {
      return candidate
    }
    if (text.length > widestLength && text.length >= MIN_MATCH_LENGTH && caretText.includes(text)) {
      widestContained = candidate
      widestLength = text.length
    }
  }

  return widestContained
}

/**
 * Finds the tagged element that best matches an admin-side field path:
 *
 * - the element rendering the text around `caretText`, when the admin knew
 *   where in the field its caret was. Every run of a rich-text field carries
 *   a path under the same field, so without this a focused editor can only
 *   ever point at the first of them.
 * - a descendant whose path runs deeper into the field's value, tried next -
 *   a rich-text field's own value can carry both stega paths deep inside its
 *   Lexical JSON tree (`body.root.children...`, one per real paragraph) *and*
 *   an exact match on the field's own path (a single-word run that only
 *   value matching, not stega, could tag - see `collectLeafValues`); the
 *   deeper path is the more meaningful place to land.
 * - an exact match otherwise, or
 * - the nearest tagged ancestor - a field whose own leaf isn't separately
 *   tagged (e.g. one of several fields inside a block that only the block
 *   container carries a path for).
 */
export const findTaggedElementByPath = (doc: Document, path: string, caretText?: string): HTMLElement | null => {
  if (caretText) {
    const rendering = elementRenderingCaret(doc, path, caretText)
    if (rendering) {
      return rendering
    }
  }

  const nested = doc.querySelector<HTMLElement>(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}^="${escapeAttributeValue(`${path}.`)}"]`)
  if (nested) {
    return nested
  }

  const exact = elementWithExactPath(doc, path)
  if (exact) {
    return exact
  }

  let segments = path.split('.').slice(0, -1)

  while (segments.length > 0) {
    const ancestor = elementWithExactPath(doc, segments.join('.'))
    if (ancestor) {
      return ancestor
    }
    segments = segments.slice(0, -1)
  }

  return null
}

const commonAncestor = (els: Element[]): Element | null => {
  let ancestor: Element | null = els[0]

  for (const el of els.slice(1)) {
    while (ancestor && !ancestor.contains(el)) {
      ancestor = ancestor.parentElement
    }
    if (!ancestor) {
      return null
    }
  }

  return ancestor
}

/**
 * Infers Array/Blocks row containers from already-tagged leaf elements: all
 * leaves sharing a `$rowId` path prefix vote for their closest common
 * ancestor as that row's container, so clicking a block's padding jumps to
 * the whole row - without anyone writing `pathOf(block)`. Conservative by
 * design: a candidate containing tags from a different row (interleaved
 * markup), an already-tagged element, or `<body>` itself is never used.
 */
export const inferBlockContainers = (doc: Document): void => {
  const tagged = Array.from(doc.querySelectorAll(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}]`))
  const existingPaths = new Set<string>()
  const leavesByRowPath = new Map<string, Element[]>()

  for (const el of tagged) {
    const path = el.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)
    if (!path) {
      continue
    }

    existingPaths.add(path)

    const segments = path.split('.')
    for (let i = 0; i < segments.length - 1; i++) {
      if (!isRowIDSegment(segments[i])) {
        continue
      }
      const rowPath = segments.slice(0, i + 1).join('.')
      const group = leavesByRowPath.get(rowPath) ?? []
      group.push(el)
      leavesByRowPath.set(rowPath, group)
    }
  }

  for (const [rowPath, leaves] of leavesByRowPath) {
    if (existingPaths.has(rowPath)) {
      continue
    }

    const candidate = leaves.length === 1 ? leaves[0].parentElement : commonAncestor(leaves)
    if (
      !candidate ||
      candidate === doc.body ||
      candidate === doc.documentElement ||
      candidate.hasAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)
    ) {
      continue
    }

    const impure = Array.from(candidate.querySelectorAll(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}]`)).some((el) => {
      const path = el.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)
      return path !== rowPath && !path?.startsWith(`${rowPath}.`)
    })
    if (impure) {
      continue
    }

    setAutoTag(candidate, rowPath, 'container')
  }
}
