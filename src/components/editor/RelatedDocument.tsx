'use client'

import { useDocumentDrawer } from '@payloadcms/ui'
import React, { useEffect, useLayoutEffect, useRef } from 'react'

import type { CaretHint } from '../../utilities/caret.js'
import type { BlocksMap, SchemaField } from '../../utilities/revealPlan.js'

import { drawerForm } from '../../utilities/drawerForms.js'
import { escapeAttributeValue, isRowIDSegment } from '../../utilities/pathAttribute.js'
import {
  expandCollapsedAncestors,
  fieldPathFromFormState,
  focusElement,
  IDLE_GIVE_UP_MS,
  resolveRowIDs,
  revealTabForElement,
  waitForElement,
} from '../../utilities/pathResolution.js'
import {
  collapsibleOf,
  FIELD_ID_PREFIX,
  FIELD_PATH_ATTRIBUTE,
  fieldIDFromPath,
  isCollapsedCollapsible,
  MODAL_CONTAINER_CLASS,
  PAYLOAD_CLASS,
  PAYLOAD_MID_BREAK_PX,
  rowIDFromPath,
  selectorOf,
  toggleButtonOf,
} from '../../utilities/payloadAdmin.js'
import {
  findTabsElement,
  formFieldPathOf,
  planReveal,
  TAB_BUTTON_ACTIVE_CLASS,
  tabButtonsOf,
} from '../../utilities/revealPlan.js'

/**
 * Another document, clicked in the preview - a post in a carousel the page
 * shows - opened in Payload's own document drawer, at the field clicked.
 *
 * Payload's drawer, not one of ours: it is what the pencil beside a
 * relationship opens, so it loads, locks, validates, autosaves and publishes
 * the document the way Payload does everywhere else, with the editor's own
 * permissions. A save in it - an autosave too - is reported to the live
 * preview by Payload itself, which refreshes; nothing here takes part in
 * saving.
 *
 * ## Beside the preview
 *
 * Payload's drawer covers the whole window from the right, and the preview
 * with it - the page whose card is being edited. Where the preview stands
 * beside the form, the drawer takes the form's place instead and the preview
 * stays in view, still clickable: another card opens its document in the
 * drawer, the change being typed shows up on the page as it is saved.
 *
 * ## The field
 *
 * Payload renders the drawer's document on the server, and the form it builds
 * there is out of reach of whatever opened the drawer (its `AfterFields` is
 * not passed on as of 3.90). Where the collection has this plugin, the
 * plugin's listener inside the drawer registers that form (`drawerForms.ts`),
 * and the jump reads its state as a jump in the page's form does. Either way
 * the field is found inside the drawer only - the page's form below has
 * fields of the same ids - behind the tabs the collection's config names,
 * with the rows on the way opened.
 */

export type RelatedTarget = {
  caret?: CaretHint
  collection: string
  id: number | string
  /** One per click: the same field clicked twice is revealed twice. */
  nonce: number
  /** The field in the document, `''` for the document as a whole. */
  path: string
}

export type RelatedOutcome = 'done' | 'not-found'

type Props = {
  /** Put the drawer where the form is, so the preview stays in view. */
  besidePreview: boolean
  blocksMap: BlocksMap
  /** The document's collection's fields - which tab a field is in. */
  fields: SchemaField[]
  flash: (el: HTMLElement) => void
  onClose: () => void
  /** The drawer's element id while it is open, `null` once closed - for the focus listener. */
  onDrawer: (drawerSlug: null | string) => void
  onReveal: (outcome: RelatedOutcome) => void
  /** Focuses without the focus being sent back to the preview as the editor's own. */
  quietly: (focus: () => void) => void
  tabSwitchWaitMs: number
  target: RelatedTarget
}

/** Narrower than this, a drawer beside the preview is no use - Payload's own placement is. */
const MIN_BESIDE_WIDTH_PX = 480
/** How long a document gets to arrive in its drawer. */
const LOAD_TIMEOUT_MS = 10_000
/** Room above a field the drawer scrolls to. */
const SCROLL_MARGIN_PX = 80

/** The element the drawer's form renders for `path`, looked for in the drawer only. */
const fieldIn = (scope: ParentNode, path: string): HTMLElement | null => {
  const rowID = rowIDFromPath(path)
  return (
    scope.querySelector<HTMLElement>(`[id="${escapeAttributeValue(fieldIDFromPath(path))}"]`) ??
    (rowID ? scope.querySelector<HTMLElement>(`[id="${escapeAttributeValue(rowID)}"]`) : null) ??
    scope.querySelector<HTMLElement>(`[${FIELD_PATH_ATTRIBUTE}="${escapeAttributeValue(path)}"]`)
  )
}

/** The deepest part of `path` the drawer renders. */
const deepestIn = (scope: ParentNode, path: string): HTMLElement | null => {
  const segments = path.split('.')
  for (let end = segments.length; end > 0; end--) {
    const el = fieldIn(scope, segments.slice(0, end).join('.'))
    if (el) {
      return el
    }
  }
  return null
}

const hasFields = (scope: ParentNode): HTMLElement | null =>
  scope.querySelector<HTMLElement>(`[id^="${FIELD_ID_PREFIX}"], [${FIELD_PATH_ATTRIBUTE}]`)

/**
 * Scrolls the drawer - not the page under it - until `el` is in view; with
 * `toTop`, until it is at the top, whatever below it is then brought near.
 */
const scrollIntoDrawer = async (
  el: HTMLElement,
  signal: AbortSignal,
  { toTop = false }: { toTop?: boolean } = {},
): Promise<void> => {
  const container = el.closest<HTMLElement>(selectorOf(PAYLOAD_CLASS.drawerContentChildren))
  if (!container) {
    return
  }
  const box = container.getBoundingClientRect()
  const rect = el.getBoundingClientRect()
  const inView = rect.top >= box.top + SCROLL_MARGIN_PX / 2 && rect.bottom <= box.bottom
  if ((inView && !toTop) || Math.abs(rect.top - box.top - SCROLL_MARGIN_PX) < 2) {
    return
  }
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  container.scrollTo({
    behavior: smooth ? 'smooth' : 'auto',
    top: container.scrollTop + rect.top - box.top - SCROLL_MARGIN_PX,
  })
  if (smooth) {
    await new Promise<void>((resolve) => {
      const done = () => {
        container.removeEventListener('scrollend', done)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(done, 600)
      container.addEventListener('scrollend', done, { once: true })
      signal.addEventListener('abort', done, { once: true })
    })
  }
}

const revealInDrawer = async (
  drawerSlug: string,
  { blocksMap, caret, fields, flash, path, quietly, tabSwitchWaitMs }: {
    caret?: CaretHint
    path: string
  } & Pick<Props, 'blocksMap' | 'fields' | 'flash' | 'quietly' | 'tabSwitchWaitMs'>,
  signal: AbortSignal,
): Promise<RelatedOutcome> => {
  const drawer = () => document.getElementById(drawerSlug)
  // The document arrives from the server a moment after the drawer opens.
  const loaded = await waitForElement(() => {
    const scope = drawer()
    return scope ? hasFields(scope) : null
  }, LOAD_TIMEOUT_MS, { signal })
  const scope = drawer()
  if (!loaded || !scope || signal.aborted) {
    return 'not-found'
  }

  // The drawer's own form, where its collection has this plugin (see
  // `drawerForms.ts`): its state says which block a row is and which rows are
  // closed, and turns a row named by id into its position. Without it, the
  // collection's config and the drawer's markup: rows by position (see
  // `inspectableDocument`), and a row named by id as far as its array.
  const form = drawerForm(drawerSlug)
  const formState = form?.getFields() ?? {}
  const segments = path.split('.')
  const rowIDAt = segments.findIndex(isRowIDSegment)
  const reachable =
    (form ? resolveRowIDs(path, formState) : null) ??
    (rowIDAt === -1 ? segments : segments.slice(0, rowIDAt)).join('.')
  if (!reachable) {
    return 'done'
  }
  const fieldPath =
    (form ? fieldPathFromFormState(reachable, formState) : null) ??
    formFieldPathOf(fields, reachable, formState, blocksMap) ??
    reachable

  const plan = planReveal(fields, fieldPath, formState, blocksMap)
  // Every closed row on the way at once, through the form state that owns
  // the flag - one dispatch per field, so none overwrites another.
  if (form) {
    const closed = new Map<string, Set<number>>()
    for (const step of plan.steps) {
      if (step.kind === 'row' && formState[step.path]?.rows?.[step.index]?.collapsed) {
        closed.set(step.path, (closed.get(step.path) ?? new Set()).add(step.index))
      }
    }
    for (const [rowsPath, indices] of closed) {
      const rows = form.getFields()[rowsPath]?.rows
      if (rows) {
        form.dispatchFields({
          type: 'SET_ROW_COLLAPSED',
          path: rowsPath,
          updatedRows: rows.map((row, index) => (indices.has(index) ? { ...row, collapsed: false } : row)),
        })
      }
    }
  }
  for (const step of plan.steps) {
    if (step.kind === 'row' && form) {
      continue
    }
    if (step.kind === 'tab') {
      const tabs = await waitForElement(
        () => findTabsElement(step, fields, form?.getFields() ?? {}, blocksMap, scope),
        tabSwitchWaitMs,
        { signal },
      )
      const button = tabs ? tabButtonsOf(tabs)[step.index] : undefined
      if (!button) {
        break
      }
      if (!button.classList.contains(TAB_BUTTON_ACTIVE_CLASS)) {
        button.click()
      }
      continue
    }
    const holder = await waitForElement(
      () =>
        scope.querySelector<HTMLElement>(
          `[id="${escapeAttributeValue(step.kind === 'row' ? (rowIDFromPath(`${step.path}.${step.index}`) ?? '') : step.id)}"]`,
        ),
      tabSwitchWaitMs,
      { signal },
    )
    const collapsible = collapsibleOf(holder)
    if (collapsible && isCollapsedCollapsible(collapsible)) {
      toggleButtonOf(collapsible)?.click()
    }
  }
  if (signal.aborted) {
    return 'not-found'
  }

  const exact = () => fieldIn(scope, fieldPath)
  let el =
    (await waitForElement(exact, tabSwitchWaitMs, { idleMs: IDLE_GIVE_UP_MS, signal })) ??
    (plan.complete ? null : await revealTabForElement(exact, tabSwitchWaitMs, scope, signal))
  // Payload renders a field once it comes near the view: one below the
  // drawer's fold does not exist yet. The deepest part of the path that does
  // is brought up, and the field looked for again - as the page's own form
  // is travelled.
  for (let tries = 0; !el && tries < 3 && !signal.aborted; tries++) {
    const ancestor = deepestIn(scope, fieldPath)
    if (!ancestor) {
      break
    }
    expandCollapsedAncestors(ancestor)
    await scrollIntoDrawer(ancestor, signal, { toTop: true })
    el = await waitForElement(exact, tabSwitchWaitMs, { idleMs: IDLE_GIVE_UP_MS, signal })
  }
  el ??= deepestIn(scope, fieldPath)
  if (!el || signal.aborted) {
    return 'not-found'
  }
  if (expandCollapsedAncestors(el)) {
    el = (await waitForElement(exact, tabSwitchWaitMs, { signal })) ?? el
  }

  await scrollIntoDrawer(el, signal)
  if (signal.aborted) {
    return 'not-found'
  }
  const target = el
  quietly(() => focusElement(target, caret))
  flash(target)
  return 'done'
}

/**
 * Keeps the drawer to the form's side of the window while the preview is
 * beside it - measured off the preview, which the editor can resize.
 *
 * And lets the pointer through to the preview: Payload renders every modal
 * into one layer over the whole window, which took every click and hover
 * meant for the preview beside the drawer. The layer gives way; what is in
 * it - the drawer, and any dialog opened from it - does not.
 *
 * A style element rather than the drawer's own `style`: the drawer is
 * Payload's, rendered with a `style` of its own on every update.
 */
const useBesidePreview = (drawerSlug: string, active: boolean): void => {
  useLayoutEffect(() => {
    const preview = document.querySelector<HTMLElement>(selectorOf(PAYLOAD_CLASS.livePreviewWindow))
    if (!active || !preview) {
      return
    }
    const style = document.createElement('style')
    style.setAttribute('data-payload-live-preview-inspector-related', '')
    document.head.append(style)
    const place = () => {
      const left = Math.round(preview.getBoundingClientRect().left)
      const beside = window.innerWidth > PAYLOAD_MID_BREAK_PX && left >= MIN_BESIDE_WIDTH_PX
      const layer = `.${MODAL_CONTAINER_CLASS}`
      style.textContent = beside
        ? `[id="${escapeAttributeValue(drawerSlug)}"] { left: 0 !important; right: auto !important; width: ${left}px !important; }
${layer} { pointer-events: none !important; }
${layer} > * { pointer-events: auto; }`
        : ''
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(preview)
    window.addEventListener('resize', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      style.remove()
    }
  }, [active, drawerSlug])
}

/** Payload's document drawer for `target`, open from the moment it mounts; it reports when it closes. */
export const RelatedDocumentDrawer: React.FC<Props> = ({
  besidePreview,
  blocksMap,
  fields,
  flash,
  onClose,
  onDrawer,
  onReveal,
  quietly,
  tabSwitchWaitMs,
  target,
}) => {
  const [DocumentDrawer, , { closeDrawer, drawerSlug, isDrawerOpen, openDrawer }] = useDocumentDrawer({
    id: target.id,
    collectionSlug: target.collection,
    // A collection hidden from the admin is not one to edit from a page.
    overrideEntityVisibility: false,
  })
  const wasOpen = useRef(false)

  useEffect(() => {
    openDrawer()
  }, [openDrawer])

  // Gone - another document clicked, the editor left the page: the drawer's
  // modal goes with it, or Payload would hold the page as if one were open.
  useEffect(() => closeDrawer, [closeDrawer])

  useEffect(() => {
    if (isDrawerOpen) {
      wasOpen.current = true
      onDrawer(drawerSlug)
    } else if (wasOpen.current) {
      onDrawer(null)
      onClose()
    }
  }, [drawerSlug, isDrawerOpen, onClose, onDrawer])

  useBesidePreview(drawerSlug, besidePreview && isDrawerOpen)

  // The latest of everything for the reveal, which runs once per click.
  const latest = useRef({ blocksMap, fields, flash, onReveal, quietly, tabSwitchWaitMs, target })
  latest.current = { blocksMap, fields, flash, onReveal, quietly, tabSwitchWaitMs, target }
  useEffect(() => {
    if (!isDrawerOpen) {
      return
    }
    const controller = new AbortController()
    const { onReveal: report, target: clicked, ...rest } = latest.current
    void revealInDrawer(drawerSlug, { ...rest, caret: clicked.caret, path: clicked.path }, controller.signal)
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console -- a jump that broke has to leave a trace
        console.error(`[payload-live-preview-inspector] The jump to "${clicked.path}" in the drawer failed.`, error)
        return 'not-found' as const
      })
      .then((outcome) => {
        if (!controller.signal.aborted) {
          report(outcome)
        }
      })
    return () => controller.abort()
  }, [drawerSlug, isDrawerOpen, target.nonce])

  return <DocumentDrawer />
}
