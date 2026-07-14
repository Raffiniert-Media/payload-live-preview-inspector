'use client'

import { useEffect } from 'react'

import { LIVE_PREVIEW_PATH_ATTRIBUTE } from '../utilities/pathAttribute.js'
import classes from './LivePreviewInspectorClient.module.css'

const MESSAGE_TYPE = 'payload-live-preview-inspector:click'

/**
 * Stable, unscoped class name applied to the currently hovered element, in
 * addition to the plugin's own shipped hover styles, so consumers can
 * restyle the highlight via their own global CSS if desired.
 */
export const LIVE_PREVIEW_HOVER_CLASS_NAME = 'payload-live-preview-inspector-hovered'

export type LivePreviewInspectorClientProps = {
  /**
   * Outline color used to highlight the hovered element. Defaults to the
   * shipped CSS (`LivePreviewInspectorClient.module.css`) if omitted.
   */
  hoverColor?: string
  /**
   * Origin of the Payload admin panel embedding this page (e.g.
   * `'https://cms.example.com'`), used as the `postMessage` target origin.
   * When omitted, the origin is derived from `window.location.ancestorOrigins`
   * or `document.referrer`, falling back to `'*'` if neither resolves.
   */
  targetOrigin?: string
}

const resolveTargetOrigin = (): string => {
  try {
    const [ancestorOrigin] = window.location.ancestorOrigins ?? []
    if (ancestorOrigin) {
      return ancestorOrigin
    }
  } catch {
    // ancestorOrigins is not available in all browsers (e.g. Firefox)
  }

  if (document.referrer) {
    try {
      return new URL(document.referrer).origin
    } catch {
      // fall through
    }
  }

  return '*'
}

export const LivePreviewInspectorClient: React.FC<LivePreviewInspectorClientProps> = ({
  hoverColor,
  targetOrigin,
}) => {
  useEffect(() => {
    if (window.self === window.top) {
      // Not embedded in an iframe (e.g. viewed directly outside live preview) - no-op.
      return
    }

    let hovered: HTMLElement | null = null

    const findTarget = (event: Event): HTMLElement | null =>
      (event.target as Element | null)?.closest?.(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}]`) as HTMLElement | null

    const unhighlight = (el: HTMLElement) => {
      el.classList.remove(classes.hovered, LIVE_PREVIEW_HOVER_CLASS_NAME)
      if (hoverColor) {
        el.style.removeProperty('outline-color')
      }
    }

    const onMouseOver = (event: MouseEvent) => {
      const el = findTarget(event)
      if (el && el !== hovered) {
        if (hovered) {
          unhighlight(hovered)
        }
        el.classList.add(classes.hovered, LIVE_PREVIEW_HOVER_CLASS_NAME)
        if (hoverColor) {
          el.style.outlineColor = hoverColor
        }
        hovered = el
      }
    }

    const onMouseOut = (event: MouseEvent) => {
      const el = findTarget(event)
      if (el && !el.contains(event.relatedTarget as Node | null)) {
        unhighlight(el)
        if (hovered === el) {
          hovered = null
        }
      }
    }

    const onClick = (event: MouseEvent) => {
      const el = findTarget(event)
      if (!el) {
        return
      }

      const path = el.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)
      if (!path) {
        return
      }

      window.parent.postMessage({ type: MESSAGE_TYPE, path }, targetOrigin ?? resolveTargetOrigin())
    }

    document.addEventListener('mouseover', onMouseOver)
    document.addEventListener('mouseout', onMouseOut)
    document.addEventListener('click', onClick)

    return () => {
      document.removeEventListener('mouseover', onMouseOver)
      document.removeEventListener('mouseout', onMouseOut)
      document.removeEventListener('click', onClick)
      if (hovered) {
        unhighlight(hovered)
      }
    }
  }, [hoverColor, targetOrigin])

  return null
}
