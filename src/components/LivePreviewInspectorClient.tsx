'use client'

import { useEffect } from 'react'

import type { DocumentLeafValue } from '../utilities/pathResolution.js'

import { applyValueMatching, findTaggedElementAt, inferBlockContainers, scanStega } from '../utilities/autoTag.js'
import { LIVE_PREVIEW_HOVER_CLASS_NAME } from '../utilities/hoverClassName.js'
import {
  CLICK_MESSAGE_TYPE,
  DOCUMENT_VALUES_MESSAGE_TYPE,
  REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE,
} from '../utilities/messageTypes.js'
import { LIVE_PREVIEW_PATH_ATTRIBUTE } from '../utilities/pathAttribute.js'
import classes from './LivePreviewInspectorClient.module.css'

export { LIVE_PREVIEW_HOVER_CLASS_NAME }

/** Minimum gap between two document-value requests to the admin panel. */
const REQUEST_THROTTLE_MS = 300

export type LivePreviewInspectorClientProps = {
  /**
   * When true, clicking a link (`<a href>`) inside the Live Preview iframe -
   * including client-side router links like Next.js' `<Link>` - does nothing
   * instead of navigating away. Live Preview is normally used to inspect
   * fields, not to browse, so this is on by default; set to `false` to
   * restore normal link navigation.
   * @default true
   */
  disableLinks?: boolean
  /**
   * Outline color used to highlight the hovered element. Defaults to the
   * shipped CSS (`LivePreviewInspectorClient.module.css`) if omitted.
   */
  hoverColor?: string
  /**
   * Decodes paths that `inspectable(data, { stega: true })` encoded into
   * string values as invisible characters, and tags the elements rendering
   * them - no `pathOf()` needed for text content. Costs one DOM scan per
   * render batch inside the iframe; does nothing when no encoded strings are
   * present.
   * @default true
   */
  stega?: boolean
  /**
   * Origin of the Payload admin panel embedding this page (e.g.
   * `'https://cms.example.com'`), used as the `postMessage` target origin.
   * When omitted, the origin is derived from `window.location.ancestorOrigins`
   * or `document.referrer`, falling back to `'*'` if neither resolves.
   */
  targetOrigin?: string
  /**
   * Zero-config tagging: asks the admin panel for the document's current
   * string field values and tags any element whose whole text equals exactly
   * one field's value - no frontend data changes needed at all. Ambiguous
   * values (shared by several fields) are never matched, and explicit or
   * stega tags always win. Requires the plugin to be registered for the
   * edited collection/global; without it the request goes unanswered and
   * nothing happens.
   * @default true
   */
  valueMatching?: boolean
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
  disableLinks = true,
  hoverColor,
  stega = true,
  targetOrigin,
  valueMatching = true,
}) => {
  useEffect(() => {
    if (window.self === window.top) {
      // Not embedded in an iframe (e.g. viewed directly outside live preview) - no-op.
      return
    }

    let hovered: HTMLElement | null = null
    let hoverFrame = 0

    // Point-based first: `elementsFromPoint` sees tagged elements *through*
    // covering overlays (full-card links etc.) that swallow every pointer
    // event as their target. The `closest()` chain is the fallback for
    // events without useful coordinates.
    const findTarget = (event: MouseEvent): HTMLElement | null =>
      findTaggedElementAt(document, event.clientX, event.clientY) ??
      ((event.target as Element | null)?.closest?.(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}]`) as HTMLElement | null)

    const unhighlight = (el: HTMLElement) => {
      el.classList.remove(classes.hovered, LIVE_PREVIEW_HOVER_CLASS_NAME)
      if (hoverColor) {
        el.style.removeProperty('outline-color')
      }
    }

    const setHovered = (el: HTMLElement | null) => {
      if (el === hovered) {
        return
      }
      if (hovered) {
        unhighlight(hovered)
      }
      if (el) {
        el.classList.add(classes.hovered, LIVE_PREVIEW_HOVER_CLASS_NAME)
        if (hoverColor) {
          el.style.outlineColor = hoverColor
        }
      }
      hovered = el
    }

    // mousemove (not mouseover): beneath an overlay the event target never
    // changes while the pointer moves across different tagged elements, so
    // enter/leave events can't track the highlight - re-resolving the point
    // each frame can.
    const onMouseMove = (event: MouseEvent) => {
      if (hoverFrame) {
        return
      }
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0
        setHovered(findTarget(event))
      })
    }

    const onMouseLeave = () => {
      setHovered(null)
    }

    const onClick = (event: MouseEvent) => {
      if (disableLinks) {
        const link = (event.target as Element | null)?.closest?.('a[href]')
        if (link) {
          // Capture-phase + stopPropagation so this runs before (and blocks)
          // a client-side router's own click handler (e.g. Next.js' <Link>),
          // which navigates via history.pushState regardless of
          // preventDefault - a bubble-phase listener would be too late.
          event.preventDefault()
          event.stopPropagation()
        }
      }

      const el = findTarget(event)
      if (!el) {
        return
      }

      const path = el.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)
      if (!path) {
        return
      }

      window.parent.postMessage({ type: CLICK_MESSAGE_TYPE, path }, targetOrigin ?? resolveTargetOrigin())
    }

    document.addEventListener('mousemove', onMouseMove)
    document.documentElement.addEventListener('mouseleave', onMouseLeave)
    document.addEventListener('click', onClick, { capture: true })

    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.documentElement.removeEventListener('mouseleave', onMouseLeave)
      document.removeEventListener('click', onClick, { capture: true })
      if (hoverFrame) {
        cancelAnimationFrame(hoverFrame)
      }
      setHovered(null)
    }
  }, [disableLinks, hoverColor, targetOrigin])

  // Auto-tagging: decode stega paths and/or match field values whenever the
  // preview (re-)renders, then infer block containers from the tagged leaves.
  useEffect(() => {
    if (window.self === window.top || (!stega && !valueMatching)) {
      return
    }

    const resolvedOrigin = targetOrigin ?? resolveTargetOrigin()

    let leaves: DocumentLeafValue[] = []
    let receivedLeaves = false
    let scheduledScan = 0
    let requestTimer: ReturnType<typeof setTimeout> | undefined
    let bootstrapTimer: ReturnType<typeof setTimeout> | undefined
    let lastRequestAt = 0

    const scan = () => {
      scheduledScan = 0
      if (stega) {
        scanStega(document)
      }
      if (valueMatching && leaves.length > 0) {
        applyValueMatching(document, leaves)
      }
      inferBlockContainers(document)
    }

    const scheduleScan = () => {
      if (!scheduledScan) {
        scheduledScan = requestAnimationFrame(scan)
      }
    }

    const requestLeaves = () => {
      if (!valueMatching) {
        return
      }
      const wait = lastRequestAt + REQUEST_THROTTLE_MS - Date.now()
      if (wait > 0) {
        requestTimer ??= setTimeout(() => {
          requestTimer = undefined
          requestLeaves()
        }, wait)
        return
      }
      lastRequestAt = Date.now()
      window.parent.postMessage({ type: REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE }, resolvedOrigin)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) {
        return
      }
      if (resolvedOrigin !== '*' && event.origin !== resolvedOrigin) {
        return
      }

      const { data } = event
      if (!data || typeof data !== 'object' || data.type !== DOCUMENT_VALUES_MESSAGE_TYPE || !Array.isArray(data.leaves)) {
        return
      }

      leaves = (data.leaves as unknown[]).filter(
        (leaf): leaf is DocumentLeafValue =>
          !!leaf &&
          typeof leaf === 'object' &&
          typeof (leaf as DocumentLeafValue).path === 'string' &&
          typeof (leaf as DocumentLeafValue).value === 'string',
      )
      receivedLeaves = true
      scheduleScan()
    }

    const observer = new MutationObserver(() => {
      scheduleScan()
      // The preview re-rendered, so field values likely changed too.
      requestLeaves()
    })

    if (valueMatching) {
      window.addEventListener('message', onMessage)
    }
    observer.observe(document.documentElement, { characterData: true, childList: true, subtree: true })

    scheduleScan()

    // The admin listener may mount after us (or not at all, when the plugin
    // isn't registered for this document) - retry the initial request with
    // backoff instead of waiting for a DOM mutation that may never come.
    let bootstrapAttempts = 0
    const bootstrap = () => {
      if (receivedLeaves || bootstrapAttempts >= 5) {
        return
      }
      bootstrapAttempts += 1
      requestLeaves()
      bootstrapTimer = setTimeout(bootstrap, 500 * bootstrapAttempts)
    }
    bootstrap()

    return () => {
      observer.disconnect()
      if (valueMatching) {
        window.removeEventListener('message', onMessage)
      }
      if (scheduledScan) {
        cancelAnimationFrame(scheduledScan)
      }
      if (requestTimer) {
        clearTimeout(requestTimer)
      }
      if (bootstrapTimer) {
        clearTimeout(bootstrapTimer)
      }
    }
  }, [stega, targetOrigin, valueMatching])

  return null
}
