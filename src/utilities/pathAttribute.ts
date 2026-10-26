/**
 * Add this attribute to any element in your frontend that should be
 * clickable/highlightable in Payload's live preview. Set it via
 * `pathOf()`/`inspectable()` (recommended) rather than by hand.
 */
export const LIVE_PREVIEW_PATH_ATTRIBUTE = 'data-payload-live-preview-path'

/**
 * Set (alongside the path attribute) on elements the plugin tagged
 * automatically - via stega decoding (`"stega"`), value matching
 * (`"match"`), or block-container inference (`"container"`) - never on
 * elements tagged explicitly via `pathOf()`. Auto-tagging never overwrites a
 * path attribute that exists without this marker, so explicit tagging always
 * wins.
 */
export const LIVE_PREVIEW_AUTO_ATTRIBUTE = 'data-payload-live-preview-auto'

/**
 * Marks a path segment as an Array/Blocks row `id` rather than its current
 * index - the admin listener resolves it to whatever index that row
 * currently has before looking up the DOM element.
 */
const ROW_ID_MARKER = '$'

export const rowIDSegment = (rowId: string): string => `${ROW_ID_MARKER}${rowId}`

export const isRowIDSegment = (segment: string): boolean => segment.startsWith(ROW_ID_MARKER)

export const rowIDFromSegment = (segment: string): string => segment.slice(ROW_ID_MARKER.length)

/**
 * The row a tagged path lies in - its deepest row-id segment (`a.$1.b.$2.c` →
 * `a.$1.b.$2`) - or `null` for a path outside every row.
 */
export const rowIDPathOf = (path: string): null | string => {
  const segments = path.split('.')
  for (let end = segments.length; end > 0; end--) {
    if (isRowIDSegment(segments[end - 1])) {
      return segments.slice(0, end).join('.')
    }
  }
  return null
}

/**
 * A path's first segment when what it names is not in the edited document but
 * in another one the page shows - a post a block queried by itself - as
 * `@<collection>:<id>`: `@posts:12.title` is the title of post 12, `@posts:12`
 * the post.
 *
 * In front of the path rather than beside it, so everything that reads a path
 * by its prefixes - the smallest tagged element, the element for a focused
 * field, a row's container - treats a document as the container of its own
 * fields without knowing about documents at all. The edited document's own
 * paths never start with `@`.
 *
 * A string id is marked (`~`) so it stays a string: `"12"` and `12` are two
 * documents in a collection with custom ids. Whatever in an id could pass for
 * a separator (`.`, `:`) is percent-encoded, and so is everything else outside
 * `[A-Za-z0-9_-]` - a slug never has it, an id may.
 */
const DOCUMENT_MARKER = '@'
const STRING_ID_MARKER = '~'

export type DocumentRef = { collection: string; id: number | string }

const encodeIDText = (text: string): string =>
  encodeURIComponent(text).replace(/[!'()*.~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

export const documentSegment = ({ id, collection }: DocumentRef): string =>
  `${DOCUMENT_MARKER}${collection}:${typeof id === 'number' ? String(id) : `${STRING_ID_MARKER}${encodeIDText(id)}`}`

/**
 * The document a path starts in and the path inside it (`''` for the
 * document itself), or `null` for a path in the edited document - and for
 * anything malformed, which is then simply nobody's.
 */
export const parseDocumentPath = (path: string): ({ path: string } & DocumentRef) | null => {
  if (!path.startsWith(DOCUMENT_MARKER)) {
    return null
  }
  const dot = path.indexOf('.')
  const head = path.slice(DOCUMENT_MARKER.length, dot === -1 ? undefined : dot)
  const colon = head.indexOf(':')
  const collection = head.slice(0, Math.max(colon, 0))
  const idText = head.slice(colon + 1)
  if (colon <= 0 || !idText || !/^[\w-]+$/.test(collection)) {
    return null
  }
  let id: number | string
  if (idText.startsWith(STRING_ID_MARKER)) {
    try {
      id = decodeURIComponent(idText.slice(STRING_ID_MARKER.length))
    } catch {
      return null
    }
  } else if (/^\d+$/.test(idText)) {
    id = Number(idText)
  } else {
    return null
  }
  return { id, collection, path: dot === -1 ? '' : path.slice(dot + 1) }
}

export const isDocumentPath = (path: string): boolean => parseDocumentPath(path) !== null

/**
 * `value` as the inside of a quoted CSS string: quotes and backslashes
 * escaped, and line breaks too - unescaped, one ends the string and the
 * selector throws.
 */
export const escapeAttributeValue = (value: string): string =>
  value.replace(/["\\]/g, '\\$&').replace(/[\n\r\f]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `)
