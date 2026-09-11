'use client'

import { useEffect } from 'react'

import type { DocumentLeafValue } from '../utilities/pathResolution.js'

import {
  applyValueMatching,
  findTaggedElementAt,
  findTaggedElementByPath,
  inferBlockContainers,
  scanStega,
} from '../utilities/autoTag.js'
import { caretHintFromPoint, parseCaretHint } from '../utilities/caret.js'
import { LIVE_PREVIEW_HOVER_CLASS_NAME } from '../utilities/hoverClassName.js'
import {
  CLICK_MESSAGE_TYPE,
  DOCUMENT_VALUES_MESSAGE_TYPE,
  FOCUS_MESSAGE_TYPE,
  REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE,
  SETTINGS_MESSAGE_TYPE,
} from '../utilities/messageTypes.js'
import { LIVE_PREVIEW_PATH_ATTRIBUTE } from '../utilities/pathAttribute.js'
import { flashElement } from '../utilities/pathResolution.js'
import classes from './LivePreviewInspectorClient.module.css'

export { LIVE_PREVIEW_HOVER_CLASS_NAME }

/** Minimum gap between two document-value requests to the admin panel. */
const REQUEST_THROTTLE_MS = 300

export type LivePreviewInspectorClientProps = {
  /**
   * When true, a click inside the Live Preview iframe that resolves to a field
   * *only* reveals that field: the page's own handler never runs, so a card
   * does not open its dialog, a popup trigger does not open its popup and a
   * carousel arrow does not advance. This is what click-to-field means, and
   * without it every such click does two things at once.
   *
   * A click that resolves to **no** field is never suppressed. The header, the
   * cookie banner and anything else outside the edited document keep working,
   * which is the line this draws: the inspector only takes a click it can
   * answer with a field.
   *
   * Hold `interactionModifier` to operate the page anyway.
   * @default true
   */
  disableInteractions?: boolean
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
   * Held down, this key turns a click back into an ordinary click: the page
   * behaves like a page and no field is revealed. It is how an editor opens a
   * dialog, steps a carousel or expands an accordion to look at the content
   * inside it — which is also the only way to reach that content in order to
   * click into *it*.
   *
   * `'none'` removes the escape hatch entirely.
   *
   * Links are the exception and stay blocked either way when `disableLinks` is
   * on: every browser gives alt-, meta- and shift-click on a link its own
   * meaning (download, new tab, new window), so letting one through would not
   * mean "navigate" anyway — and leaving the preview is never what the click
   * was for.
   * @default 'alt'
   */
  interactionModifier?: 'alt' | 'ctrl' | 'meta' | 'none' | 'shift'
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

/**
 * Whether the click asked to be an ordinary click.
 *
 * Named keys rather than `event.getModifierState`, because the four names this
 * accepts are the plugin's API and have to keep meaning the same thing on every
 * platform: `'alt'` is Option on a Mac and Alt elsewhere, `'meta'` is Command
 * and the Windows key.
 */
const modifierHeld = (
  event: MouseEvent,
  modifier: 'alt' | 'ctrl' | 'meta' | 'none' | 'shift',
): boolean => {
  switch (modifier) {
    case 'alt':
      return event.altKey
    case 'ctrl':
      return event.ctrlKey
    case 'meta':
      return event.metaKey
    case 'shift':
      return event.shiftKey
    default:
      return false
  }
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
  disableInteractions = true,
  disableLinks = true,
  hoverColor,
  interactionModifier = 'alt',
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

    // Capture-phase + stopPropagation everywhere below, so this runs before
    // (and blocks) a client-side router's or React's own click handler - both
    // of which act regardless of preventDefault. A bubble-phase listener would
    // be too late.
    const swallow = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
    }

    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href]')

      // The escape hatch: with the modifier held, the page is just a page.
      // Links stay blocked regardless - see `interactionModifier` for why
      // letting one through would not mean "navigate".
      if (modifierHeld(event, interactionModifier)) {
        if (disableLinks && link) {
          swallow(event)
        }
        return
      }

      if (disableLinks && link) {
        swallow(event)
      }

      const el = findTarget(event)
      if (!el) {
        return
      }

      const path = el.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)
      if (!path) {
        return
      }

      // Only now, with a field to answer with: the click belongs to the
      // inspector rather than to the page. Links were already handled above,
      // and swallowing one twice would be harmless but misleading to read.
      if (disableInteractions && !link) {
        swallow(event)
      }

      // Where inside the text the click landed, so the admin can put the
      // cursor there instead of at the top of the field's editor. `null`
      // whenever the point isn't on text belonging to `el`.
      const caret = caretHintFromPoint(document, event.clientX, event.clientY, el)

      window.parent.postMessage(
        { type: CLICK_MESSAGE_TYPE, caret, path },
        targetOrigin ?? resolveTargetOrigin(),
      )
    }

    /*
     * Tell the admin what this preview does with a click, so its hint can say
     * so. Sent from here rather than from its own effect because it describes
     * exactly the handler installed on the next line - one place to change if
     * either ever stops matching.
     *
     * A listener that mounts later misses it and keeps the shorter hint, which
     * is the right way for this to fail: the sentence that is left is true.
     */
    window.parent.postMessage(
      { type: SETTINGS_MESSAGE_TYPE, disableInteractions, interactionModifier },
      targetOrigin ?? resolveTargetOrigin(),
    )

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
  }, [disableInteractions, disableLinks, hoverColor, interactionModifier, targetOrigin])

  // Reverse direction: a field focused in the admin form scrolls to and
  // flashes the matching element here, the same way a click there scrolls
  // the admin form.
  useEffect(() => {
    if (window.self === window.top) {
      return
    }

    const resolvedOrigin = targetOrigin ?? resolveTargetOrigin()

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) {
        return
      }
      if (resolvedOrigin !== '*' && event.origin !== resolvedOrigin) {
        return
      }

      const { data } = event
      if (!data || typeof data !== 'object' || data.type !== FOCUS_MESSAGE_TYPE || typeof data.path !== 'string') {
        return
      }

      const el = findTaggedElementByPath(document, data.path, parseCaretHint(data.caret)?.text)
      if (!el) {
        return
      }

      const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth'
      el.scrollIntoView({ behavior, block: 'nearest', inline: 'nearest' })
      flashElement(el, { className: classes.focused, color: hoverColor })
    }

    window.addEventListener('message', onMessage)

    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [hoverColor, targetOrigin])

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
