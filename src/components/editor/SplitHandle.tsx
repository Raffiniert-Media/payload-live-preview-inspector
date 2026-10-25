'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { EditorStrings } from '../../utilities/i18n.js'

import { HOST_ATTRIBUTE } from '../../utilities/isolate.js'
import {
  clampPreviewHeightShare,
  clampPreviewShare,
  DEFAULT_PREVIEW_HEIGHT_SHARE,
  DEFAULT_PREVIEW_SHARE,
  isNumber,
  MIN_PANE_PX,
  previewShareAt,
  readStored,
  writeStored,
} from '../../utilities/layout.js'
import { docControlsEl, livePreviewWindowEl, PAYLOAD_PROPERTY, payloadPropertyPx } from '../../utilities/payloadAdmin.js'
import classes from './Editor.module.css'
import { EDITOR_PROPERTY, HOST, PAGE_ATTRIBUTE } from './editorStyles.js'

const SHARE_KEY = 'payload-live-preview-inspector:preview-share'

/**
 * The bar above the stacked preview. In page mode all of Payload's document
 * controls - the buttons and the status line above them - measured; else the
 * buttons' own height, which is all that sticks there.
 */
const barHeight = (): number => {
  const bar = document.documentElement.hasAttribute(PAGE_ATTRIBUTE) ? docControlsEl() : null
  return bar ? bar.getBoundingClientRect().height : payloadPropertyPx(PAYLOAD_PROPERTY.docControlsHeight, 56)
}
const HEIGHT_KEY = 'payload-live-preview-inspector:preview-height'

/** Step for an arrow key, and for one with Shift held. */
const KEY_STEP = 0.02
const KEY_STEP_LARGE = 0.1

type Props = {
  /** The row the form and the preview share, to measure. */
  getWrapper: () => HTMLElement | null
  /** The outline is open beside the form - its width counts against the form's side. */
  outlineOpen: boolean
  /** On a narrow screen the preview sits above the form, and the divider between them is horizontal. */
  stacked: boolean
  strings: EditorStrings
}

/**
 * The divider between form and preview, and what it moves.
 *
 * Payload splits the screen 40/60 and that is that; on a laptop the form is a
 * column too narrow for a rich-text toolbar, on a big screen the preview is
 * wider than any site's content. Dragging this sets the split, double-clicking
 * puts Payload's back, and the choice is remembered in the browser for every
 * document.
 *
 * Stored as a share rather than in pixels, so a window made smaller keeps the
 * proportion; applied in pixels, so neither side ever gets narrower than
 * `MIN_PANE_PX` whatever the window - the outline, when open, counts against the
 * form's side.
 *
 * Stacked - a narrow screen - it is a horizontal bar under the preview and sets
 * how much of the screen's height the preview takes.
 */
export const SplitHandle: React.FC<Props> = ({ getWrapper, outlineOpen, stacked, strings }) => {
  const [share, setShare] = useState(() => readStored(SHARE_KEY, isNumber, DEFAULT_PREVIEW_SHARE))
  const [heightShare, setHeightShare] = useState(() =>
    readStored(HEIGHT_KEY, isNumber, DEFAULT_PREVIEW_HEIGHT_SHARE),
  )
  const [dragging, setDragging] = useState(false)
  const ghostRef = useRef<HTMLDivElement>(null)
  const badgeRef = useRef<HTMLSpanElement>(null)
  /**
   * Where the stacked preview starts on screen, taken when a drag starts. Not
   * the document controls' height: that is only where it sticks once the
   * page is scrolled - at the top of the page Payload's header is above it,
   * and a height measured from the controls came out 200 px too tall.
   */
  const previewTopRef = useRef(0)
  const shareRef = useRef(share)
  shareRef.current = share
  const getWrapperRef = useRef(getWrapper)
  getWrapperRef.current = getWrapper

  /** The width the form and the preview divide: the row, less the outline and anything else of ours in it. */
  const measure = useCallback(() => {
    const wrapper = getWrapperRef.current()
    if (!wrapper) {
      return null
    }
    const rect = wrapper.getBoundingClientRect()
    let taken = 0
    let left = rect.left
    for (const child of Array.from(wrapper.children)) {
      if (child.getAttribute(HOST_ATTRIBUTE) === HOST.outline) {
        const width = child.getBoundingClientRect().width
        taken += width
        left += width
      }
    }
    return { left, width: rect.width - taken }
  }, [])

  const applyWidth = useCallback(
    (value: number) => {
      const space = measure()
      if (!space || space.width <= 0) {
        return
      }
      const px = Math.round(clampPreviewShare(value, space.width, MIN_PANE_PX) * space.width)
      document.documentElement.style.setProperty(EDITOR_PROPERTY.previewWidth, `${px}px`)
    },
    [measure],
  )

  const applyHeight = useCallback((value: number) => {
    const controls = barHeight()
    const px = Math.round(clampPreviewHeightShare(value) * (window.innerHeight - controls))
    document.documentElement.style.setProperty(EDITOR_PROPERTY.previewHeight, `${px}px`)
  }, [])

  // Kept applied while the window, the row or the outline beside it changes size.
  useEffect(() => {
    const apply = () => (stacked ? applyHeight(heightShare) : applyWidth(shareRef.current))
    apply()
    const wrapper = getWrapperRef.current()
    const observer = new ResizeObserver(apply)
    // The bar above: in page mode its status line comes and goes with the status.
    const bar = docControlsEl()
    if (stacked && bar) {
      observer.observe(bar)
    }
    if (wrapper) {
      observer.observe(wrapper)
      for (const child of Array.from(wrapper.children)) {
        if (child.getAttribute(HOST_ATTRIBUTE) === HOST.outline) {
          observer.observe(child)
        }
      }
    }
    window.addEventListener('resize', apply)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', apply)
    }
  }, [applyHeight, applyWidth, heightShare, outlineOpen, share, stacked])

  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(EDITOR_PROPERTY.previewWidth)
      document.documentElement.style.removeProperty(EDITOR_PROPERTY.previewHeight)
    },
    [],
  )

  const commit = useCallback(
    (value: number) => {
      if (stacked) {
        const next = clampPreviewHeightShare(value)
        setHeightShare(next)
        writeStored(HEIGHT_KEY, next)
      } else {
        const space = measure()
        const next = space ? clampPreviewShare(value, space.width) : value
        setShare(next)
        writeStored(SHARE_KEY, next)
      }
    },
    [measure, stacked],
  )

  const shareAt = useCallback(
    (event: { clientX: number; clientY: number }): null | number => {
      if (stacked) {
        const controls = barHeight()
        return (event.clientY - previewTopRef.current) / (window.innerHeight - controls)
      }
      const space = measure()
      return space ? previewShareAt(event.clientX, space.left, space.width) : null
    },
    [measure, stacked],
  )

  /**
   * Where the divider would land for `value`, drawn as a line over everything.
   *
   * Dragging used to resize the panes on every frame - and every frame then
   * laid out the whole site in the preview and the whole form beside it, which
   * on a real page is far more than a frame's worth of work: the divider
   * trailed the pointer. The line is one transform; the panes are resized
   * once, when it is let go.
   */
  const placeGhost = (value: number) => {
    const ghost = ghostRef.current
    const badge = badgeRef.current
    if (!ghost || !badge) {
      return
    }
    if (stacked) {
      const controls = barHeight()
      const height = Math.round(clampPreviewHeightShare(value) * (window.innerHeight - controls))
      ghost.style.transform = `translateY(${previewTopRef.current + height}px)`
      badge.textContent = `${height} px`
      return
    }
    const space = measure()
    if (!space) {
      return
    }
    const width = Math.round(clampPreviewShare(value, space.width, MIN_PANE_PX) * space.width)
    ghost.style.transform = `translateX(${space.left + space.width - width}px)`
    badge.textContent = `${space.width - width} px | ${width} px`
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    previewTopRef.current =
      livePreviewWindowEl()?.getBoundingClientRect().top ?? payloadPropertyPx(PAYLOAD_PROPERTY.docControlsHeight, 56)
    setDragging(true)
    let latest: null | number = null
    let frame = 0
    // The line starts where the divider is, once it has rendered.
    requestAnimationFrame(() => placeGhost(stacked ? heightShare : shareRef.current))

    const move = (moveEvent: PointerEvent) => {
      latest = shareAt(moveEvent)
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0
          if (latest !== null) {
            placeGhost(latest)
          }
        })
      }
    }
    const end = () => {
      cancelAnimationFrame(frame)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      setDragging(false)
      if (latest !== null) {
        commit(latest)
      }
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const current = stacked ? heightShare : share
    // The arrow points where the divider goes: left gives the preview more room.
    const delta: Record<string, number> = stacked
      ? { ArrowDown: step, ArrowUp: -step }
      : { ArrowLeft: step, ArrowRight: -step }
    if (event.key in delta) {
      event.preventDefault()
      commit(current + delta[event.key])
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      commit(event.key === 'Home' ? 1 : 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      reset()
    }
  }

  const reset = () => {
    if (stacked) {
      writeStored(HEIGHT_KEY, null)
      setHeightShare(DEFAULT_PREVIEW_HEIGHT_SHARE)
    } else {
      writeStored(SHARE_KEY, null)
      setShare(DEFAULT_PREVIEW_SHARE)
    }
  }

  const value = Math.round((stacked ? heightShare : share) * 100)

  return (
    <>
      {/*
       * A focusable separator with a value is ARIA's window splitter - an
       * interactive widget by definition, which the rule below does not know.
       */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        aria-label={stacked ? strings.previewHeight : strings.resizeSplit}
        aria-orientation={stacked ? 'horizontal' : 'vertical'}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={value}
        className={[stacked ? classes.splitVertical : classes.split, dragging ? classes.splitActive : '']
          .filter(Boolean)
          .join(' ')}
        data-payload-live-preview-inspector-split=""
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        role="separator"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the window splitter, see above
        tabIndex={0}
        title={stacked ? strings.previewHeight : strings.resizeSplit}
      >
        <span className={classes.grip} />
      </div>
      {dragging &&
        createPortal(
          // Over the preview's iframe, which would otherwise take the pointer
          // the moment it crosses into it - and the ground the line is drawn on.
          <div className={[classes.dragShield, stacked ? classes.dragShieldVertical : ''].join(' ')}>
            <div className={stacked ? classes.ghostRow : classes.ghostColumn} ref={ghostRef}>
              <span className={classes.ghostBadge} ref={badgeRef} />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
