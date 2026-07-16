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
   * Maximum wait (ms), per candidate tab, for a just-activated tab's fields
   * to render before assuming the target isn't in that tab. Increase this if
   * a heavier tab (a rich-text editor, deeply nested blocks) needs more time
   * to mount than the default allows - too short a value here is what makes
   * the tab switch look like it "does nothing": it gives up on the correct
   * tab before its content appears, tries the rest, then reverts. Defaults
   * to 1500.
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

        if (!checkExact()) {
          // A closed accordion (Collapsible field, or an Array/Blocks row) is
          // a cheaper explanation than "wrong tab" - Payload unmounts its
          // content while collapsed, but the row/field's nearest rendered
          // ancestor is still resolvable via prefix fallback in whichever tab
          // is already on screen. Expand it and give it a chance to mount
          // before ever concluding the target must be behind an inactive tab
          // button - checking this first is what a closed accordion in the
          // *correct*, already-active tab was missing, so it got misread as
          // "must be some other tab" and triggered a visible tab sweep.
          //
          // This must only click a given toggle once: `expandCollapsedAncestors`
          // reads the live `--collapsed` class, and React won't have
          // committed the state update from a click until a later render, so
          // calling it again on every poll tick (before that commit lands)
          // would re-click the same toggle and flip the row straight back to
          // collapsed.
          const ancestor = resolveFieldElement(resolvedPath)
          if (ancestor && expandCollapsedAncestors(ancestor)) {
            await waitForElement(checkExact, accordionAnimationMs)
            if (generation !== revealGeneration) {
              return
            }
          }
        }

        // Payload unmounts inactive tab panels - if neither the exact target
        // nor its owning field is in the DOM, sweep the tabs until it is.
        if (!checkExact()) {
          await revealTabForElement(checkExact, tabSwitchWaitMs)
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
