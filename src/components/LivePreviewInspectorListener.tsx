'use client'

import { useForm, useLivePreviewContext } from '@payloadcms/ui'
import { useEffect, useRef } from 'react'

import {
  DEFAULT_COLLAPSIBLE_ANIMATION_MS,
  expandCollapsedAncestors,
  focusElement,
  resolveFieldElement,
  resolveRowIDs,
  scrollToElement,
  flashElement as sharedFlashElement,
} from '../utilities/pathResolution.js'
import classes from './LivePreviewInspectorListener.module.css'

const MESSAGE_TYPE = 'payload-live-preview-inspector:click'

export type LivePreviewInspectorListenerProps = {
  /** Wait time (ms) for a just-expanded accordion's height animation before scrolling. Defaults to 350. */
  accordionAnimationMs?: number
  /** Flash outline/background color. Defaults to the shipped CSS (`#3fb950`). */
  flashColor?: string
  /** Flash animation duration in ms. Defaults to the shipped CSS (1200ms). */
  flashDurationMs?: number
  /** Distance (px) to keep between the scrolled-to field and the viewport top. Defaults to 100. */
  scrollOffset?: number
}

export const LivePreviewInspectorListener: React.FC<LivePreviewInspectorListenerProps> = ({
  accordionAnimationMs = DEFAULT_COLLAPSIBLE_ANIMATION_MS,
  flashColor,
  flashDurationMs,
  scrollOffset,
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

    let revealTimeout: ReturnType<typeof setTimeout> | undefined

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const { data } = event
      if (
        !data ||
        typeof data !== 'object' ||
        data.type !== MESSAGE_TYPE ||
        typeof data.path !== 'string'
      ) {
        return
      }

      const resolvedPath = resolveRowIDs(data.path, getFieldsRef.current())

      if (!resolvedPath) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console -- intentional dev-only diagnostic
          console.warn(`[payload-live-preview-inspector] Could not resolve a row id in path "${data.path}"`)
        }
        return
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

      const revealField = () => {
        void scrollToElement(el, scrollOffset).then(() => {
          sharedFlashElement(el, { className: classes.flash, color: flashColor, durationMs: flashDurationMs })
          focusElement(el)
        })
      }

      if (didExpand) {
        // Wait for the accordion's height animation to finish before measuring/scrolling.
        clearTimeout(revealTimeout)
        revealTimeout = setTimeout(revealField, accordionAnimationMs)
      } else {
        revealField()
      }
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
      clearTimeout(revealTimeout)
    }
  }, [iframeRef, activeURL, accordionAnimationMs, flashColor, flashDurationMs, scrollOffset])

  if (!isLivePreviewing) {
    return null
  }

  return (
    <div className={classes.hint}>
      Click an element in the Live Preview to jump to its field
    </div>
  )
}
