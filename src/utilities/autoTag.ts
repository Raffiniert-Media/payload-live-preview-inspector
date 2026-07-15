import type { DocumentLeafValue } from './pathResolution.js'

import { isRowIDSegment, LIVE_PREVIEW_AUTO_ATTRIBUTE, LIVE_PREVIEW_PATH_ATTRIBUTE } from './pathAttribute.js'
import { findStegaPaths, hasStegaHint, stegaClean } from './stega.js'

/** Text-bearing attributes also scanned for stega-encoded paths. */
const STEGA_ATTRIBUTES = ['alt', 'aria-label', 'placeholder', 'title']

/** Elements whose text is code/data, never rendered content. */
const SKIP_TAGS = new Set(['NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE'])

/** Minimum normalized length for value matching - shorter values are too ambiguous. */
const MIN_MATCH_LENGTH = 3

const setAutoTag = (el: Element, path: string, source: 'container' | 'match' | 'stega'): void => {
  el.setAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE, path)
  el.setAttribute(LIVE_PREVIEW_AUTO_ATTRIBUTE, source)
}

const isTaggable = (el: Element | null): el is Element =>
  el !== null && !SKIP_TAGS.has(el.tagName) && !el.hasAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)

const documentOf = (root: Document | Element): Document =>
  root.ownerDocument ?? (root)

const walkTextNodes = (root: Document | Element, visit: (node: Text) => void): void => {
  const walker = documentOf(root).createTreeWalker(root, NodeFilter.SHOW_TEXT)

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
 * The topmost tagged element at a viewport point, looking *through* elements
 * that merely cover it - e.g. a full-card overlay link (`<a class="absolute
 * inset-0">`) that swallows every pointer event, so the tagged heading/text
 * beneath it never becomes an event target. `elementsFromPoint` returns the
 * whole stack at the point (topmost first), obscured elements included.
 */
export const findTaggedElementAt = (doc: Document, x: number, y: number): HTMLElement | null => {
  if (typeof doc.elementsFromPoint !== 'function') {
    return null
  }

  for (const el of doc.elementsFromPoint(x, y)) {
    if (el instanceof HTMLElement && el.hasAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)) {
      return el
    }
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
