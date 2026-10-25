import type { Viewport } from './layout.js'

/**
 * Which of the editor's parts are on. Each is on unless turned off; `focusMode`
 * is the exception in what "on" means - see there.
 */
export type EditorFeatures = {
  /**
   * The preview's block toolbar: move, duplicate, remove and add a block from
   * the page itself, and select the block around it.
   * @default true
   */
  blockToolbar?: boolean
  /**
   * Focus mode: the form shows only the block the editor chose - in the
   * preview, the outline or the path bar - and the path bar is how to widen it
   * again. `true` offers the switch, which starts off; `'on'` starts it on;
   * `false` removes it. On a narrow screen it starts on either way, since there
   * a whole page of fields under the preview is not workable.
   * @default true
   */
  focusMode?: 'on' | boolean
  /**
   * The outline: every row of the document as a tree beside the form.
   * @default true
   */
  outline?: boolean
  /**
   * The path bar above the form: where in the document the selected block is.
   * @default true
   */
  pathBar?: boolean
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
