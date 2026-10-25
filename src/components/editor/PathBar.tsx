'use client'

import React, { useEffect, useRef } from 'react'

import type { EditorStrings } from '../../utilities/i18n.js'
import type { OutlineNode } from '../../utilities/structure.js'

import classes from './Editor.module.css'
import { ChevronIcon, CloseIcon, FocusIcon, OutlineIcon } from './icons.js'

type Props = {
  /** The rows from the outermost down to the selected one. */
  chain: OutlineNode[]
  /** Focus mode is on: the bar is also how to widen what it shows. */
  focusMode: boolean
  /** The row focus mode shows. */
  focusRootPath: null | string
  /** Puts the form away - page mode on a narrow screen, where the form is a sheet over the page. */
  onClose?: () => void
  /** A crumb: `null` is "all fields". */
  onSelect: (node: null | OutlineNode) => void
  /** Focus mode's switch; absent when the site turned focus mode off. */
  onToggleFocus?: () => void
  /** The outline's switch; absent when the site turned the outline off. */
  onToggleOutline?: () => void
  outlineOpen: boolean
  /** Whether to spell out where the editor is - the site may want only the switches. */
  showPath: boolean
  strings: EditorStrings
}

/**
 * The editor's bar above the form: the outline and focus mode on the left,
 * and where in the document the editor is - "Section 3 › Row 1 › Column 2 ›
 * Text 1" - beside them.
 *
 * Its own bar rather than buttons in Payload's document controls: those hold
 * Payload's status, dates and save buttons, and with ours beside them none of
 * it fitted - on a laptop the dates were cut, on a phone the publish button.
 * As high as Payload's bar above the preview, and level with it, so the two
 * read as one bar across the screen: the form's half and the preview's half.
 *
 * Four levels of rows look alike from the inside - a column's fields do not say
 * which section they are in - and the path says it. Every crumb goes there;
 * the first one, "All fields", shows the whole form again in focus mode.
 */
export const PathBar: React.FC<Props> = ({
  chain,
  focusMode,
  focusRootPath,
  onClose,
  onSelect,
  onToggleFocus,
  onToggleOutline,
  outlineOpen,
  showPath,
  strings,
}) => {
  const crumbsRef = useRef<HTMLOListElement>(null)

  // A long path keeps its end - the row the editor is in - in view.
  useEffect(() => {
    const crumbs = crumbsRef.current
    if (crumbs) {
      crumbs.scrollLeft = crumbs.scrollWidth
    }
  }, [chain])

  const last = chain[chain.length - 1]

  return (
    <nav aria-label={strings.path} className={classes.pathBar} data-payload-live-preview-inspector-path="">
      {(onToggleOutline || onToggleFocus) && (
        <div className={classes.pathBarSwitches}>
          {onToggleOutline && (
            <button
              aria-label={outlineOpen ? strings.outlineHide : strings.outlineShow}
              aria-pressed={outlineOpen}
              className={classes.button}
              data-payload-live-preview-inspector-outline-toggle=""
              onClick={onToggleOutline}
              title={outlineOpen ? strings.outlineHide : strings.outlineShow}
              type="button"
            >
              <OutlineIcon />
              <span className={classes.buttonLabel}>{strings.outline}</span>
            </button>
          )}
          {onToggleFocus && (
            <button
              aria-label={focusMode ? strings.focusModeOff : strings.focusModeOn}
              aria-pressed={focusMode}
              className={classes.button}
              data-payload-live-preview-inspector-focus-toggle=""
              onClick={onToggleFocus}
              title={focusMode ? strings.focusModeOff : strings.focusModeOn}
              type="button"
            >
              <FocusIcon />
              <span className={classes.buttonLabel}>{strings.focusMode}</span>
            </button>
          )}
        </div>
      )}
      {showPath && (
        <ol className={classes.crumbs} ref={crumbsRef}>
          <li className={classes.crumb}>
            <button
              aria-current={chain.length === 0 || (focusMode && !focusRootPath) ? 'true' : undefined}
              className={classes.crumbButton}
              onClick={() => onSelect(null)}
              type="button"
            >
              {strings.allFields}
            </button>
          </li>
          {chain.map((node) => (
            <li className={classes.crumb} key={node.rowIDPath}>
              <span aria-hidden="true" className={classes.crumbSeparator}>
                <ChevronIcon />
              </span>
              <button
                aria-current={node === last ? 'true' : undefined}
                className={[classes.crumbButton, node.rowIDPath === focusRootPath ? classes.crumbRoot : '']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(node)}
                title={node.summary ? `${node.label} · ${node.summary}` : node.label}
                type="button"
              >
                {node.label}
                {node === last && node.summary ? <span className={classes.crumbSummary}> · {node.summary}</span> : null}
              </button>
            </li>
          ))}
        </ol>
      )}
      {onClose && (
        <button
          aria-label={strings.closeForm}
          className={`${classes.button} ${classes.pathBarClose}`}
          data-payload-live-preview-inspector-close-form=""
          onClick={onClose}
          title={strings.closeForm}
          type="button"
        >
          <CloseIcon />
        </button>
      )}
    </nav>
  )
}
