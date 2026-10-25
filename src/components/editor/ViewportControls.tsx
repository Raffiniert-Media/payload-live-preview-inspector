'use client'

import { useLivePreviewContext } from '@payloadcms/ui'
import React, { useCallback, useEffect, useRef } from 'react'

import type { EditorStrings } from '../../utilities/i18n.js'
import type { Viewport } from '../../utilities/layout.js'

import { fitDevice, isNullableString, viewportLabel } from '../../utilities/layout.js'
import { livePreviewMainEl, PAYLOAD_PROPERTY, payloadPropertyPx } from '../../utilities/payloadAdmin.js'
import { useStored } from './dom.js'
import classes from './Editor.module.css'
import { DesktopIcon, PhoneIcon, TabletIcon } from './icons.js'

const VIEWPORT_KEY = 'payload-live-preview-inspector:viewport'

/** Payload's breakpoint for a size it was given rather than one from the config. */
const CUSTOM = 'custom'
const RESPONSIVE = 'responsive'

const iconFor = (viewport: Viewport, index: number, count: number) => {
  if (viewport.width < 600) {
    return <PhoneIcon />
  }
  if (viewport.width < 1100 && index < count - 1) {
    return <TabletIcon />
  }
  return <DesktopIcon />
}

const defaultLabel = (viewport: Viewport, strings: EditorStrings) =>
  viewport.name === 'mobile'
    ? strings.viewportMobile
    : viewport.name === 'tablet'
      ? strings.viewportTablet
      : viewport.name === 'desktop'
        ? strings.viewportDesktop
        : viewport.name

type Props = {
  language: string
  strings: EditorStrings
  viewports: Viewport[]
}

/**
 * Phone, tablet, desktop - one click each, and the page is laid out at that
 * width inside the preview.
 *
 * Payload can show a device size already, but only sizes a site configured, and
 * one wider than the panel is cut off until someone picks a zoom that fits. Here
 * the zoom follows the panel: a desktop page is shrunk to fit, a phone is shown
 * at its real size, and both stay that way while the divider moves. It drives
 * Payload's own preview frame - its size and zoom - so Payload's toolbar shows
 * the same numbers and can take over at any time; picking something there lets
 * this go.
 *
 * Clicking the chosen one again goes back to the preview's own width.
 */
export const ViewportControls: React.FC<Props> = ({ language, strings, viewports }) => {
  const { breakpoint, setBreakpoint, setSize, setZoom } = useLivePreviewContext()
  const [active, setActive] = useStored<null | string>(VIEWPORT_KEY, isNullableString, null)
  const applied = useRef<null | string>(null)
  const viewport = viewports.find((candidate) => candidate.name === active) ?? null

  const fit = useCallback(() => {
    const main = livePreviewMainEl()
    if (!viewport || !main) {
      return
    }
    // Payload pads the frame by one unit on every side once a size is set.
    const pad = payloadPropertyPx(PAYLOAD_PROPERTY.base, 20) * 2
    const rect = main.getBoundingClientRect()
    const { height, width, zoom } = fitDevice(viewport.width, { height: rect.height - pad, width: rect.width - pad })
    applied.current = CUSTOM
    setBreakpoint(CUSTOM)
    setSize({ type: 'reset', value: { height, width } })
    setZoom(zoom)
  }, [setBreakpoint, setSize, setZoom, viewport])

  // Kept fitted while the panel changes size: the divider, the window, the outline.
  useEffect(() => {
    if (!viewport) {
      return
    }
    let frame = 0
    const refit = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    }
    fit()
    const main = livePreviewMainEl()
    const panel = main?.parentElement?.parentElement ?? main
    const observer = new ResizeObserver(refit)
    if (panel) {
      observer.observe(panel)
    }
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [fit, viewport])

  // Someone picked a breakpoint in Payload's own toolbar: theirs wins.
  useEffect(() => {
    if (applied.current === CUSTOM && breakpoint !== CUSTOM) {
      applied.current = null
      setActive(null)
    }
  }, [breakpoint, setActive])

  const choose = (name: string) => {
    if (name === active) {
      applied.current = null
      setActive(null)
      setBreakpoint(RESPONSIVE)
      setZoom(1)
      return
    }
    setActive(name)
  }

  return (
    <div aria-label={strings.viewport} className={`${classes.group} ${classes.viewports}`} role="group">
      {viewports.map((candidate, index) => {
        const label = viewportLabel(candidate, language, defaultLabel(candidate, strings))
        return (
          <button
            aria-label={`${label} (${candidate.width}px)`}
            aria-pressed={candidate.name === active}
            className={classes.button}
            data-viewport={candidate.name}
            key={candidate.name}
            onClick={() => choose(candidate.name)}
            title={candidate.name === active ? `${label} (${candidate.width}px) – ${strings.viewportFit}` : `${label} (${candidate.width}px)`}
            type="button"
          >
            {iconFor(candidate, index, viewports.length)}
          </button>
        )
      })}
    </div>
  )
}
