import type { ValueIndex } from './autoTag.js'
import type { DocumentLeafValue } from './pathResolution.js'

import {
  applyValueIndex,
  buildValueIndex,
  inferBlockContainers,
  retagElement,
  scanStega,
} from './autoTag.js'
import { LIVE_PREVIEW_AUTO_ATTRIBUTE } from './pathAttribute.js'

export type AutoTagger = {
  disconnect: () => void
  /** Runs pending work now - before a click is resolved, so it never misses a tag still queued. */
  flush: () => void
  /** New document values from the admin; re-judges value matching against them. */
  setLeaves: (leaves: DocumentLeafValue[]) => void
}

/** Latest a queued pass may wait for an idle moment. */
const IDLE_TIMEOUT_MS = 150

type IdleHandle = { cancel: () => void }

const whenIdle = (callback: () => void): IdleHandle => {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS })
    return { cancel: () => window.cancelIdleCallback(id) }
  }
  const id = setTimeout(callback, 16)
  return { cancel: () => clearTimeout(id) }
}

/**
 * Keeps the automatic tags (stega, value matching, inferred containers) in
 * step with the preview's DOM - incrementally.
 *
 * The first pass scans the whole document. After that, only what a mutation
 * touched is looked at again: subtrees that were added are scanned, elements
 * whose text changed have their own tag re-judged (`retagElement`), and only
 * new document values trigger a document-wide value-matching pass. Container
 * inference, which depends on all tags at once, reruns only when a pass
 * changed anything.
 *
 * It replaced a full scan - two walks over every text node plus a query per
 * row - on every render batch, which in a live preview means on every
 * keystroke in the admin, and a fresh request for all document values with
 * each one. Work runs in idle time, and `flush()` pulls it forward whenever a
 * click needs the tags to be current.
 */
export const createAutoTagger = (
  doc: Document,
  { stega, valueMatching }: { stega: boolean; valueMatching: boolean },
): AutoTagger => {
  let index: null | ValueIndex = null
  let fullPass = true
  let rematch = false
  let structureChanged = false
  const dirtySubtrees = new Set<Element>()
  const dirtyElements = new Set<Element>()
  let idle: IdleHandle | undefined

  const flush = () => {
    idle?.cancel()
    idle = undefined

    let changed = structureChanged
    structureChanged = false

    if (fullPass) {
      fullPass = false
      rematch = false
      dirtySubtrees.clear()
      dirtyElements.clear()
      if (stega) {
        scanStega(doc)
      }
      if (index) {
        applyValueIndex(doc, index)
      }
      changed = true
    }

    if (rematch) {
      rematch = false
      // Tags matched against the old values may be stale now...
      for (const el of Array.from(doc.querySelectorAll(`[${LIVE_PREVIEW_AUTO_ATTRIBUTE}="match"]`))) {
        retagElement(el, { index, stega })
      }
      // ...and elements that matched nothing before may match a new value.
      if (index) {
        applyValueIndex(doc, index)
      }
      changed = true
    }

    for (const root of dirtySubtrees) {
      if (!root.isConnected) {
        continue
      }
      if (stega) {
        scanStega(root)
      }
      if (index) {
        applyValueIndex(root, index)
      }
      changed = true
    }
    dirtySubtrees.clear()

    for (const el of dirtyElements) {
      if (el.isConnected) {
        retagElement(el, { index, stega })
        changed = true
      }
    }
    dirtyElements.clear()

    if (changed) {
      inferBlockContainers(doc)
    }
  }

  const schedule = () => {
    idle ??= whenIdle(flush)
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        const parent = record.target.parentElement
        if (parent) {
          dirtyElements.add(parent)
        }
        continue
      }

      let textChanged = false
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          dirtySubtrees.add(node as Element)
        } else if (node.nodeType === Node.TEXT_NODE) {
          textChanged = true
        }
      }
      for (const node of Array.from(record.removedNodes)) {
        structureChanged = true
        if (node.nodeType === Node.TEXT_NODE) {
          textChanged = true
        }
      }
      if (textChanged && record.target.nodeType === Node.ELEMENT_NODE) {
        dirtyElements.add(record.target as Element)
      }
    }
    schedule()
  })

  // Attributes are deliberately not observed: tagging writes attributes, and
  // watching them would have every pass trigger the next.
  observer.observe(doc.documentElement, { characterData: true, childList: true, subtree: true })
  schedule()

  return {
    disconnect: () => {
      observer.disconnect()
      idle?.cancel()
      idle = undefined
    },
    flush,
    setLeaves: (leaves) => {
      if (!valueMatching) {
        return
      }
      index = buildValueIndex(leaves)
      rematch = true
      schedule()
    },
  }
}
