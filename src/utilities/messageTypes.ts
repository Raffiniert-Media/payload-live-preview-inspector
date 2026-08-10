/**
 * postMessage payloads exchanged between the Live Preview iframe
 * (`LivePreviewInspectorClient`) and the admin panel
 * (`LivePreviewInspectorListener`). Both sides validate origin and source
 * window before acting on a message.
 */

/**
 * iframe → admin: a tagged element was clicked; carries the field `path` and,
 * when the click landed on text, a `caret` hint (`{ offset, text }`) locating
 * the clicked position within that text. Older clients omit `caret`.
 */
export const CLICK_MESSAGE_TYPE = 'payload-live-preview-inspector:click'

/**
 * admin → iframe: the current string leaf values of the edit form (with
 * row-id based paths), used by the iframe for value matching.
 */
export const DOCUMENT_VALUES_MESSAGE_TYPE = 'payload-live-preview-inspector:document-values'

/** iframe → admin: request a fresh `DOCUMENT_VALUES_MESSAGE_TYPE` snapshot. */
export const REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE =
  'payload-live-preview-inspector:request-document-values'

/**
 * admin → iframe: a form field was focused; carries its row-id based `path`
 * so the preview can scroll to and flash the matching element - the reverse
 * of `CLICK_MESSAGE_TYPE`.
 */
export const FOCUS_MESSAGE_TYPE = 'payload-live-preview-inspector:focus'
