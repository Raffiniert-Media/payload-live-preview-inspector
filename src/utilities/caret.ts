/**
 * Carries the *position within a field's text* from the Live Preview iframe to
 * the admin panel, so clicking into the middle of a paragraph puts the caret
 * there instead of at the top of the editor.
 *
 * Both sides render the same text but never the same DOM: the preview splits
 * it across its own inline markup, indents it with whatever whitespace the
 * template produced, and (with stega tagging on) sprinkles invisible path
 * characters into it, while the admin renders Lexical's own element tree. A
 * raw DOM offset therefore means nothing across the boundary.
 *
 * The shared ground truth is the *collapsed text*: stega blocks removed and
 * every whitespace run reduced to a single space, built by the same code on
 * both sides. Each collapsed character keeps the DOM position it came from, so
 * an offset measured in the preview can be mapped back onto whichever text
 * node holds that character in the admin - independent of which tagging layer
 * (stega, value matching, `pathOf`) resolved the click.
 */

import { stegaBlockLengthAt } from './stega.js'

/** A clicked text position, expressed in collapsed-text terms. */
export type CaretHint = {
  /** Offset of the caret within `text`. */
  offset: number
  /** Collapsed text around the caret, used to locate it again in the editor. */
  text: string
}

/** A position inside a DOM text node: the raw (uncollapsed) offset in `node`. */
export type CaretPosition = { node: Text; offset: number }

export type CollapsedIndex = {
  /** DOM position of every collapsed character, plus one past the last. */
  positions: CaretPosition[]
  text: string
}

/** Elements whose text is code/data, never rendered content. */
export const NON_CONTENT_TAGS = new Set(['NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE'])

/**
 * How much collapsed text is sent as context around the caret. Long enough to
 * be unique within an editor in practice, short enough to keep the
 * postMessage payload small even for book-length rich text.
 */
const CARET_CONTEXT_CHARS = 120

const WHITESPACE = /\s/

const TEXT_INPUT_TYPES = new Set(['email', 'password', 'search', 'tel', 'text', 'url'])

const EDITABLE_SELECTOR = '[contenteditable="true"]'

/**
 * Accumulates collapsed text across several source strings (the text nodes of
 * one element, or a single input value), reporting the raw offset of every
 * character it emits. Whitespace state is kept *between* `feed` calls, so a
 * run split across two text nodes still collapses to one space.
 */
const createCollapser = () => {
  let text = ''
  let pendingSpace = false

  return {
    /** Appends `raw`, calling `emit` (when given) once per emitted character. */
    feed(raw: string, emit?: (rawOffset: number) => void): void {
      for (let i = 0; i < raw.length; ) {
        const stegaLength = stegaBlockLengthAt(raw, i)
        if (stegaLength > 0) {
          i += stegaLength
          continue
        }

        if (WHITESPACE.test(raw[i])) {
          pendingSpace = true
          i += 1
          continue
        }

        // Flushed only now, so trailing whitespace never makes it into the
        // collapsed text and leading whitespace is dropped entirely.
        if (pendingSpace) {
          pendingSpace = false
          if (text.length > 0) {
            text += ' '
            emit?.(i)
          }
        }

        text += raw[i]
        emit?.(i)
        i += 1
      }
    },
    get text(): string {
      return text
    },
  }
}

/** Collapsed form of a plain string, with the raw offset of each character. */
const collapseString = (raw: string): { offsets: number[]; text: string } => {
  const collapser = createCollapser()
  const offsets: number[] = []

  collapser.feed(raw, (rawOffset) => offsets.push(rawOffset))

  return { offsets, text: collapser.text }
}

/** Walks `root`'s rendered text nodes, skipping code/data elements. */
const textWalker = (root: Element): TreeWalker =>
  root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement && NON_CONTENT_TAGS.has(node.parentElement.tagName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })

/**
 * Collapsed text of `root`'s rendered content - the same string
 * `buildCollapsedIndex` produces, without the per-character DOM index. Worth
 * its own function where only the text is compared (matching a caret's
 * context against every tagged run of a field): the index costs one object
 * per character, which for a book-length rich text is tens of thousands of
 * allocations per lookup, all of them thrown away.
 */
export const collapsedTextOf = (root: Element): string => {
  const walker = textWalker(root)
  const collapser = createCollapser()

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    collapser.feed((node as Text).data)
  }

  return collapser.text
}

/** Collapsed text of `root`'s rendered content, keyed back to its text nodes. */
export const buildCollapsedIndex = (root: Element): CollapsedIndex => {
  const walker = textWalker(root)
  const collapser = createCollapser()
  const positions: CaretPosition[] = []

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text
    collapser.feed(textNode.data, (rawOffset) => positions.push({ node: textNode, offset: rawOffset }))
  }

  // Sentinel for a caret *after* the last character. A collapsed space is only
  // ever emitted right before a real character, so the last position is always
  // a real one and advancing it by one code unit stays inside its node.
  const tail = positions[positions.length - 1]
  if (tail) {
    positions.push({ node: tail.node, offset: tail.offset + 1 })
  }

  return { positions, text: collapser.text }
}

/** Collapsed offset of a DOM position, or `null` when the index is empty. */
export const collapsedOffsetAt = (index: CollapsedIndex, node: Node, rawOffset: number): null | number => {
  if (index.positions.length === 0) {
    return null
  }

  for (let i = 0; i < index.positions.length; i++) {
    const position = index.positions[i]

    if (position.node === node) {
      if (position.offset >= rawOffset) {
        return i
      }
      continue
    }

    // Positions are in document order, so the first one *after* `node` means
    // we've passed the target without landing on it (all of `node`'s own
    // characters were collapsed away, e.g. a whitespace-only text node).
    if (node.compareDocumentPosition(position.node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return i
    }
  }

  return index.positions.length - 1
}

type PointCaret = { node: Node; offset: number }

/** The text position under a viewport point, across both browser APIs. */
const caretFromPoint = (doc: Document, x: number, y: number): null | PointCaret => {
  const withPosition = doc as {
    caretPositionFromPoint?: (x: number, y: number) => { offset: number; offsetNode: Node } | null
  } & Document
  if (typeof withPosition.caretPositionFromPoint === 'function') {
    const position = withPosition.caretPositionFromPoint(x, y)
    return position ? { node: position.offsetNode, offset: position.offset } : null
  }

  // WebKit's older, non-standard equivalent.
  const withRange = doc as { caretRangeFromPoint?: (x: number, y: number) => null | Range } & Document
  if (typeof withRange.caretRangeFromPoint === 'function') {
    const range = withRange.caretRangeFromPoint(x, y)
    return range ? { node: range.startContainer, offset: range.startOffset } : null
  }

  return null
}

/** Squared distance from a point to a rect (0 when inside it). */
const rectDistance = (rect: DOMRect, x: number, y: number): number => {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0
  return dx * dx + dy * dy
}

const textNodesOf = (root: Element): Text[] => {
  const walker = textWalker(root)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text)
  }
  return nodes
}

/** Cap on the per-character rect scan, so a huge container can't stall a click. */
const MAX_GEOMETRY_CHARS = 4000

/**
 * The text position nearest to `(x, y)` *within* `root`, measured from the
 * rendered character rects. The browser's own hit test can't be used here: it
 * answers for whatever paints on top, which for the full-card overlay link
 * pattern (`<a class="absolute inset-0">`) is an element with no text at all -
 * the same reason `findTaggedElementAt` resolves the click through
 * `elementsFromPoint` rather than the event target. This measures the text we
 * know the click belongs to instead, and doubles as the answer for clicks on
 * a block's padding (nearest character wins) and for browsers without a
 * caret-from-point API.
 */
const caretFromGeometry = (root: Element, x: number, y: number): null | PointCaret => {
  const nodes = textNodesOf(root)
  if (nodes.length === 0) {
    return null
  }

  const range = root.ownerDocument.createRange()

  const nearestOf = (measure: (index: number) => DOMRect[], count: number, node: Text) => {
    let best: { distance: number; offset: number } | null = null

    for (let i = 0; i < count; i++) {
      for (const rect of measure(i)) {
        if (rect.width === 0 && rect.height === 0) {
          continue
        }
        const distance = rectDistance(rect, x, y)
        if (!best || distance < best.distance) {
          // Snap to whichever side of the character the point is nearer.
          best = { distance, offset: x > rect.left + rect.width / 2 ? i + 1 : i }
        }
      }
    }

    return best && { ...best, node }
  }

  // Two passes: whole nodes first (cheap), then characters inside the winner.
  let bestNode: { distance: number; node: Text } | null = null
  for (const node of nodes) {
    range.selectNodeContents(node)
    const nearest = nearestOf(() => Array.from(range.getClientRects()), 1, node)
    if (nearest && (!bestNode || nearest.distance < bestNode.distance)) {
      bestNode = { distance: nearest.distance, node }
    }
  }

  if (!bestNode) {
    return null
  }

  const { node } = bestNode
  const nearest = nearestOf(
    (i) => {
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      return Array.from(range.getClientRects())
    },
    Math.min(node.data.length, MAX_GEOMETRY_CHARS),
    node,
  )

  return nearest ? { node, offset: nearest.offset } : null
}

const isInline = (el: Element): boolean => {
  const display = el.ownerDocument.defaultView?.getComputedStyle(el).display ?? ''
  return display.startsWith('inline') || display === 'contents'
}

/**
 * The nearest block-level ancestor of a caret's node - the unit whose text is
 * sent as context. Deliberately not limited to the tagged element: stega tags
 * whatever element directly contains the encoded text run, which for
 * `<p>Hello <strong>world</strong></p>` can be the inline `<strong>`, and a
 * single word is far too weak an anchor to find again. `boundary`, where
 * given, is as far as the climb may go - an editor's own root, so a caret in
 * an empty paragraph can't widen the context out to the whole form.
 */
const nearestBlock = (node: Node, fallback: Element, boundary?: Element): Element => {
  const doc = fallback.ownerDocument
  let el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement

  while (el && el !== boundary && el !== doc.body && el !== doc.documentElement && isInline(el)) {
    el = el.parentElement
  }

  return !el || el === doc.body || el === doc.documentElement ? fallback : el
}

/** The window of collapsed text sent as context around `offset`. */
const hintAround = (text: string, offset: number): CaretHint => {
  const start = Math.max(0, offset - CARET_CONTEXT_CHARS)

  return { offset: offset - start, text: text.slice(start, Math.min(text.length, offset + CARET_CONTEXT_CHARS)) }
}

/**
 * Preview side: describes the text position clicked at `(x, y)`, or `null`
 * when there is none to describe. `within` is the tagged element the click
 * resolved to; a caret outside it means the point actually hit something else
 * stacked on top (`findTaggedElementAt` deliberately looks *through* covering
 * overlays), so the browser's answer says nothing about the field we're about
 * to reveal - the position is then measured from `within`'s own text instead.
 */
export const caretHintFromPoint = (doc: Document, x: number, y: number, within: Element): CaretHint | null => {
  const hit = caretFromPoint(doc, x, y)
  const caret =
    hit && hit.node.nodeType === Node.TEXT_NODE && within.contains(hit.node)
      ? hit
      : caretFromGeometry(within, x, y)

  if (!caret) {
    return null
  }

  const index = buildCollapsedIndex(nearestBlock(caret.node, within))
  if (index.text.length === 0) {
    return null
  }

  const offset = collapsedOffsetAt(index, caret.node, caret.offset)

  return offset === null ? null : hintAround(index.text, offset)
}

/**
 * Admin side: describes where the caret currently sits inside `el` - the
 * mirror image of `caretHintFromPoint`, built from the same collapsed text so
 * that the preview can find the element rendering that very paragraph. A
 * focused field otherwise identifies itself by its path alone, which in a
 * rich text matches every run the preview renders from it, and the first one
 * wins - paragraphs away from where the editor is actually working.
 *
 * Only contenteditable editors are described: a single-input field's whole
 * value is one tagged element in the preview, so its path already points at
 * exactly the right one. `null` when there is no caret to describe - nothing
 * selected, an empty editor, or a selection that still belongs to the field
 * being left (focus events arrive before the browser moves it).
 */
export const caretHintFromSelection = (el: HTMLElement): CaretHint | null => {
  const editable = el.closest<HTMLElement>(EDITABLE_SELECTOR)
  if (!editable) {
    return null
  }

  const selection = editable.ownerDocument.defaultView?.getSelection()
  const anchor = selection?.anchorNode
  if (!selection || !anchor || !editable.contains(anchor)) {
    return null
  }

  const index = buildCollapsedIndex(nearestBlock(anchor, editable, editable))
  if (index.text.length === 0) {
    return null
  }

  const offset = collapsedOffsetAt(index, anchor, selection.anchorOffset)

  return offset === null ? null : hintAround(index.text, offset)
}

const applyCaretToInput = (el: HTMLInputElement | HTMLTextAreaElement, hint: CaretHint): HTMLElement | null => {
  if (el instanceof HTMLInputElement && !TEXT_INPUT_TYPES.has(el.type)) {
    return null
  }

  const { offsets, text } = collapseString(el.value)
  const start = text.indexOf(hint.text)
  if (start === -1) {
    return null
  }

  const target = start + hint.offset
  const rawOffset = target < offsets.length ? offsets[target] : el.value.length

  el.focus({ preventScroll: true })
  el.setSelectionRange(rawOffset, rawOffset)

  return el
}

const applyCaretToEditable = (root: HTMLElement, hint: CaretHint): HTMLElement | null => {
  const index = buildCollapsedIndex(root)
  const start = index.text.indexOf(hint.text)
  if (start === -1) {
    return null
  }

  const position = index.positions[Math.min(start + hint.offset, index.positions.length - 1)]
  const selection = root.ownerDocument.defaultView?.getSelection()
  if (!position || !selection) {
    return null
  }

  // Lexical block nodes render nested editors of their own, so the element
  // that owns the caret isn't necessarily the one we searched from - focus the
  // innermost editable, or the selection lands in a field nobody is editing.
  const editable = position.node.parentElement?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? root
  editable.focus({ preventScroll: true })

  const range = root.ownerDocument.createRange()
  range.setStart(position.node, Math.min(position.offset, position.node.data.length))
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)

  return position.node.parentElement ?? editable
}

/**
 * Admin side: places the caret described by `hint` inside `el`, returning the
 * element that ended up holding it (so callers can scroll it into view), or
 * `null` when the text can't be found - a stale preview, a field whose value
 * changed since the click, or an element that simply isn't editable text.
 * Callers fall back to plain focusing in that case.
 *
 * Rich text goes through the native selection rather than Lexical's API:
 * Lexical reconciles `selectionchange` into its own `RangeSelection`, so this
 * needs no editor instance and works for any contenteditable-based editor.
 * Where a text window occurs more than once, the first occurrence wins.
 */
export const applyCaretHint = (el: HTMLElement, hint: CaretHint): HTMLElement | null => {
  const editable = el.matches(EDITABLE_SELECTOR) ? el : el.querySelector<HTMLElement>(EDITABLE_SELECTOR)
  if (editable) {
    return applyCaretToEditable(editable, hint)
  }

  const input = el.matches('input, textarea') ? el : el.querySelector('input, textarea')
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
    return applyCaretToInput(input, hint)
  }

  return null
}

/** Validates a `caret` payload received over `postMessage`. */
export const parseCaretHint = (value: unknown): CaretHint | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const { offset, text } = value as Partial<CaretHint>

  return typeof text === 'string' && typeof offset === 'number' && Number.isInteger(offset) && offset >= 0
    ? { offset, text }
    : undefined
}
