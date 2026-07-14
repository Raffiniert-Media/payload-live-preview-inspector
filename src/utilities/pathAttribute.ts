/**
 * Add this attribute to any element in your frontend that should be
 * clickable/highlightable in Payload's live preview. Set it via
 * `pathOf()`/`inspectable()` (recommended) rather than by hand.
 */
export const LIVE_PREVIEW_PATH_ATTRIBUTE = 'data-payload-live-preview-path'

/**
 * Marks a path segment as an Array/Blocks row `id` rather than its current
 * index - the admin listener resolves it to whatever index that row
 * currently has before looking up the DOM element.
 */
const ROW_ID_MARKER = '$'

export const rowIDSegment = (rowId: string): string => `${ROW_ID_MARKER}${rowId}`

export const isRowIDSegment = (segment: string): boolean => segment.startsWith(ROW_ID_MARKER)

export const rowIDFromSegment = (segment: string): string => segment.slice(ROW_ID_MARKER.length)
