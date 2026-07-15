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
