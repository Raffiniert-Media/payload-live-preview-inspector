import { AROUND_ATTRIBUTE, HIDDEN_ATTRIBUTE, HOST_ATTRIBUTE } from '../../utilities/isolate.js'
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
  pathBar: 'path-bar',
  split: 'split',
} as const

const c = (name: (typeof PAYLOAD_CLASS)[keyof typeof PAYLOAD_CLASS]) => `.${name}`
const host = (name: (typeof HOST)[keyof typeof HOST]) => `[${HOST_ATTRIBUTE}="${name}"]`

const previewing = c(PAYLOAD_CLASS.editViewLivePreviewing)
const controls = `var(${PAYLOAD_PROPERTY.docControlsHeight}, 56px)`

export const editorStyles = ({ mobile, split }: { mobile: boolean; split: boolean }): string => `
[${HIDDEN_ATTRIBUTE}] { display: none !important; }

/* Focus mode: the rows around the shown one, flat - no frame, no indent. */
[${AROUND_ATTRIBUTE}] {
  background: none !important;
  border-color: transparent !important;
  box-shadow: none !important;
  margin-left: 0 !important;
  margin-right: 0 !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
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
`
