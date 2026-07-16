'use client'

import { useForm, useLivePreviewContext } from '@payloadcms/ui'
import { useEffect, useRef } from 'react'

import {
  CLICK_MESSAGE_TYPE,
  DOCUMENT_VALUES_MESSAGE_TYPE,
  REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE,
} from '../utilities/messageTypes.js'
import {
  collectLeafValues,
  DEFAULT_COLLAPSIBLE_ANIMATION_MS,
  DEFAULT_TAB_SWITCH_WAIT_MS,
  expandCollapsedAncestors,
  fieldPathFromFormState,
  focusElement,
  resolvedPathDepth,
  resolveExactFieldElement,
  resolveFieldElement,
  resolveRowIDs,
  revealTabForElement,
  scrollToElement,
  flashElement as sharedFlashElement,
  waitForElement,
  waitForElementLayout,
} from '../utilities/pathResolution.js'
import classes from './LivePreviewInspectorListener.module.css'

export type LivePreviewInspectorListenerProps = {
  /** Maximum wait (ms) for a just-expanded accordion to render its content before scrolling. Defaults to 350. */
  accordionAnimationMs?: number
  /** Flash outline/background color. Defaults to the shipped CSS (`#3fb950`). */
  flashColor?: string
  /** Flash animation duration in ms. Defaults to the shipped CSS (1200ms). */
  flashDurationMs?: number
  /** Distance (px) to keep between the scrolled-to field and the viewport top. Defaults to 100. */
  scrollOffset?: number
  /**
   * Maximum wait (ms) for freshly mounting fields to render - per candidate
   * tab during a tab sweep, and after scrolling toward a target whose exact
   * element hasn't mounted yet (Payload defers below-viewport fields and
   * lazy-loads rich-text editors). Increase this if a heavier field needs
   * more time to mount than the default allows - too short a value here
   * makes a reveal give up on the correct spot before its content appears.
   * Defaults to 1500.
   */
  tabSwitchWaitMs?: number
}

export const LivePreviewInspectorListener: React.FC<LivePreviewInspectorListenerProps> = ({
  accordionAnimationMs = DEFAULT_COLLAPSIBLE_ANIMATION_MS,
  flashColor,
  flashDurationMs,
  scrollOffset,
  tabSwitchWaitMs = DEFAULT_TAB_SWITCH_WAIT_MS,
}) => {
  const { iframeRef, isLivePreviewing, loadedURL, url } = useLivePreviewContext()
  const activeURL = loadedURL || url

  // `useForm().getFields` is an imperative getter that reads the current form
  // state on demand, unlike `useAllFormFields()`, which re-renders this
  // component on every keystroke anywhere in the form. We only need the
  // freshest state at click time, so a ref (rather than an effect dependency)
  // is enough to always call the latest version without re-subscribing.
  const { getFields } = useForm()
  const getFieldsRef = useRef(getFields)
  getFieldsRef.current = getFields

  useEffect(() => {
    if (!activeURL) {
      return
    }

    let expectedOrigin: string
    try {
      expectedOrigin = new URL(activeURL).origin
    } catch {
      return
    }

    // Bumped on every click (and on cleanup) so a still-pending reveal from
    // an earlier click doesn't flash/focus after a newer one took over.
    let revealGeneration = 0

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const { data } = event
      if (!data || typeof data !== 'object') {
        return
      }

      if (data.type === REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE) {
        // The iframe wants the current field values for value matching -
        // reply with every string leaf, addressed by stable row ids.
        ;(event.source as Window).postMessage(
          { type: DOCUMENT_VALUES_MESSAGE_TYPE, leaves: collectLeafValues(getFieldsRef.current()) },
          expectedOrigin,
        )
        return
      }

      if (data.type !== CLICK_MESSAGE_TYPE || typeof data.path !== 'string') {
        return
      }

      const formState = getFieldsRef.current()
      const resolvedPath = resolveRowIDs(data.path, formState)

      if (!resolvedPath) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console -- intentional dev-only diagnostic
          console.warn(`[payload-live-preview-inspector] Could not resolve a row id in path "${data.path}"`)
        }
        return
      }

      const generation = ++revealGeneration

      const revealField = async () => {
        // The path's actual form field (a stega path pointing inside e.g. a
        // rich-text value collapses to the rich-text field itself).
        const targetFieldPath = fieldPathFromFormState(resolvedPath, formState)
        const checkExact = () =>
          resolveExactFieldElement(resolvedPath) ??
          (targetFieldPath ? resolveExactFieldElement(targetFieldPath) : null)

        // "Exact target or a deeper prefix than `depth`" - the success
        // condition for every reveal step: progress counts, not only the
        // finished result, because Payload mounts things in stages (a tab
        // switch mounts the row before its lazy fields, an expansion mounts
        // nested rows still collapsed, a scroll mounts deferred fields).
        const progressBeyond = (depth: number) => () =>
          checkExact() ??
          (resolvedPathDepth(resolvedPath) > depth ? resolveFieldElement(resolvedPath) : null)

        const totalDepth = resolvedPath.split('.').length

        // Phase 1: make the target's subtree reachable - right tab active,
        // accordions on the way open. Expanding a rendered ancestor's
        // collapsed accordions is always cheaper than touching tabs (a
        // rendered ancestor also pins the target to the active tab, so a
        // sweep is then scoped to tabs nested inside it - usually none).
        for (let step = 0; step <= totalDepth && !checkExact(); step++) {
          const progressed = progressBeyond(resolvedPathDepth(resolvedPath))

          const ancestor = resolveFieldElement(resolvedPath)
          if (ancestor && expandCollapsedAncestors(ancestor)) {
            // Only reached again after this wait, so a pending toggle click
            // is committed long before `expandCollapsedAncestors` re-reads
            // its class. Slow mounts (a rich-text editor, below-viewport
            // deferred fields) that outlive this budget are caught by the
            // scroll-and-settle phase below.
            await waitForElement(progressed, accordionAnimationMs)
          } else {
            const found = await revealTabForElement(progressed, tabSwitchWaitMs, ancestor ?? document)
            if (!found) {
              break
            }
          }
          if (generation !== revealGeneration) {
            return
          }
        }

        let el = resolveFieldElement(resolvedPath)

        if (!el) {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console -- intentional dev-only diagnostic
            console.warn(`[payload-live-preview-inspector] Could not resolve path "${resolvedPath}" to a field`)
          }
          return
        }

        // Phase 2: scroll and settle. Payload defers rendering fields that
        // are below the viewport (and lazy-loads heavier ones, like the
        // rich-text editor), so scrolling to the deepest element we have is
        // often the very thing that mounts the exact target. After each
        // scroll settles, give the target a moment to appear; when it (or a
        // deeper ancestor) does, continue from there instead of flashing a
        // parent the user didn't click.
        for (let step = 0; step <= totalDepth; step++) {
          if (expandCollapsedAncestors(el)) {
            // Collapsed content is `display: none` until React re-renders
            // after the toggle click - wait until it is actually measurable.
            await waitForElementLayout(el, accordionAnimationMs)
            if (generation !== revealGeneration) {
              return
            }
          }

          await scrollToElement(el, scrollOffset)
          if (generation !== revealGeneration) {
            return
          }

          // Already on the exact target (or as deep as we will ever get and
          // nothing deeper mounted after the scroll) - stop here.
          const next =
            checkExact() ?? (await waitForElement(progressBeyond(resolvedPathDepth(resolvedPath)), tabSwitchWaitMs))
          if (generation !== revealGeneration) {
            return
          }
          if (!next || next === el) {
            break
          }
          el = next
        }

        sharedFlashElement(el, { className: classes.flash, color: flashColor, durationMs: flashDurationMs })
        focusElement(el)
      }

      void revealField()
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
      revealGeneration += 1
    }
  }, [iframeRef, activeURL, accordionAnimationMs, flashColor, flashDurationMs, scrollOffset, tabSwitchWaitMs])

  if (!isLivePreviewing) {
    return null
  }

  return (
    <div className={classes.hint}>
      Click an element in the Live Preview to jump to its field
    </div>
  )
}
