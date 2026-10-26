'use client'

import React, { useEffect, useRef } from 'react'

import type { AutoTagger } from '../utilities/autoTagger.js'
import type { BlockToolbar, BlockToolbarAction } from '../utilities/blockToolbar.js'
import type { PreviewStrings } from '../utilities/i18n.js'
import type { DocumentLeafValue } from '../utilities/pathResolution.js'
import type { PreviewRow } from '../utilities/structure.js'

import { findTaggedElementAt, findTaggedElementByPath } from '../utilities/autoTag.js'
import { createAutoTagger } from '../utilities/autoTagger.js'
import { createBlockToolbar } from '../utilities/blockToolbar.js'
import { caretHintFromPoint, parseCaretHint } from '../utilities/caret.js'
import { createClickOverlay } from '../utilities/clickOverlay.js'
import { LIVE_PREVIEW_HOVER_CLASS_NAME } from '../utilities/hoverClassName.js'
import { createMarks, type Marks } from '../utilities/marks.js'
import {
  CLICK_MESSAGE_TYPE,
  DOCUMENT_VALUES_MESSAGE_TYPE,
  FOCUS_MESSAGE_TYPE,
  HOVER_MESSAGE_TYPE,
  REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE,
  REVEAL_STATUS_MESSAGE_TYPE,
  ROW_ACTION_MESSAGE_TYPE,
  SELECT_MESSAGE_TYPE,
  SETTINGS_MESSAGE_TYPE,
  STRUCTURE_MESSAGE_TYPE,
  THEME_MESSAGE_TYPE,
} from '../utilities/messageTypes.js'
import { isDocumentPath, LIVE_PREVIEW_PATH_ATTRIBUTE, rowIDPathOf } from '../utilities/pathAttribute.js'
import {
  flashElement,
  scrollToElement,
  topInset,
  uncover,
  UNCOVER_MARGIN_PX,
} from '../utilities/pathResolution.js'
import { Contained } from './Contained.js'
import classes from './LivePreviewInspectorClient.module.css'

export { LIVE_PREVIEW_HOVER_CLASS_NAME }

/**
 * How long a clicked element waits for the admin to acknowledge the click.
 * An admin that never does is running a version without reveal status - the
 * pending mark then goes quietly instead of lingering.
 */
const ACK_TIMEOUT_MS = 400
/** Longest a reveal is shown as pending once acknowledged. */
const PENDING_MAX_MS = 8_000

/** Custom property every mark in the preview takes its colour from. */
const ACCENT_PROPERTY = '--payload-live-preview-inspector-accent'

export type LivePreviewInspectorClientProps = {
  /**
   * A frame around the block the editor is at - the one they clicked into here,
   * or the one they are editing in the form - with a toolbar on it: move it,
   * duplicate it, add one below, remove it, or step out to the block around it.
   * The admin decides what each block allows, and does it; this only asks.
   * Needs the admin half of this plugin at the same version or later - an older
   * admin never sends the rows, and the toolbar never appears.
   * @default true
   */
  blockToolbar?: boolean
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
   * Colour of every mark in the preview - hover outline, click frame, label
   * chip, focus flash. Defaults to the admin's accent colour, which the admin
   * sends when the preview loads (Payload's `--theme-success-500`).
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
   * `'https://cms.example.com'`) - the only origin this page then listens to
   * and posts to. Defaults to the page's own origin, which is right whenever
   * Payload and the site are one app; set it when the admin runs elsewhere.
   * `'*'` trusts any page that frames this one - avoid it.
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

/**
 * Whether this link points into the page it is on rather than away from it.
 *
 * The distinction matters only under the modifier: a fragment link is a control
 * (a popup trigger, a disclosure), and letting the page act on it is the point.
 * A link that leaves stays blocked either way, because leaving the preview is
 * never what the click was for.
 *
 * Read off the anchor's resolved properties rather than its attribute, so
 * `#popup-x`, `/current-path#popup-x` and an absolute URL to the same page are
 * all the same answer.
 */
const isSamePageFragment = (link: HTMLAnchorElement): boolean =>
  Boolean(link.hash) &&
  link.pathname === window.location.pathname &&
  link.search === window.location.search &&
  link.host === window.location.host

/**
 * The admin's origin - the one origin this page listens to and posts to - or
 * `null` where it is not inside that admin, and stays out of the page's way.
 *
 * `targetOrigin` when given, else the page's own: Payload's admin and the
 * site it previews are one app at one origin unless someone split them, and
 * then they say which. Before 2.0 the origin of whatever framed the page was
 * taken on its word - so a page that framed a public site could receive the
 * paths and text of what a visitor clicked there.
 *
 * Where the browser names the framing origin (`ancestorOrigins`) and it is
 * another one, nothing starts at all; where it does not, every message still
 * goes to the admin's origin only, and the browser drops it anywhere else.
 */
const adminOriginOf = (targetOrigin: string | undefined): null | string => {
  if (window.self === window.top) {
    return null
  }
  const admin = targetOrigin ?? window.location.origin
  if (admin === '*') {
    return admin
  }
  let framedBy: string | undefined
  try {
    framedBy = window.location.ancestorOrigins?.[0]
  } catch {
    // Not in every browser.
  }
  return framedBy && framedBy !== admin ? null : admin
}

const isPreviewRow = (value: unknown): value is PreviewRow =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as PreviewRow).path === 'string' &&
  typeof (value as PreviewRow).label === 'string' &&
  typeof (value as PreviewRow).index === 'number' &&
  typeof (value as PreviewRow).count === 'number' &&
  Boolean((value as PreviewRow).abilities) &&
  typeof (value as PreviewRow).abilities === 'object'

const isPreviewStrings = (value: unknown): value is PreviewStrings =>
  Boolean(value) && typeof value === 'object' && typeof (value as PreviewStrings).moveUp === 'string'

/** The nearest path around `el` that is the edited document's own - the block a shown post sits in. */
const editedPathAround = (el: Element): null | string => {
  for (
    let node = el.parentElement?.closest(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}]`);
    node;
    node = node.parentElement?.closest(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}]`)
  ) {
    const path = node.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)
    if (path && !isDocumentPath(path)) {
      return path
    }
  }
  return null
}

const PreviewInspector: React.FC<LivePreviewInspectorClientProps> = ({
  blockToolbar = true,
  disableInteractions = true,
  disableLinks = true,
  hoverColor,
  interactionModifier = 'alt',
  stega = true,
  targetOrigin,
  valueMatching = true,
}) => {
  // The auto-tagger lives in its own effect; clicks and hovers flush it so
  // they never resolve against tags still waiting for an idle moment.
  const taggerRef = useRef<AutoTagger | null>(null)
  // The hover frame and the flash, in the top layer - see `utilities/marks.ts`.
  const marksRef = useRef<Marks | null>(null)

  useEffect(() => {
    // Not in the admin's live preview - viewed on its own, or framed by
    // another site: nothing to do here.
    const resolvedOrigin = adminOriginOf(targetOrigin)
    if (!resolvedOrigin) {
      return
    }
    let hovered: HTMLElement | null = null
    let hoverFrame = 0

    /*
     * The click being revealed, marked on its element until the admin says
     * how it went. Without it a click on a large page gave no sign of life
     * for the second or so a reveal can take - and a second click is what an
     * editor does when the first seemed to do nothing.
     */
    let clickCounter = 0
    let pendingID: number | undefined
    let pendingTimer: ReturnType<typeof setTimeout> | undefined
    const overlay = createClickOverlay(document, {
      box: classes.box,
      chip: classes.chip,
      clip: classes.clip,
      layer: classes.layer,
      ripple: classes.ripple,
    })
    const marks = createMarks(document, {
      flash: classes.flashMark,
      hover: classes.hoverMark,
      layer: classes.markLayer,
    })
    marksRef.current = marks

    /** The admin's words for what the preview says, once it has sent them. */
    let strings: null | PreviewStrings = null

    const toolbar: BlockToolbar | null = blockToolbar
      ? createBlockToolbar(
          document,
          {
            frame: classes.selectionFrame,
            hoverFrame: classes.hoverFrame,
            label: classes.toolbarLabel,
            layer: classes.selectionLayer,
            toolbar: classes.toolbar,
            toolbarButton: classes.toolbarButton,
            toolbarSeparator: classes.toolbarSeparator,
          },
          {
            onAction: (action: BlockToolbarAction, path: string) =>
              window.parent.postMessage({ type: ROW_ACTION_MESSAGE_TYPE, action, path }, resolvedOrigin),
          },
        )
      : null

    const endPending = (outcome?: 'done' | 'not-found') => {
      clearTimeout(pendingTimer)
      pendingID = undefined
      if (outcome) {
        overlay.finish(outcome)
      } else {
        overlay.hide()
      }
    }

    const onStatus = (event: MessageEvent) => {
      if (event.source !== window.parent || (resolvedOrigin !== '*' && event.origin !== resolvedOrigin)) {
        return
      }
      const { data } = event
      if (!data || typeof data !== 'object') {
        return
      }

      if (data.type === THEME_MESSAGE_TYPE) {
        // A configured `hoverColor` wins over the admin's accent.
        // A colour and nothing else: the value lands in a `background`, where
        // a `url()` would have the preview fetch whatever it names.
        if (!hoverColor && typeof data.accent === 'string' && CSS.supports('color', data.accent)) {
          document.documentElement.style.setProperty(ACCENT_PROPERTY, data.accent)
        }
        return
      }

      if (data.type === STRUCTURE_MESSAGE_TYPE) {
        if (isPreviewStrings(data.strings)) {
          strings = data.strings
        }
        if (toolbar && strings && Array.isArray(data.rows)) {
          toolbar.setStructure((data.rows as unknown[]).filter(isPreviewRow), strings)
        }
        return
      }

      if (data.type === SELECT_MESSAGE_TYPE) {
        toolbar?.select(typeof data.path === 'string' ? data.path : null)
        return
      }

      if (data.type === HOVER_MESSAGE_TYPE) {
        toolbar?.hover(typeof data.path === 'string' ? data.path : null)
        return
      }

      if (data.type !== REVEAL_STATUS_MESSAGE_TYPE || pendingID === undefined || data.id !== pendingID) {
        return
      }

      if (data.status === 'started') {
        clearTimeout(pendingTimer)
        pendingTimer = setTimeout(() => endPending(), PENDING_MAX_MS)
        if (typeof data.label === 'string') {
          overlay.setLabel(data.label)
        }
        return
      }

      if (data.status === 'not-found') {
        // The admin's reason when it has one - another document still open
        // with changes - and otherwise the usual one.
        overlay.setLabel(typeof data.label === 'string' ? data.label : (strings?.notInForm ?? 'Not in this form'))
      }
      endPending(data.status === 'not-found' ? 'not-found' : 'done')
    }

    // Point-based first: `elementsFromPoint` sees tagged elements *through*
    // covering overlays (full-card links etc.) that swallow every pointer
    // event as their target. The `closest()` chain is the fallback for
    // events without useful coordinates.
    const findTarget = (event: MouseEvent): HTMLElement | null =>
      findTaggedElementAt(document, event.clientX, event.clientY) ??
      ((event.target as Element | null)?.closest?.(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}]`) as HTMLElement | null)

    // One colour for every mark: `hoverColor` when configured, otherwise the
    // admin's accent once it arrives (see `THEME_MESSAGE_TYPE`).
    if (hoverColor) {
      document.documentElement.style.setProperty(ACCENT_PROPERTY, hoverColor)
    }

    const unhighlight = (el: HTMLElement) => {
      el.classList.remove(classes.hovered, LIVE_PREVIEW_HOVER_CLASS_NAME)
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
      }
      hovered = el
      marksRef.current?.hover(el)
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
        taggerRef.current?.flush()
        // Over the toolbar, the page beneath it is not what the pointer is on.
        setHovered(toolbar?.owns(event.target) ? null : findTarget(event))
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
      // The toolbar's own buttons: theirs, not the page's and not a reveal.
      if (toolbar?.owns(event.target)) {
        return
      }

      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null

      // The escape hatch: with the modifier held, the page is just a page.
      // Links stay blocked regardless - see `interactionModifier` for why
      // letting one through would not mean "navigate".
      if (modifierHeld(event, interactionModifier)) {
        if (disableLinks && link) {
          if (isSamePageFragment(link)) {
            // Stops the browser's own idea of an alt-click (a download) and of
            // a fragment (a jump), and lets the click carry on to the page -
            // which is how an in-page control built as a link, like a popup
            // trigger, can still be operated deliberately.
            event.preventDefault()
          } else {
            swallow(event)
          }
        }
        return
      }

      if (disableLinks && link) {
        swallow(event)
      }

      taggerRef.current?.flush()
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

      const id = ++clickCounter
      // The click mark replaces the hover outline - including one a hover
      // frame from the move just before the click would still apply. Moving
      // the pointer brings hover back.
      cancelAnimationFrame(hoverFrame)
      hoverFrame = 0
      setHovered(null)
      overlay.show(el, { x: event.clientX, y: event.clientY })
      // A field of another document - a post in a carousel - sits in a block
      // of this one all the same, and that block is where the editor is now.
      const context = isDocumentPath(path) ? editedPathAround(el) : null
      // The block the click landed in is the one the editor is at now.
      toolbar?.select(rowIDPathOf(context ?? path))
      pendingID = id
      // An admin that never acknowledges runs a version without reveal
      // status - the mark then goes quietly instead of lingering.
      clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => endPending(), ACK_TIMEOUT_MS)

      window.parent.postMessage({ id, type: CLICK_MESSAGE_TYPE, caret, context, path }, resolvedOrigin)
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
      resolvedOrigin,
    )

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        toolbar?.select(null)
      }
    }

    window.addEventListener('message', onStatus)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousemove', onMouseMove)
    document.documentElement.addEventListener('mouseleave', onMouseLeave)

    /*
     * On `window`, not on `document`, and that is the whole fix for a real
     * defect rather than a preference.
     *
     * A host page may have its own capture-phase listener on `document` - the
     * theme this plugin was written for has exactly that, opening a popup for
     * any link whose href ends in `#popup-...`. Two capture listeners on the
     * same node run in *registration* order, so which one wins depends on
     * which component mounted first, which neither of them controls. Measured
     * against that theme: a popup link inside a tagged section still opened its
     * popup on a plain click, because the host's listener was registered first.
     *
     * The capture phase descends Window -> Document -> ... , so a capture
     * listener here runs before any capture listener on `document` no matter
     * when either was added. Measured rather than assumed: registering
     * document-capture first and window-capture second still runs
     * window-capture first.
     */
    window.addEventListener('click', onClick, { capture: true })

    return () => {
      window.removeEventListener('message', onStatus)
      document.removeEventListener('keydown', onKeyDown)
      toolbar?.destroy()
      endPending()
      overlay.destroy()
      document.removeEventListener('mousemove', onMouseMove)
      document.documentElement.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('click', onClick, { capture: true })
      if (hoverFrame) {
        cancelAnimationFrame(hoverFrame)
      }
      setHovered(null)
      marks.destroy()
      marksRef.current = null
    }
  }, [blockToolbar, disableInteractions, disableLinks, hoverColor, interactionModifier, targetOrigin])

  // Reverse direction: a field focused in the admin form scrolls to and
  // flashes the matching element here, the same way a click there scrolls
  // the admin form.
  useEffect(() => {
    const resolvedOrigin = adminOriginOf(targetOrigin)
    if (!resolvedOrigin) {
      return
    }

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

      /*
       * Clear of the site's sticky header from the first frame on: where the
       * element should land is re-measured as the page moves (see
       * `topInset`), so the scroll ends where it should instead of ending
       * behind the header and jumping out from under it afterwards. Measured
       * against the dev page's header before this: a 570px leap after the
       * scroll had already stopped.
       *
       * An element already fully in view, clear of the header, stays put -
       * the editor is looking at it.
       */
      const offset = () => topInset(el) + UNCOVER_MARGIN_PX
      const { bottom, top } = el.getBoundingClientRect()
      // A section taller than the viewport never fits it: in view is also
      // one that fills the viewport, or starts in its upper half.
      const inView =
        (top >= offset() && (bottom <= window.innerHeight || top <= window.innerHeight / 2)) ||
        (top <= offset() && bottom >= window.innerHeight)
      void (async () => {
        if (!inView) {
          await scrollToElement(el, offset, 'smooth', undefined, true)
        }

        // Only a safety net now: a header that changed height at the last
        // moment. Normally it finds nothing to do.
        await uncover(el)
        flashElement(el, { className: classes.focused })
        marksRef.current?.flash(el)
      })()
    }

    window.addEventListener('message', onMessage)

    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [hoverColor, targetOrigin])

  // Auto-tagging: decode stega paths and/or match field values as the
  // preview renders, then infer block containers from the tagged leaves -
  // incrementally, see `createAutoTagger`.
  useEffect(() => {
    const resolvedOrigin = adminOriginOf(targetOrigin)
    if (!resolvedOrigin || (!stega && !valueMatching)) {
      return
    }

    const tagger = createAutoTagger(document, { stega, valueMatching })
    taggerRef.current = tagger

    let receivedLeaves = false
    let bootstrapTimer: ReturnType<typeof setTimeout> | undefined

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

      receivedLeaves = true
      tagger.setLeaves(
        (data.leaves as unknown[]).filter(
          (leaf): leaf is DocumentLeafValue =>
            !!leaf &&
            typeof leaf === 'object' &&
            typeof (leaf as DocumentLeafValue).path === 'string' &&
            typeof (leaf as DocumentLeafValue).value === 'string',
        ),
      )
    }

    if (valueMatching) {
      window.addEventListener('message', onMessage)

      // Asked once; the admin pushes every later change by itself. It may
      // mount after us (or not at all, when the plugin isn't registered for
      // this document), so the first request is retried with backoff.
      let bootstrapAttempts = 0
      const bootstrap = () => {
        if (receivedLeaves || bootstrapAttempts >= 5) {
          return
        }
        bootstrapAttempts += 1
        window.parent.postMessage({ type: REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE }, resolvedOrigin)
        bootstrapTimer = setTimeout(bootstrap, 500 * bootstrapAttempts)
      }
      bootstrap()
    }

    return () => {
      tagger.disconnect()
      if (taggerRef.current === tagger) {
        taggerRef.current = null
      }
      window.removeEventListener('message', onMessage)
      clearTimeout(bootstrapTimer)
    }
  }, [stega, targetOrigin, valueMatching])

  return null
}

/**
 * The preview's half of the plugin, mounted by the site. Wrapped so that
 * whatever goes wrong in it stays in it: the site's page renders on either way.
 */
export const LivePreviewInspectorClient: React.FC<LivePreviewInspectorClientProps> = (props) => (
  <Contained name="The preview's inspector">
    <PreviewInspector {...props} />
  </Contained>
)
