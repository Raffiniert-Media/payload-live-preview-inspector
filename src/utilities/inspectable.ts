import { LIVE_PREVIEW_PATH_ATTRIBUTE, rowIDSegment } from './pathAttribute.js'

const PATH_META = Symbol.for('payload-live-preview-inspector:path')

/**
 * `path` is `null` for a tree wrapped with `{ enabled: false }`: nodes still
 * identify themselves to `pathOf()` (which then silently emits nothing)
 * without generating any path attributes.
 */
const createNode = (value: object, path: null | string): object => {
  // Cache child proxies so repeated access to the same property returns the
  // same reference (keeps e.g. React memo/dependency comparisons stable).
  const childCache = new Map<PropertyKey, { proxy: object; raw: unknown }>()

  return new Proxy(value, {
    get(target, prop, receiver) {
      if (prop === PATH_META) {
        return path
      }

      const result = Reflect.get(target, prop, receiver)

      // Primitives can't carry path metadata - they're read via
      // `pathOf(parent, 'fieldName')` instead. Symbols (iterators etc.) and
      // functions (array methods - called with the proxy as `this`, so
      // element access still goes through this trap) pass through untouched.
      if (typeof prop === 'symbol' || result === null || typeof result !== 'object') {
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

      const proxy = createNode(result, childPath)
      childCache.set(prop, { proxy, raw: result })
      return proxy
    },
  })
}

export type InspectableOptions = {
  /**
   * When `false`, the whole tree renders no path attributes: `pathOf()`
   * silently returns `{}` for every node (no dev warnings), keeping public
   * pages free of live-preview markup. Pass your preview signal here when
   * the same components render both public and preview traffic, e.g.
   * `inspectable(data, { enabled: draftMode().isEnabled })` in Next.js.
   * @default true
   */
  enabled?: boolean
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
 * too. Caveat: wrap the data inside the component that renders it; the path
 * metadata does not survive a server-to-client component boundary.
 */
export const inspectable = <T>(data: T, options?: InspectableOptions): T => {
  if (data === null || typeof data !== 'object') {
    return data
  }

  return createNode(data, options?.enabled === false ? null : '') as T
}

/**
 * Returns the `data-payload-live-preview-path` attribute for a node obtained
 * through `inspectable()`. Pass `subPath` to address a field on the node
 * (`pathOf(block, 'heading')`); omit it to address the node itself
 * (`pathOf(block)` on an array row). No-ops with a dev warning when the node
 * isn't inspectable or the resulting path would be empty.
 */
export const pathOf = (node: unknown, subPath?: string): Record<string, string> => {
  const basePath =
    node !== null && typeof node === 'object'
      ? ((node as Record<symbol, unknown>)[PATH_META] as null | string | undefined)
      : undefined

  // `null` means the tree was wrapped with `{ enabled: false }` - emit
  // nothing, intentionally and silently.
  if (basePath === null) {
    return {}
  }

  if (basePath === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console -- intentional dev-only diagnostic
      console.warn(
        '[payload-live-preview-inspector] pathOf() received a value that did not come from inspectable() - no path attribute was generated.',
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
