'use client'

import React, { useEffect, useRef } from 'react'

import type { EditorStrings } from '../../utilities/i18n.js'
import type { OutlineNode } from '../../utilities/structure.js'

import classes from './Editor.module.css'
import { ChevronIcon, FocusIcon } from './icons.js'

type Props = {
  /** The rows from the outermost down to the selected one. */
  chain: OutlineNode[]
  /** Focus mode is on: the bar is also how to widen what it shows. */
  focusMode: boolean
  /** The row focus mode shows. */
  focusRootPath: null | string
  /** A crumb: `null` is "all fields". */
  onSelect: (node: null | OutlineNode) => void
  /** Focus mode's switch, also here - on a phone the only place it fits. Absent when focus mode is off for the site. */
  onToggleFocus?: () => void
  strings: EditorStrings
}

/**
 * Where in the document the editor is: "Section 3 › Row 1 › Column 2 › Text 1",
 * pinned above the form.
 *
 * Four levels of rows look alike from the inside - a column's fields do not say
 * which section they are in - and this says it. Every crumb goes there; in
 * focus mode the first one, "All fields", shows the whole form again.
 */
export const PathBar: React.FC<Props> = ({ chain, focusMode, focusRootPath, onSelect, onToggleFocus, strings }) => {
  const barRef = useRef<HTMLElement>(null)

  // A long path keeps its end - the row the editor is in - in view.
  useEffect(() => {
    const bar = barRef.current
    if (bar) {
      bar.scrollLeft = bar.scrollWidth
    }
  }, [chain])

  const last = chain[chain.length - 1]

  return (
    <nav aria-label={strings.path} className={classes.pathBar} data-payload-live-preview-inspector-path="" ref={barRef}>
      <ol className={classes.crumbs}>
        {focusMode && (
          <li className={classes.crumb}>
            <button
              aria-current={!focusRootPath ? 'true' : undefined}
              className={classes.crumbButton}
              onClick={() => onSelect(null)}
              type="button"
            >
              {strings.allFields}
            </button>
          </li>
        )}
        {chain.map((node, index) => (
          <li className={classes.crumb} key={node.rowIDPath}>
            {(focusMode || index > 0) && (
              <span aria-hidden="true" className={classes.crumbSeparator}>
                <ChevronIcon />
              </span>
            )}
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
      {onToggleFocus && (
        <button
          aria-label={focusMode ? strings.focusModeOff : strings.focusModeOn}
          aria-pressed={focusMode}
          className={`${classes.button} ${classes.pathFocus}`}
          data-payload-live-preview-inspector-path-focus=""
          onClick={onToggleFocus}
          title={focusMode ? strings.focusModeOff : strings.focusModeOn}
          type="button"
        >
          <FocusIcon />
          <span className={classes.buttonLabel}>{strings.focusMode}</span>
        </button>
      )}
    </nav>
  )
}
