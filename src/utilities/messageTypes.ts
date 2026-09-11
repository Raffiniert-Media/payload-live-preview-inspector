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
 * admin → iframe: a form field was focused or clicked into; carries its
 * row-id based `path` and, for a rich-text editor, a `caret` hint
 * (`{ offset, text }`) describing where in the value the cursor sits, so the
 * preview scrolls to the element rendering *that* text rather than to the
 * first one the field tags. The reverse of `CLICK_MESSAGE_TYPE`.
 */
export const FOCUS_MESSAGE_TYPE = 'payload-live-preview-inspector:focus'

/**
 * iframe → admin: how this preview is treating clicks, so the hint in the
 * document controls can say so.
 *
 * The two halves of the plugin are configured independently — the admin gets
 * its options through the plugin's `clientProps`, the iframe gets its own from
 * whoever renders `LivePreviewInspectorClient`. Without this message the hint
 * could only describe the defaults, and a site that turned the modifier off
 * would be showing its editors an instruction that does nothing.
 */
export const SETTINGS_MESSAGE_TYPE = 'payload-live-preview-inspector:settings'
