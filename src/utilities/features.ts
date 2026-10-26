import type { Viewport } from './layout.js'

/**
 * Which of the editor's parts are on. Each is on unless turned off. The two
 * modes - `focusMode` and `pageMode` - are switches the editor flips for
 * themselves, remembered in their browser; the option says whether the switch
 * is there and where it starts.
 */
export type EditorFeatures = {
  /**
   * The preview's block toolbar: move, duplicate, remove and add a block from
   * the page itself, and select the block around it.
   * @default true
   */
  blockToolbar?: boolean
  /**
   * Field descriptions one line long until the field is in use - focused, or
   * holding the focus. A form whose every field explains itself in two to four
   * lines reads as a wall; the first line says what the field is, and the rest
   * is there the moment the editor is in it.
   * @default true
   */
  compactDescriptions?: boolean
  /**
   * Payload's pencil on an upload field's file. It opens the file's own
   * document - alt text, focal point - and a change there changes the file
   * wherever it is used, which on a page reads as "edit this image here". Off
   * unless asked for: on a page, "Replace" is what changes this one image,
   * and the file itself is still edited in its collection. `true` brings the
   * pencil back.
   * @default false
   */
  editUploadInLibrary?: boolean
  /**
   * Focus mode: the form shows only the block the editor chose - in the
   * preview, the outline or the path bar - and the path bar is how to widen it
   * again. `true` (or `'on'`) offers the switch and starts it on; `'off'`
   * offers it starting off - except on a narrow screen, where a whole page of
   * fields under the preview is not workable; `false` removes it.
   * @default true
   */
  focusMode?: 'off' | 'on' | boolean
  /**
   * The outline: every row of the document as a tree beside the form.
   * @default true
   */
  outline?: boolean
  /**
   * Page mode, while the live preview is open: the page is where the editor
   * works, and Payload's frame around it steps back. Payload's header and the
   * document's title bar fold into the bar with the save buttons, and a
   * button at the bottom right holds the editor's switches. On a narrow screen
   * the preview fills it, and the form comes up from below for what was
   * tapped. `true` (or `'on'`) offers the switch and starts it on; `'off'`
   * offers it starting off; `false` removes it, and with it the button.
   * @default true
   */
  pageMode?: 'off' | 'on' | boolean
  /**
   * The path bar above the form: where in the document the selected block is.
   * @default true
   */
  pathBar?: boolean
  /**
   * A click on what another document puts on the page - a post in a carousel,
   * the document a relationship points at - opens that document in Payload's
   * drawer, at the field clicked, beside the preview. Only documents the
   * editor may read, of collections the admin shows; in the drawer Payload's
   * access control applies as anywhere. Tag such content with
   * `inspectableDocument()`; a relationship's populated value needs nothing.
   * `false`: a relationship's text goes to the relationship field, as before.
   * @default true
   */
  relatedDocuments?: boolean
  /**
   * "Replace" on an upload field that has a file: another one from the
   * library, in one step - where Payload's own way is to remove the file and
   * then choose. Single-file fields; a gallery keeps Payload's list.
   * @default true
   */
  replaceUpload?: boolean
  /**
   * A divider between form and preview to drag, remembered per browser.
   * @default true
   */
  split?: boolean
  /**
   * On a narrow screen (Payload's 1024px break), the preview above the form
   * instead of the form not showing at all - with a divider between them.
   * @default true
   */
  stacked?: boolean
  /**
   * Screen widths to lay the preview out at, as buttons in Payload's bar
   * above the preview; `false` for none. The preview is zoomed to fit the
   * panel.
   * @default phone 390, tablet 768, desktop 1440
   */
  viewports?: false | Viewport[]
}
