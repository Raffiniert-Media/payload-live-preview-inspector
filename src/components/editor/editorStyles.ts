import {
  ABOVE_ATTRIBUTE,
  AROUND_ATTRIBUTE,
  FOCUSING_ATTRIBUTE,
  HIDDEN_ATTRIBUTE,
  HOST_ATTRIBUTE,
} from '../../utilities/isolate.js'
import { PAYLOAD_CLASS, PAYLOAD_MID_BREAK_PX, PAYLOAD_PROPERTY } from '../../utilities/payloadAdmin.js'

/**
 * The editor's rules for Payload's own markup - the preview's width, the
 * stacked layout on a narrow screen, what focus mode hides.
 *
 * A plain stylesheet rendered by the editor rather than a CSS module: these
 * rules select Payload's classes and our attributes, which a CSS module would
 * either rename or refuse as impure. Unlayered on purpose - Payload's own
 * rules sit in `@layer payload-default`, and an unlayered rule wins over any
 * layered one, whatever its specificity.
 *
 * Only present while the editor is mounted, so leaving the document leaves
 * Payload's layout exactly as it was.
 */

/** Custom properties the editor sets, and these rules read. */
export const EDITOR_PROPERTY = {
  /** The preview's width beside the form, in px. */
  previewWidth: '--payload-live-preview-inspector-preview-width',
  /** The preview's height above the form on a narrow screen. */
  previewHeight: '--payload-live-preview-inspector-preview-height',
} as const

/** `HOST_ATTRIBUTE` values - which of the editor's elements a host carries. */
export const HOST = {
  outline: 'outline',
  /** Page mode's title, first in the bar with the save buttons. */
  pageTitle: 'page-title',
  /** "Replace" on an upload field's file card. */
  uploadReplace: 'upload-replace',
  /** The editor's bar above the form: outline, focus mode, the path. */
  pathBar: 'path-bar',
  /** The editor's part of Payload's bar above the preview: screen widths, the hint. */
  previewTools: 'preview-tools',
  split: 'split',
} as const

/**
 * What Payload's preview bar gives up while it is too narrow for everything,
 * in this order: the hint's sentence for its icon, Payload's width and height
 * fields, then Payload's breakpoint menu - that last one only beside the
 * editor's screen widths, which do what it does.
 */
export const BAR_FOLDS = ['hint', 'size', 'breakpoint'] as const
export type BarFold = (typeof BAR_FOLDS)[number]

/** On Payload's preview bar: the folds in effect, space-separated. */
export const FOLDED_ATTRIBUTE = 'data-payload-live-preview-inspector-folded'
export const HINT_SENTENCE_ATTRIBUTE = 'data-payload-live-preview-inspector-hint-sentence'
export const HINT_ICON_ATTRIBUTE = 'data-payload-live-preview-inspector-hint-icon'

/**
 * On the root element while page mode is on (see `EditorFeatures.pageMode`).
 * An attribute rather than a rule rendered with the state: set the moment the
 * editor switches, not a render later - a reveal that starts on the same tap
 * measures the layout page mode makes.
 */
export const PAGE_ATTRIBUTE = 'data-payload-live-preview-inspector-page'
/** On the root element, page mode on a narrow screen: the form is up, under the preview. */
export const PANEL_ATTRIBUTE = 'data-payload-live-preview-inspector-panel'

const c = (name: (typeof PAYLOAD_CLASS)[keyof typeof PAYLOAD_CLASS]) => `.${name}`
const host = (name: (typeof HOST)[keyof typeof HOST]) => `[${HOST_ATTRIBUTE}="${name}"]`

const previewing = c(PAYLOAD_CLASS.editViewLivePreviewing)
const bar = c(PAYLOAD_CLASS.livePreviewToolbar)
const folded = (part: BarFold) => `${bar}[${FOLDED_ATTRIBUTE}~="${part}"]`
const controls = `var(${PAYLOAD_PROPERTY.docControlsHeight}, 56px)`
const page = `html[${PAGE_ATTRIBUTE}]`
const pagePanel = `html[${PAGE_ATTRIBUTE}][${PANEL_ATTRIBUTE}]`
const pageNoPanel = `html[${PAGE_ATTRIBUTE}]:not([${PANEL_ATTRIBUTE}])`

/**
 * Page mode: the page is where the editor works, and Payload's frame steps
 * back - see `EditorFeatures.pageMode`.
 *
 * Payload's header and the document's title bar go; the bar with the save
 * buttons, which already sticks to the top, is the top, and carries the title
 * (`PageTitle`) where the dates were. Payload's own size, zoom and breakpoint
 * controls go where the screen widths are there to do that.
 *
 * On a narrow screen the preview fills the screen under that bar, and the
 * form is not there until something is tapped. Then it comes up from below,
 * the preview keeping the upper part - the stacked layout, with the divider
 * as the sheet's top edge.
 */
const pageModeStyles = ({ viewports }: { viewports: boolean }): string => `
${page} ${c(PAYLOAD_CLASS.appHeader)},
${page} ${c(PAYLOAD_CLASS.docHeader)} {
  display: none !important;
}

/* The dates make room for the title; the status and Payload's autosave note stay. */
${page} ${c(PAYLOAD_CLASS.docControlsValueWrap)} {
  display: none;
}

${
  viewports
    ? `
${page} ${c(PAYLOAD_CLASS.livePreviewToolbarSize)},
${page} ${c(PAYLOAD_CLASS.livePreviewToolbarZoom)},
${page} ${c(PAYLOAD_CLASS.livePreviewToolbarBreakpoint)} {
  display: none !important;
}`
    : ''
}

@media (min-width: ${PAYLOAD_MID_BREAK_PX + 1}px) {
  ${page} [data-payload-live-preview-inspector-back-narrow] {
    display: none;
  }
}

@media (max-width: ${PAYLOAD_MID_BREAK_PX}px) {
  /*
   * Payload sticks only the buttons on a narrow screen and lets the status
   * above them scroll away. Here there is no status, so nothing scrolls away.
   */
  ${page} ${c(PAYLOAD_CLASS.docControls)} {
    top: 0;
  }
  ${page} ${c(PAYLOAD_CLASS.docControlsContent)},
  ${page} ${c(PAYLOAD_CLASS.livePreviewToolbar)} {
    display: none;
  }
  ${pageNoPanel} ${c(PAYLOAD_CLASS.editMain)},
  ${pageNoPanel} ${host(HOST.split)} {
    display: none;
  }
  ${pageNoPanel} ${previewing} ${c(PAYLOAD_CLASS.livePreviewWindow)} {
    box-shadow: none;
    height: calc(100dvh - ${controls});
  }
  /* The sheet's top edge. */
  ${pagePanel} ${host(HOST.split)} [data-payload-live-preview-inspector-split] {
    border-bottom: 0;
    border-radius: 12px 12px 0 0;
    box-shadow: 0 -6px 18px rgb(0 0 0 / 18%);
  }
  /* Up with the form, the path bar has the same switches - and the page is busy. */
  ${pagePanel} [data-payload-live-preview-inspector-dock] {
    display: none;
  }
}
`

/**
 * Descriptions one line long in the form, whole in the field the editor is in
 * - see `EditorFeatures.compactDescriptions`. Only a field's own description:
 * Payload puts it beside the input, or inside the input's wrapper, so a group
 * with a focused field inside does not open every description it holds.
 */
const compactDescriptionStyles = (): string => `
${c(PAYLOAD_CLASS.editMain)} ${c(PAYLOAD_CLASS.fieldDescription)} {
  -webkit-box-orient: vertical;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  overflow: hidden;
}

${c(PAYLOAD_CLASS.editMain)} ${c(PAYLOAD_CLASS.fieldType)}:focus-within > ${c(PAYLOAD_CLASS.fieldDescription)},
${c(PAYLOAD_CLASS.editMain)} ${c(PAYLOAD_CLASS.fieldType)}:focus-within > ${c(PAYLOAD_CLASS.fieldTypeWrap)} > ${c(PAYLOAD_CLASS.fieldDescription)} {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}
`

export const editorStyles = ({
  compactDescriptions,
  editUploadInLibrary,
  mobile,
  pageMode,
  split,
  viewports,
}: {
  compactDescriptions: boolean
  editUploadInLibrary: boolean
  mobile: boolean
  pageMode: boolean
  split: boolean
  viewports: boolean
}): string => `
[${HIDDEN_ATTRIBUTE}] { display: none !important; }

/*
 * Focus mode: the rows around the shown one, flat - no frame, no indent, no
 * space above or below; and above them only the vertical space goes, the page
 * keeps its margin. What is left is the block, right under the editor's bar.
 */
[${AROUND_ATTRIBUTE}] {
  background: none !important;
  border-color: transparent !important;
  box-shadow: none !important;
  margin: 0 !important;
  padding: 0 !important;
}

[${ABOVE_ATTRIBUTE}] {
  margin-bottom: 0 !important;
  margin-top: 0 !important;
  padding-bottom: 0 !important;
  padding-top: 0 !important;
}

[${FOCUSING_ATTRIBUTE}] {
  padding-bottom: calc(var(--base) * 2);
}

[${FOCUSING_ATTRIBUTE}] > ${host(HOST.pathBar)} {
  margin-bottom: var(--base);
}

${host(HOST.outline)} {
  flex: 0 0 auto;
  position: sticky;
  top: ${controls};
  height: calc(100vh - ${controls});
  z-index: 2;
}

${host(HOST.pathBar)} {
  position: sticky;
  top: ${controls};
  z-index: 3;
}

/*
 * In Payload's preview bar, on the left, taking the room Payload's controls
 * leave - which pushes those to the right. Never narrower than what it holds:
 * when the bar is short of room it overflows rather than sliding under
 * Payload's controls, and the preview tools see the overflow and folds.
 */
${host(HOST.previewTools)} {
  align-self: stretch;
  display: flex;
  flex: 1 1 auto;
}

/* Payload's controls, pushed to the right by ours, off the edge. */
${bar}:has(> ${host(HOST.previewTools)}) {
  justify-content: flex-start;
  padding-right: calc(var(--base) / 2);
}

/*
 * What the bar gives up while it is too narrow - see BAR_FOLDS. The hint
 * is the sentence until it folds to its icon.
 */
${host(HOST.previewTools)} [${HINT_ICON_ATTRIBUTE}],
${folded('hint')} [${HINT_SENTENCE_ATTRIBUTE}],
${folded('size')} ${c(PAYLOAD_CLASS.livePreviewToolbarSize)},
${folded('breakpoint')} ${c(PAYLOAD_CLASS.livePreviewToolbarBreakpoint)} {
  display: none;
}

${folded('hint')} [${HINT_ICON_ATTRIBUTE}] {
  display: inline-flex;
}

${
  split
    ? `
@media (min-width: ${PAYLOAD_MID_BREAK_PX + 1}px) {
  ${previewing} ${c(PAYLOAD_CLASS.livePreviewWindow)} {
    width: var(${EDITOR_PROPERTY.previewWidth}, 60%);
  }
  ${host(HOST.split)} {
    flex: 0 0 auto;
    position: sticky;
    top: ${controls};
    height: calc(100vh - ${controls});
    z-index: 4;
  }
}`
    : ''
}

${
  mobile
    ? `
@media (max-width: ${PAYLOAD_MID_BREAK_PX}px) {
  ${previewing} ${c(PAYLOAD_CLASS.editMainWrapper)} {
    flex-direction: column;
  }
  ${previewing} ${c(PAYLOAD_CLASS.livePreviewWindow)} {
    order: -2;
    width: 100%;
    height: var(${EDITOR_PROPERTY.previewHeight}, 42vh);
    top: ${controls};
    z-index: 4;
    box-shadow: 0 1px 0 var(--theme-elevation-100);
  }
  ${previewing} ${c(PAYLOAD_CLASS.editMain)} {
    width: 100%;
    min-height: 60vh;
  }
  ${previewing} ${host(HOST.split)} {
    order: -1;
    position: sticky;
    top: calc(${controls} + var(${EDITOR_PROPERTY.previewHeight}, 42vh));
    z-index: 4;
  }
  ${previewing} ${host(HOST.pathBar)} {
    top: calc(${controls} + var(${EDITOR_PROPERTY.previewHeight}, 42vh) + 18px);
  }
  ${host(HOST.outline)} {
    position: fixed;
    inset: ${controls} 0 0 0;
    height: auto;
    z-index: 20;
  }
}`
    : `
@media (max-width: ${PAYLOAD_MID_BREAK_PX}px) {
  ${host(HOST.split)} { display: none; }
}`
}

${pageMode ? pageModeStyles({ viewports }) : ''}

${editUploadInLibrary ? '' : `${c(PAYLOAD_CLASS.uploadDetailsEdit)} { display: none !important; }`}

${compactDescriptions ? compactDescriptionStyles() : ''}
`
