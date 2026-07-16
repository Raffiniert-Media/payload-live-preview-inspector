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
   * tab during a tab sweep, and after expanding a collapsed accordion whose
   * content mounts for the first time. Increase this if a heavier field (a
   * rich-text editor, deeply nested blocks) needs more time to mount than
   * the default allows - too short a value here is what makes a reveal look
   * broken: it gives up on the correct spot before its content appears,
   * tries the rest, then reverts. Defaults to 1500.
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

        // Work toward the exact element step by step. Expanding a rendered
        // ancestor's collapsed accordions is always cheaper than touching
        // tabs (a rendered ancestor also pins the target to the active tab,
        // so a sweep is then scoped to tabs nested inside it - usually
        // none). Each step accepts *progress*, not only the exact element:
        // a deeper prefix resolving is enough - e.g. the row wrapper
        // appearing inside a just-activated tab whose row is still
        // collapsed, or a nested row mounting inside a just-expanded one -
        // and the next step continues from there. Without this, a target
        // behind a collapsed row in another tab was never found: the sweep
        // reached the right tab, saw no exact element, and reverted.
        const totalDepth = resolvedPath.split('.').length
        for (let step = 0; step <= totalDepth && !checkExact(); step++) {
          const depthBefore = resolvedPathDepth(resolvedPath)
          const progressed = () =>
            checkExact() ??
            (resolvedPathDepth(resolvedPath) > depthBefore ? resolveFieldElement(resolvedPath) : null)

          const ancestor = resolveFieldElement(resolvedPath)
          if (ancestor && expandCollapsedAncestors(ancestor)) {
            // Tab-switch budget, not the accordion one: what mounts here is
            // a field (a rich-text editor outlives 350ms). Only reached
            // again after this wait, so a pending toggle click is committed
            // long before `expandCollapsedAncestors` re-reads its class.
            await waitForElement(progressed, tabSwitchWaitMs)
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

        const el = resolveFieldElement(resolvedPath)

        if (!el) {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console -- intentional dev-only diagnostic
            console.warn(`[payload-live-preview-inspector] Could not resolve path "${resolvedPath}" to a field`)
          }
          return
        }

        const didExpand = expandCollapsedAncestors(el)

        if (didExpand) {
          // Collapsed content is `display: none` until React re-renders after
          // the toggle click - wait until the field is actually measurable.
          await waitForElementLayout(el, accordionAnimationMs)
          if (generation !== revealGeneration) {
            return
          }
        }

        await scrollToElement(el, scrollOffset)
        if (generation !== revealGeneration) {
          return
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
