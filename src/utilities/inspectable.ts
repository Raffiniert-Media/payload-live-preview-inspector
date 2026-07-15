import { LIVE_PREVIEW_PATH_ATTRIBUTE, rowIDSegment } from './pathAttribute.js'
import { encodeStegaPath, shouldSkipStega } from './stega.js'

const PATH_META = Symbol.for('payload-live-preview-inspector:path')

/**
 * With `serializable: true`, each object node also carries its path under
 * this enumerable key, so it survives serialization (e.g. being passed as a
 * prop across a server-to-client component boundary, where the proxy itself
 * is stripped). `pathOf()` reads it as a fallback to the proxy metadata.
 */
export const SERIALIZED_PATH_KEY = '__payloadLivePreviewPath'

/**
 * Keys whose string values are compared programmatically by virtually every
 * consumer (`block.blockType === 'heroBlock'`, `key={block.id}`, slug
 * routing) - stega mode never encodes these.
 */
const STEGA_SKIP_KEYS = ['blockName', 'blockType', 'id', 'slug']

/**
 * Display-text keys that are encoded even when single-word (the two-word
 * prose rule would skip them). The principle: these values only ever land in
 * HTML *attributes* (`alt`, `aria-label`, `placeholder`), which the
 * value-matching layer (text nodes only) can't reach - so without stega they
 * would be untaggable - and consuming code practically never compares them.
 * Text-node display fields (`label`, `title`, `heading`, ...) are NOT forced:
 * they're already double-covered by the two-word rule and value matching,
 * and comparisons against them do happen (`tabs.find(t => t.label === x)`) -
 * opt those in per project via `encodeKeys` when needed.
 */
const STEGA_FORCE_KEYS = ['alt', 'ariaLabel', 'placeholder']

/**
 * The load-bearing default: only strings with at least two
 * whitespace-separated words are encoded. Single-token values (`'default'`,
 * `'topRight'`, `'primary-dark'`) are exactly what consuming code uses as
 * object keys, switch discriminants, and strict-comparison targets - Payload
 * select/radio values, CSS-class-map keys and enum-like fields practically
 * never contain whitespace, so they are safe by construction, without any
 * word-list guessing. The cost is asymmetric: a skipped single-word heading
 * merely isn't stega-tagged (value matching or `pathOf()` cover it); an
 * encoded enum value crashes consuming code.
 */
const looksLikeProse = (value: string): boolean => /\S\s+\S/.test(value)

export type StegaOptions = {
  /**
   * Field names that are always encoded, even when their value is a single
   * word (which the default two-word prose rule would skip) - for fields you
   * *know* are display text, e.g. a button's `label` or a badge's `text`.
   * `alt` is built in. Shape-based skips (URLs, emails, dates, numbers, ...)
   * still apply, and `skipKeys` wins over this list.
   */
  encodeKeys?: string[]
  /**
   * The final say per string, replacing the default decision. Receives the
   * default (`defaultEncode`) so you can start from it - e.g. force-encode a
   * known-rendered single-word field, or exclude one more programmatic one:
   *
   * ```ts
   * filter: ({ defaultEncode, key }) =>
   *   key === 'buttonLabel' ? true : key === 'cssClasses' ? false : defaultEncode
   * ```
   *
   * `path` is the full field path (`layout.$abc.heading`). Skipped entirely
   * for strings read out of arrays (`hasMany` values are always raw).
   */
  filter?: (args: { defaultEncode: boolean; key: string; path: string; value: string }) => boolean
  /**
   * Additional field names that are never encoded, on top of the built-in
   * `id`, `blockType`, `blockName`, `slug`.
   */
  skipKeys?: string[]
}

type ResolvedStegaOptions = {
  filter: StegaOptions['filter']
  forceKeys: Set<string>
  skipKeys: Set<string>
}

type NodeOptions = {
  serializable: boolean
  stega: false | ResolvedStegaOptions
}

/**
 * `path` is `null` for a tree wrapped with `{ enabled: false }`: nodes still
 * identify themselves to `pathOf()` (which then silently emits nothing)
 * without generating any path attributes, stega characters, or serialized
 * markers.
 */
const createNode = (value: object, path: null | string, options: NodeOptions): object => {
  // Cache child proxies so repeated access to the same property returns the
  // same reference (keeps e.g. React memo/dependency comparisons stable).
  const childCache = new Map<PropertyKey, { proxy: object; raw: unknown }>()

  return new Proxy(value, {
    get(target, prop, receiver) {
      if (prop === PATH_META) {
        return path
      }

      if (prop === SERIALIZED_PATH_KEY && options.serializable && path !== null) {
        return path
      }

      const result = Reflect.get(target, prop, receiver)

      // Symbols (iterators etc.) and functions (array methods - called with
      // the proxy as `this`, so element access still goes through this trap)
      // pass through untouched.
      if (typeof prop === 'symbol') {
        return result
      }

      // Primitives can't carry proxy metadata - they're read via
      // `pathOf(parent, 'fieldName')` instead, unless stega mode bakes the
      // path invisibly into string values here. Strings read out of arrays
      // (`hasMany` values) stay raw: consumers compare those (`includes()`).
      if (result === null || typeof result !== 'object') {
        if (options.stega && path !== null && typeof result === 'string' && !Array.isArray(target)) {
          const fieldPath = path ? `${path}.${prop}` : prop
          const defaultEncode =
            !options.stega.skipKeys.has(prop) &&
            !shouldSkipStega(result) &&
            (options.stega.forceKeys.has(prop) || looksLikeProse(result))
          const encode = options.stega.filter
            ? options.stega.filter({ defaultEncode, key: prop, path: fieldPath, value: result })
            : defaultEncode

          if (encode) {
            return `${result}${encodeStegaPath(fieldPath)}`
          }
        }
        return result
      }

      const cached = childCache.get(prop)
      if (cached && cached.raw === result) {
        return cached.proxy
      }

      let childPath: null | string = null
      if (path !== null) {
        let segment = prop
        if (Array.isArray(target) && /^\d+$/.test(prop)) {
          // Array/Blocks rows in Payload data carry a stable `id` - address the
          // row by it so the path survives reordering. Rows without an id fall
          // back to their (fragile) index.
          const rowId = (result as { id?: unknown }).id
          if (typeof rowId === 'string' && rowId.length > 0) {
            segment = rowIDSegment(rowId)
          }
        }
        childPath = path ? `${path}.${segment}` : segment
      }

      const proxy = createNode(result, childPath, options)
      childCache.set(prop, { proxy, raw: result })
      return proxy
    },
    getOwnPropertyDescriptor(target, prop) {
      if (
        prop === SERIALIZED_PATH_KEY &&
        options.serializable &&
        path !== null &&
        !Array.isArray(target) &&
        !Reflect.has(target, SERIALIZED_PATH_KEY)
      ) {
        return { configurable: true, enumerable: true, value: path, writable: false }
      }
      return Reflect.getOwnPropertyDescriptor(target, prop)
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target)
      // Arrays can't carry the marker through JSON - their object children
      // still do, which is what `pathOf()` gets called on anyway.
      if (options.serializable && path !== null && !Array.isArray(target) && !keys.includes(SERIALIZED_PATH_KEY)) {
        keys.push(SERIALIZED_PATH_KEY)
      }
      return keys
    },
  })
}

export type InspectableOptions = {
  /**
   * When `false`, the whole tree is inert: no path attributes, no stega
   * characters, no serialized markers - `pathOf()` silently returns `{}` for
   * every node (no dev warnings), keeping public pages free of live-preview
   * markup. Pass your preview signal here when the same components render
   * both public and preview traffic, e.g.
   * `inspectable(data, { enabled: draftMode().isEnabled })` in Next.js.
   * @default true
   */
  enabled?: boolean
  /**
   * Additionally embeds each object node's path as an enumerable
   * `__payloadLivePreviewPath` property that survives serialization - so a
   * node passed as a prop from a Server Component to a Client Component
   * (where the proxy itself is stripped) still works with `pathOf()`.
   * Array nodes can't carry the marker across a JSON boundary; their object
   * children still do. Note that the key shows up in `Object.keys()` and
   * spreads of wrapped nodes.
   * @default false
   */
  serializable?: boolean
  /**
   * Encodes string field paths into the values as invisible zero-width
   * characters. `LivePreviewInspectorClient` decodes them from the rendered
   * DOM inside the Live Preview iframe and tags the containing elements
   * automatically - no `pathOf()` needed for text content.
   *
   * Only prose-shaped values (two or more whitespace-separated words) are
   * encoded: single-token values (`'default'`, `'topRight'`) are what
   * consuming code uses as object keys / enum discriminants / comparison
   * targets - Payload select/radio values stay raw by construction. Also
   * always skipped: the keys `id`, `blockType`, `blockName`, `slug`, values
   * shaped like URLs, emails, ISO dates, numbers, hex colors or uuids, and
   * strings read out of arrays (`hasMany`). Single-word *display* text (a
   * `'Kontakt'` heading) simply isn't stega-tagged - the value-matching
   * layer or `pathOf()` covers it. Fine-tune with `skipKeys`/`filter`, and
   * use `stegaClean()` wherever you need an encoded value raw.
   * @default false
   */
  stega?: boolean | StegaOptions
}

/**
 * Wraps a document's data in a path-tracking proxy: every nested object or
 * array element you access knows its own field path, and array rows are
 * automatically addressed by their stable `id` (reorder-safe) instead of
 * their index. Use together with `pathOf`:
 *
 * ```tsx
 * const page = inspectable(data)
 *
 * <h1 {...pathOf(page, 'title')}>{page.title}</h1>
 *
 * {page.layout?.map((block) => (
 *   <section key={block.id} {...pathOf(block)}>
 *     <h2 {...pathOf(block, 'heading')}>{block.heading}</h2>
 *   </section>
 * ))}
 * ```
 *
 * Plain JavaScript - no hooks, no context - so it works in Server Components
 * too. Caveat: wrap the data inside the component that renders it; the proxy
 * metadata does not survive a server-to-client component boundary (see the
 * `serializable` and `stega` options for two ways around that).
 */
export const inspectable = <T>(data: T, options?: InspectableOptions): T => {
  if (data === null || typeof data !== 'object') {
    return data
  }

  const stega = options?.stega
  return createNode(data, options?.enabled === false ? null : '', {
    serializable: options?.serializable === true,
    stega: stega
      ? {
          filter: typeof stega === 'object' ? stega.filter : undefined,
          forceKeys: new Set([...(typeof stega === 'object' ? (stega.encodeKeys ?? []) : []), ...STEGA_FORCE_KEYS]),
          skipKeys: new Set([...(typeof stega === 'object' ? (stega.skipKeys ?? []) : []), ...STEGA_SKIP_KEYS]),
        }
      : false,
  }) as T
}

/**
 * Returns the `data-payload-live-preview-path` attribute for a node obtained
 * through `inspectable()`. Pass `subPath` to address a field on the node
 * (`pathOf(block, 'heading')`); omit it to address the node itself
 * (`pathOf(block)` on an array row). No-ops with a dev warning when the node
 * isn't inspectable or the resulting path would be empty.
 */
export const pathOf = (node: unknown, subPath?: string): Record<string, string> => {
  let basePath =
    node !== null && typeof node === 'object'
      ? ((node as Record<symbol, unknown>)[PATH_META] as null | string | undefined)
      : undefined

  // A node that crossed a serialization boundary lost its proxy, but keeps
  // the marker key when wrapped with `serializable: true`.
  if (basePath === undefined && node !== null && typeof node === 'object') {
    const serialized = (node as Record<string, unknown>)[SERIALIZED_PATH_KEY]
    if (typeof serialized === 'string') {
      basePath = serialized
    }
  }

  // `null` means the tree was wrapped with `{ enabled: false }` - emit
  // nothing, intentionally and silently.
  if (basePath === null) {
    return {}
  }

  if (basePath === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console -- intentional dev-only diagnostic
      console.warn(
        '[payload-live-preview-inspector] pathOf() received a value that did not come from inspectable() - no path attribute was generated. If the value crossed a server/client component boundary, wrap the data with inspectable(data, { serializable: true }).',
      )
    }
    return {}
  }

  const path = [basePath, subPath].filter(Boolean).join('.')

  if (!path) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console -- intentional dev-only diagnostic
      console.warn(
        '[payload-live-preview-inspector] pathOf() needs a subPath when called on the document root, e.g. pathOf(page, "title").',
      )
    }
    return {}
  }

  return { [LIVE_PREVIEW_PATH_ATTRIBUTE]: path }
}
