'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { HOST_ATTRIBUTE } from '../../utilities/isolate.js'
import { readStored, writeStored } from '../../utilities/layout.js'

/**
 * Calls `callback` once now and again after every change to the tree under
 * `root` - at most once a frame, however many nodes a render touched.
 *
 * The editor's elements live inside markup Payload renders and re-renders:
 * a remounted form takes them with it, a tab switch replaces what focus mode
 * hid. Watching for that is what keeps them where they belong.
 */
export const watchDom = (root: Node, callback: () => void): (() => void) => {
  let frame = 0
  const observer = new MutationObserver(() => {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0
        callback()
      })
    }
  })
  observer.observe(root, { childList: true, subtree: true })
  callback()
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}

/** Where a host goes: first in `parent`, or right before `before`. */
export type HostPlace = { before?: Element | null; parent: Element } | null

/**
 * An element of the editor's own, kept at a place in Payload's markup - first
 * in the form's column, between the form and the preview - for a portal to
 * render into.
 *
 * Inserted by hand rather than rendered by React because the place is inside
 * someone else's component; React tolerates an element it did not create, as
 * long as it is left alone, and a portal into it renders as part of the
 * editor's own tree. When Payload remounts the parent, the host is put back.
 */
export const useHost = (name: string, place: () => HostPlace, enabled: boolean): HTMLElement | null => {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const placeRef = useRef(place)
  placeRef.current = place

  useEffect(() => {
    if (!enabled) {
      return
    }
    const el = document.createElement('div')
    el.setAttribute(HOST_ATTRIBUTE, name)
    setHost(el)

    const stop = watchDom(document.body, () => {
      const where = placeRef.current()
      if (!where) {
        if (el.isConnected) {
          el.remove()
        }
        return
      }
      const { before = null, parent } = where
      if (before) {
        if (el.parentElement !== parent || el.nextElementSibling !== before) {
          parent.insertBefore(el, before)
        }
      } else if (parent.firstElementChild !== el) {
        parent.prepend(el)
      }
    })

    return () => {
      stop()
      el.remove()
      setHost(null)
    }
  }, [enabled, name])

  return host
}

/** Whether the screen is at most `px` wide, kept current. */
export const useMaxWidth = (px: number): boolean => {
  const query = `(max-width: ${px}px)`
  // Read after mount, not during the first render: the server renders this
  // component too, knows no screen, and the first client render has to match it.
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

/**
 * A choice remembered in the browser - the outline open, a screen width -
 * read after mount for the same reason as `useMaxWidth`: the document controls
 * are rendered on the server first, where there is no storage, and a first
 * client render that read it would not match (`aria-pressed` on a toggle).
 */
export const useStored = <T>(
  key: string,
  accept: (value: unknown) => value is T,
  fallback: T,
): [T, (value: T) => void] => {
  const [value, setValue] = useState<T>(fallback)
  const acceptRef = useRef(accept)
  acceptRef.current = accept
  const fallbackRef = useRef(fallback)
  fallbackRef.current = fallback
  useEffect(() => {
    setValue(readStored(key, acceptRef.current, fallbackRef.current))
  }, [key])
  const set = useCallback(
    (next: T) => {
      setValue(next)
      writeStored(key, next)
    },
    [key],
  )
  return [value, set]
}
