'use client'

import React, { useLayoutEffect, useRef } from 'react'

import type { EditorStrings } from '../../utilities/i18n.js'
import type { Viewport } from '../../utilities/layout.js'

import { PAYLOAD_CLASS } from '../../utilities/payloadAdmin.js'
import classes from './Editor.module.css'
import {
  BAR_FOLDS,
  type BarFold,
  FOLDED_ATTRIBUTE,
  HINT_ICON_ATTRIBUTE,
  HINT_SENTENCE_ATTRIBUTE,
} from './editorStyles.js'
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
 * Folds the bar until everything in it fits: the first of `folds`' prefixes -
 * none folded, the first, the first two, ... - at which the bar does not
 * overflow, or all of them when none does. Every part of the bar keeps its
 * own width (see the editor stylesheet), so too little room shows as overflow
 * rather than as one control drawn over another.
 */
export const foldToFit = (bar: HTMLElement, folds: readonly BarFold[]): void => {
  for (let count = 0; count <= folds.length; count++) {
    const value = folds.slice(0, count).join(' ')
    if (value) {
      bar.setAttribute(FOLDED_ATTRIBUTE, value)
    } else {
      bar.removeAttribute(FOLDED_ATTRIBUTE)
    }
    if (bar.scrollWidth <= bar.clientWidth) {
      return
    }
  }
}

/**
 * The editor's part of Payload's bar above the preview: the screen widths,
 * and what a click in the preview does - the sentence where it fits, an icon
 * carrying it where it does not, and where a click is going while it goes.
 *
 * Here because all of it is about the preview, and because this bar has room
 * where Payload's document controls have none - until the divider makes the
 * preview narrow. Then the bar folds what matters least, ours and Payload's
 * alike, measured rather than guessed at: the sentence, and Payload's labels,
 * are as long as the admin's language makes them.
 */
export const PreviewTools: React.FC<Props> = ({ hint, language, status, strings, viewports }) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const offersViewports = viewports.length > 0

  useLayoutEffect(() => {
    const bar = rootRef.current?.closest<HTMLElement>(`.${PAYLOAD_CLASS.livePreviewToolbar}`)
    if (!bar) {
      return
    }
    // Payload's breakpoint menu only goes where the screen widths stand in for it.
    const folds = offersViewports ? BAR_FOLDS : BAR_FOLDS.filter((fold) => fold !== 'breakpoint')
    const fit = () => foldToFit(bar, folds)
    fit()
    // The bar's width (divider, window), and what Payload's controls hold: a
    // breakpoint's label changes with the breakpoint.
    const observer = new ResizeObserver(fit)
    observer.observe(bar)
    const controls = bar.querySelector(`.${PAYLOAD_CLASS.livePreviewToolbarControls}`)
    if (controls) {
      observer.observe(controls)
    }
    return () => {
      observer.disconnect()
      bar.removeAttribute(FOLDED_ATTRIBUTE)
    }
  }, [hint, offersViewports])

  return (
    <div className={classes.previewTools} data-payload-live-preview-inspector-preview-tools="" ref={rootRef}>
      {offersViewports && <ViewportControls language={language} strings={strings} viewports={viewports} />}
      {/*
       * The hint keeps its room while a status covers it, so a click on its
       * way does not refold the bar under the editor's pointer.
       */}
      <div className={classes.hintSlot} data-busy={status ? '' : undefined}>
        <div className={`${classes.hint} ${classes.hintSentence}`} {...{ [HINT_SENTENCE_ATTRIBUTE]: '' }}>
          {hint}
        </div>
        {/*
         * Where the sentence does not fit, it is still there to find: the only
         * place an editor learns that the modifier gives them the page back.
         */}
        <span
          aria-label={hint}
          className={classes.hintIcon}
          role="img"
          title={hint}
          {...{ [HINT_ICON_ATTRIBUTE]: '' }}
        >
          <InfoIcon />
        </span>
        {status && (
          <div className={`${classes.hint} ${classes.hintActive} ${classes.status}`} role="status">
            {status.text}
          </div>
        )}
      </div>
    </div>
  )
}
