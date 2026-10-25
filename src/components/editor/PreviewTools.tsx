'use client'

import React from 'react'

import type { EditorStrings } from '../../utilities/i18n.js'
import type { Viewport } from '../../utilities/layout.js'

import classes from './Editor.module.css'
import { InfoIcon } from './icons.js'
import { ViewportControls } from './ViewportControls.js'

type Props = {
  /** The sentence about clicking in the preview - with the modifier, when the preview reported one. */
  hint: string
  language: string
  /** What is happening right now: where a click is going, or that it found nothing. */
  status?: { text: string; tone: 'active' | 'notice' }
  strings: EditorStrings
  /** Screen widths to offer; none on a narrow screen, where the preview is the phone. */
  viewports: Viewport[]
}

/**
 * The editor's part of Payload's bar above the preview: the screen widths,
 * and what a click in the preview does - the sentence where it fits, an icon
 * carrying it where it does not, and where a click is going while it goes.
 *
 * Here because all of it is about the preview, and because this bar has room
 * where Payload's document controls have none.
 */
export const PreviewTools: React.FC<Props> = ({ hint, language, status, strings, viewports }) => (
  <div className={classes.previewTools} data-payload-live-preview-inspector-preview-tools="">
    {viewports.length > 0 && <ViewportControls language={language} strings={strings} viewports={viewports} />}
    {status ? (
      <div className={`${classes.hint} ${classes.hintActive}`} role="status">
        {status.text}
      </div>
    ) : (
      <>
        <div className={`${classes.hint} ${classes.hintSentence}`}>{hint}</div>
        {/*
         * Where the sentence does not fit, it is still there to find: the only
         * place an editor learns that the modifier gives them the page back.
         */}
        <span
          aria-label={hint}
          className={classes.hintIcon}
          data-payload-live-preview-inspector-hint-icon=""
          role="img"
          title={hint}
        >
          <InfoIcon />
        </span>
      </>
    )}
  </div>
)
