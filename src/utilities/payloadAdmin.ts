/**
 * Everything this plugin knows about how Payload's admin is *rendered* - class
 * names, ids and attributes that are Payload's implementation rather than its
 * API.
 *
 * Nothing in Payload's public API says which tab holds a field, whether a row
 * is drawn open, or where the live preview sits next to the form; the markup
 * does. Reading it is what lets a click reach a field behind three closed rows,
 * and it is also the part of this plugin that an admin redesign breaks. So it
 * lives here, in one file, and `payloadAdmin.test.ts` checks every name below
 * against the `@payloadcms/ui` that is installed: an upgrade that renames one
 * fails there, naming it, instead of a reveal quietly finding nothing.
 *
 * Everything else imports from here. A class name typed anywhere else is a
 * class name the test does not know about.
 */

/** Payload's class names, without the leading dot. */
export const PAYLOAD_CLASS = {
  /** The animated content box of a row or collapsible. */
  animatedContent: 'rah-static',
  collapsible: 'collapsible',
  collapsibleCollapsed: 'collapsible--collapsed',
  collapsibleToggle: 'collapsible__toggle',
  collapsibleToggleWrap: 'collapsible__toggle-wrap',
  /** The sticky bar with the save buttons, above form and preview. */
  docControls: 'doc-controls',
  /** A drawer while it is open - the block drawer among them. */
  drawerOpen: 'drawer--is-open',
  /** The edit view - collections and globals both. */
  editView: 'collection-edit',
  editViewLivePreviewing: 'collection-edit--is-live-previewing',
  /** The form's column. */
  editMain: 'collection-edit__main',
  /** The row holding the form's column and the live preview, side by side. */
  editMainWrapper: 'collection-edit__main-wrapper',
  livePreviewIframe: 'live-preview-iframe',
  /** The bar above the preview with Payload's size, zoom and pop-out controls. */
  livePreviewToolbar: 'live-preview-toolbar',
  /** In that bar: the menu of configured breakpoints, and the width and height fields. */
  livePreviewToolbarBreakpoint: 'live-preview-toolbar-controls__breakpoint',
  /** Payload's controls in that bar, as one element. */
  livePreviewToolbarControls: 'live-preview-toolbar-controls',
  livePreviewToolbarSize: 'live-preview-toolbar-controls__device-size',
  livePreviewWindow: 'live-preview-window',
  livePreviewWindowMain: 'live-preview-window__main',
  /** The container a row renders its fields into. */
  renderFields: 'render-fields',
  tabButton: 'tabs-field__tab-button',
  tabButtonActive: 'tabs-field__tab-button--active',
  tabsContentWrap: 'tabs-field__content-wrap',
  tabsField: 'tabs-field',
  tabsTabs: 'tabs-field__tabs',
  tabsTabsWrap: 'tabs-field__tabs-wrap',
} as const

/** `.name` for a class above. */
export const selectorOf = (name: (typeof PAYLOAD_CLASS)[keyof typeof PAYLOAD_CLASS]): string => `.${name}`

/** Payload's custom properties, read for layout and colour. */
export const PAYLOAD_PROPERTY = {
  /** The admin's accent colour, resolved in its current light/dark theme. */
  accent: '--theme-success-500',
  /** Payload's spacing unit. */
  base: '--base',
  /** Height of the sticky document controls. */
  docControlsHeight: '--doc-controls-height',
} as const

/** Width (px) at and below which Payload stacks the edit view (its `mid-break`). */
export const PAYLOAD_MID_BREAK_PX = 1024

/**
 * Attribute Payload puts on a field it renders without a `field-<path>` id -
 * Lexical's rich-text editor, among others.
 */
export const FIELD_PATH_ATTRIBUTE = 'data-field-path'

/** Prefix of every non-rich-text field's `id`, set on whichever element is its actual control. */
export const FIELD_ID_PREFIX = 'field-'

/** `field-<path, dots doubled into underscores>` - the id Payload gives a field's control. */
export const fieldIDFromPath = (path: string): string => `${FIELD_ID_PREFIX}${path.replace(/\./g, '__')}`

/** The id Payload's collapsible field renders: its unnamed path, dots doubled into underscores. */
export const collapsibleIDFromPath = (path: string): string => `${FIELD_ID_PREFIX}collapsible-${path.replace(/\./g, '__')}`

/** Payload's id for an Array/Blocks row's wrapper: `<parent path, dots as dashes>-row-<index>`. */
export const ROW_ID_PATTERN = /^(.+)-row-(\d+)$/

/**
 * Prefix of the *second* id an Array row's header carries, for Payload's own
 * scroll-to-new-row. Shaped like a row id, never a path.
 */
export const SCROLL_ID_PREFIX = 'scroll-'

/** The row wrapper id for `path` ending in a row index (`layout.2` → `layout-row-2`), or `null`. */
export const rowIDFromPath = (path: string): null | string => {
  const match = /^(.*)\.(\d+)$/.exec(path)

  if (!match) {
    return null
  }

  const [, parentPath, rowIndex] = match

  return `${parentPath.replace(/\./g, '-')}-row-${rowIndex}`
}

/** The path a row wrapper's id stands for (`layout-row-2` → `layout.2`), or `null` for any other id. */
export const pathFromRowID = (id: string): null | string => {
  if (id.startsWith(SCROLL_ID_PREFIX)) {
    return null
  }
  const match = ROW_ID_PATTERN.exec(id)
  return match ? `${match[1].replace(/-/g, '.')}.${match[2]}` : null
}

/** The collapsible inside a row wrapper or collapsible field - its header and its content. */
export const collapsibleOf = (el: Element | null | undefined): HTMLElement | null =>
  el?.querySelector<HTMLElement>(selectorOf(PAYLOAD_CLASS.collapsible)) ?? null

export const isCollapsedCollapsible = (collapsible: Element | null | undefined): boolean =>
  Boolean(collapsible?.classList.contains(PAYLOAD_CLASS.collapsibleCollapsed))

/** The header a collapsible is opened by. */
export const toggleWrapOf = (collapsible: Element | null | undefined): HTMLElement | null =>
  collapsible?.querySelector<HTMLElement>(`:scope > ${selectorOf(PAYLOAD_CLASS.collapsibleToggleWrap)}`) ?? null

/** The button inside that header. */
export const toggleButtonOf = (collapsible: Element | null | undefined): HTMLButtonElement | null =>
  toggleWrapOf(collapsible)?.querySelector<HTMLButtonElement>(`:scope > ${selectorOf(PAYLOAD_CLASS.collapsibleToggle)}`) ??
  null

/**
 * Payload's landmark elements, kept while they are on the page: the editor
 * asks for them on every frame the form changes in, and a search that has to
 * pass the whole form - the preview comes after it - each time adds up.
 * Asked again once the element left the page or lost the class.
 */
const landmarks = new WeakMap<Document, Map<string, HTMLElement>>()
const landmark = (name: (typeof PAYLOAD_CLASS)[keyof typeof PAYLOAD_CLASS], doc: Document): HTMLElement | null => {
  let known = landmarks.get(doc)
  if (!known) {
    known = new Map()
    landmarks.set(doc, known)
  }
  const kept = known.get(name)
  if (kept?.isConnected && kept.classList.contains(name)) {
    return kept
  }
  const found = doc.querySelector<HTMLElement>(selectorOf(name))
  if (found) {
    known.set(name, found)
  } else {
    known.delete(name)
  }
  return found
}

/** The edit view, when one is on the page. */
export const editViewEl = (doc: Document = document): HTMLElement | null => landmark(PAYLOAD_CLASS.editView, doc)

/** The form's column. */
export const editMainEl = (doc: Document = document): HTMLElement | null => landmark(PAYLOAD_CLASS.editMain, doc)

/** The flex row holding the form's column and the live preview. */
export const editMainWrapperEl = (doc: Document = document): HTMLElement | null =>
  landmark(PAYLOAD_CLASS.editMainWrapper, doc)

/** The live preview panel, when it is the inline one (not a popup). */
export const livePreviewWindowEl = (doc: Document = document): HTMLElement | null =>
  landmark(PAYLOAD_CLASS.livePreviewWindow, doc)

/** The bar above the preview with Payload's own controls. */
export const livePreviewToolbarEl = (doc: Document = document): HTMLElement | null =>
  landmark(PAYLOAD_CLASS.livePreviewToolbar, doc)

/** The area inside the live preview panel the device frame sits in. */
export const livePreviewMainEl = (doc: Document = document): HTMLElement | null =>
  landmark(PAYLOAD_CLASS.livePreviewWindowMain, doc)

/** A Payload custom property's value on the root, in px - `fallback` when it is not set or not a length. */
export const payloadPropertyPx = (name: string, fallback: number, doc: Document = document): number => {
  const value = parseFloat(getComputedStyle(doc.documentElement).getPropertyValue(name))
  return Number.isFinite(value) ? value : fallback
}

/**
 * The parts of Payload's edit view everything else hangs on: the form's
 * column and its bar, and - while the inline live preview is open - the
 * preview panel, its bar and the row holding both.
 */
const LANDMARKS = [PAYLOAD_CLASS.editView, PAYLOAD_CLASS.editMain, PAYLOAD_CLASS.docControls] as const
const LIVE_PREVIEW_LANDMARKS = [
  PAYLOAD_CLASS.editMainWrapper,
  PAYLOAD_CLASS.livePreviewWindow,
  PAYLOAD_CLASS.livePreviewWindowMain,
  PAYLOAD_CLASS.livePreviewToolbar,
  PAYLOAD_CLASS.livePreviewToolbarControls,
] as const

/**
 * Which of those are not on the page - the class names, empty when all are.
 *
 * The test against the installed `@payloadcms/ui` catches a rename before a
 * release; this catches it on a site that updated Payload past the plugin,
 * where a renamed class would otherwise only show as a piece of the editor
 * quietly missing.
 */
export const missingLandmarks = ({ livePreview }: { livePreview: boolean }, doc: Document = document): string[] =>
  [...LANDMARKS, ...(livePreview ? LIVE_PREVIEW_LANDMARKS : [])].filter((name) => !doc.querySelector(selectorOf(name)))
