'use client'

import {
  BlocksDrawer,
  toast,
  useAllFormFields,
  useConfig,
  useDocumentInfo,
  useEditDepth,
  useForm,
  useLivePreviewContext,
  useModal,
  useTranslation,
} from '@payloadcms/ui'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { CaretHint } from '../utilities/caret.js'
import type { Curtain } from '../utilities/curtain.js'
import type { EditorFeatures } from '../utilities/features.js'
import type { RevealStatus } from '../utilities/messageTypes.js'
import type { DocumentLeafValue } from '../utilities/pathResolution.js'
import type { BlocksMap, SchemaField } from '../utilities/revealPlan.js'
import type { Outline, OutlineNode } from '../utilities/structure.js'
import type { RowAction, RowFormAPI } from './editor/rowActions.js'

import { createCamera } from '../utilities/camera.js'
import { caretHintFromSelection, parseCaretHint } from '../utilities/caret.js'
import { drawCurtain, openingAreaOf, tabContentOf, visibleRowsAfter } from '../utilities/curtain.js'
import { previewStringsOf, stringsFor } from '../utilities/i18n.js'
import { HOST_ATTRIBUTE, isolate } from '../utilities/isolate.js'
import { DEFAULT_VIEWPORTS, isBoolean } from '../utilities/layout.js'
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
import {
  collectLeafValues,
  DEFAULT_COLLAPSIBLE_ANIMATION_MS,
  DEFAULT_SCROLL_OFFSET,
  DEFAULT_TAB_SWITCH_WAIT_MS,
  expandCollapsedAncestors,
  fieldPathFromFormState,
  findUnrenderedRows,
  focusElement,
  IDLE_GIVE_UP_MS,
  isInOpeningView,
  isInRestingView,
  pathFromFieldElement,
  renotifyIntersection,
  resolvedPathDepth,
  resolveExactFieldElement,
  resolveFieldElement,
  resolveRowIDs,
  revealTabForElement,
  rowIDFromPath,
  flashElement as sharedFlashElement,
  toRowIDPath,
  waitForElement,
  waitForElementLayout,
  waitForQuietFrames,
  waitForStablePosition,
} from '../utilities/pathResolution.js'
import {
  collapsibleOf,
  editMainEl,
  editMainWrapperEl,
  isCollapsedCollapsible,
  livePreviewToolbarEl,
  livePreviewWindowEl,
  missingLandmarks,
  PAYLOAD_CLASS,
  PAYLOAD_MID_BREAK_PX,
  PAYLOAD_PROPERTY,
  selectorOf,
  toggleButtonOf,
  toggleWrapOf,
} from '../utilities/payloadAdmin.js'
import {
  describeTarget,
  findTabsElement,
  labelOfTarget,
  planReveal,
  TAB_BUTTON_ACTIVE_CLASS,
  tabButtonsOf,
} from '../utilities/revealPlan.js'
import { createRevealTimer } from '../utilities/revealTimer.js'
import {
  buildOutline,
  chainOf,
  outlineSignature,
  previewRowsOf,
  rowIDPathOf,
  rowPathOf,
} from '../utilities/structure.js'
import { Contained } from './Contained.js'
import { useHost, useMaxWidth, useStored, watchDom } from './editor/dom.js'
import editorClasses from './editor/Editor.module.css'
import { editorStyles, HOST } from './editor/editorStyles.js'
import { OutlinePanel } from './editor/OutlinePanel.js'
import { PathBar } from './editor/PathBar.js'
import { PreviewTools } from './editor/PreviewTools.js'
import { duplicateRow, insertRowBelow, isRowAction, moveRow, removeRow, splitRowPath } from './editor/rowActions.js'
import { SplitHandle } from './editor/SplitHandle.js'
import classes from './LivePreviewInspectorListener.module.css'

export type LivePreviewInspectorListenerProps = {
  /** Maximum wait (ms) for a just-expanded accordion to render its content before scrolling. Defaults to 350. */
  accordionAnimationMs?: number
  /** The editor's parts beyond click-to-field. Every one is on by default. */
  editor?: EditorFeatures
  /** Flash outline/background color. Defaults to the admin's accent (`--theme-success-500`). */
  flashColor?: string
  /** Flash animation duration in ms. Defaults to the shipped CSS (1200ms). */
  flashDurationMs?: number
  /**
   * Whether the admin form animates its way to the revealed field
   * (`'smooth'`) or jumps straight there (`'instant'`).
   *
   * The animation is what shows an editor where the form went, so it is the
   * default. It is short and capped (250-550ms, whatever the distance) and
   * follows the field while Payload shifts the layout under it, but the flash
   * and the cursor still wait for it to end. Set `'instant'` where
   * responsiveness matters more than the motion. A reduced-motion preference
   * is honoured either way.
   * @default 'smooth'
   */
  scrollBehavior?: 'instant' | 'smooth'
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

/** Quiet time after the last form change before new values go to the preview. */
const VALUES_PUSH_DEBOUNCE_MS = 200
/** How long the hint says a click found no field. */
const NOT_FOUND_NOTICE_MS = 3_000
/** How long a new row may take to appear in the form state before it is not waited for. */
const NEW_ROW_WAIT_MS = 2_000

const FOCUS_MODE_KEY = 'payload-live-preview-inspector:focus-mode'
const OUTLINE_KEY = 'payload-live-preview-inspector:outline'

/** Payload's accent colour, resolved in the admin's current light/dark theme. */
const accentColor = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue(PAYLOAD_PROPERTY.accent).trim()

/**
 * How close to a tab bar or row header the page gets before it is opened -
 * the last stretch of the motion, so opening doesn't wait for it to stop.
 */
const OPEN_WHEN_NEAR_PX = 120

/**
 * A brief glow on a control the reveal is about to operate - the tab it
 * switches to, the row header it expands - so the editor sees the route
 * being taken instead of the form rearranging itself unannounced.
 *
 * Web Animations rather than a class: Payload re-renders these elements'
 * `className` as their state changes (a tab turning active), which would
 * wipe a class of ours on the very render the click causes.
 */
const pulse = (el: Element | null | undefined): void => {
  const accent = accentColor() || '#1587ba'
  el?.animate(
    [
      { backgroundColor: `color-mix(in srgb, ${accent} 28%, transparent)`, boxShadow: `0 0 0 2px ${accent}` },
      { backgroundColor: 'transparent', boxShadow: '0 0 0 2px transparent' },
    ],
    { duration: 700, easing: 'ease-out' },
  )
}

/** Identity of a set of document values, to push only what changed. */
const signatureOf = (leaves: DocumentLeafValue[]): string =>
  leaves.map(({ path, value }) => `${path}\u0000${value}`).join('\u0001')

const nextFrames = (count: number): Promise<void> =>
  new Promise((resolve) => {
    const tick = (remaining: number) => {
      if (remaining === 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => tick(remaining - 1))
    }
    tick(count)
  })

/**
 * How to name the modifier key to an editor.
 *
 * Both spellings, because the hint is read on the machine it applies to and
 * neither name alone is recognisable on both: a Mac keyboard says `⌥`, a PC
 * keyboard says `Alt`. `'none'` is absent on purpose - it maps to no label, and
 * the hint then leaves the sentence out rather than promising a key that does
 * nothing.
 */
const MODIFIER_LABELS: Record<string, string | undefined> = {
  alt: '⌥ (Alt)',
  ctrl: '⌃ (Ctrl)',
  meta: '⌘ (Cmd)',
  shift: '⇧ (Shift)',
}

type RevealOptions = {
  caret?: CaretHint
  /**
   * Put the cursor in the field, as clicking it would. Off for a whole row
   * reached from the outline or the path bar: it is scrolled to and flashed,
   * and the editor picks the field.
   */
  focus?: boolean
  /** How the reveal is going - the preview's click mark listens. */
  onStatus?: (status: RevealStatus, label?: string) => void
  /** The veil over the form this reveal lifts once the field is in place - see `veilRef`. */
  veil?: number
}

type Reveal = (path: string, options?: RevealOptions) => void

/** Longest a veil stays down, whatever happens to the reveal under it. */
const VEIL_MAX_MS = 4_000
/** How long the veil takes to come down - `drawCurtain`'s fade, and a frame. */
const VEIL_FADE_MS = 140

/** Row actions from the preview that may wait for the one running - see `queueRowAction`. */
const MAX_QUEUED_ROW_ACTIONS = 3

/** The row actions that change the form, rather than only going somewhere in it. */
const changesForm = (action: RowAction): boolean => action !== 'select' && action !== 'edit'

/**
 * Whether the editor has just clicked or typed - in the admin or, since a
 * gesture in a frame counts for the page around it, in the preview.
 *
 * The preview's toolbar only ever sends a change as the answer to a click.
 * Anything else that can post from the preview's window - a script the site
 * loads, an embed's host code - would be changing the document behind the
 * editor's back, and is not let through. Where a browser cannot tell, it is.
 */
const followsAGesture = (): boolean => {
  const activation = (navigator as { userActivation?: { isActive: boolean } } & Navigator).userActivation
  return activation ? activation.isActive : true
}

/** How long Payload gets to render its edit view before the editor looks for its parts. */
const LANDMARK_CHECK_MS = 3_000
/** Parts already reported missing - once a page load is enough. */
const reportedMissing = new Set<string>()

/** Where a selection came from - which decides what else it moves. */
type SelectionSource = 'form' | 'outline' | 'path' | 'preview' | 'toolbar'

/**
 * Everything on the admin's side: click-to-field and its reverse, and the
 * editor around it - divider, outline, path bar, focus mode, screen widths and
 * the preview's block toolbar.
 *
 * Mounted in the document controls by the plugin. Only for the document's own
 * form: a document opened in a drawer on top of it has a form of its own and
 * no live preview, and two of these would answer every click twice.
 */
export const LivePreviewInspectorListener: React.FC<LivePreviewInspectorListenerProps> = (props) => {
  const editDepth = useEditDepth()
  if (editDepth > 1) {
    return null
  }
  return (
    <Contained name="The editor">
      <Inspector {...props} />
    </Contained>
  )
}

const Inspector: React.FC<LivePreviewInspectorListenerProps> = ({
  accordionAnimationMs = DEFAULT_COLLAPSIBLE_ANIMATION_MS,
  editor = {},
  flashColor,
  flashDurationMs,
  scrollBehavior = 'smooth',
  scrollOffset,
  tabSwitchWaitMs = DEFAULT_TAB_SWITCH_WAIT_MS,
}) => {
  const { iframeRef, isLivePreviewing, loadedURL, previewWindowType, url } = useLivePreviewContext()
  const features = {
    blockToolbar: editor.blockToolbar !== false,
    focusMode: editor.focusMode !== false,
    outline: editor.outline !== false,
    pathBar: editor.pathBar !== false,
    split: editor.split !== false,
    stacked: editor.stacked !== false,
    viewports: editor.viewports === false ? [] : (editor.viewports ?? DEFAULT_VIEWPORTS),
  }

  /*
   * What the preview says it does with a click, for the hint below.
   *
   * `undefined` until the iframe reports, and the hint then says only the half
   * that is certainly true. The two sides of this plugin are configured
   * separately - the admin half through the plugin's `clientProps`, the iframe
   * half by whoever renders `LivePreviewInspectorClient` - so describing the
   * modifier without asking would be describing a default, and a site that
   * turned it off would be showing its editors an instruction that does
   * nothing.
   */
  const [previewSettings, setPreviewSettings] = useState<{ interactionModifier: string } | undefined>(undefined)
  const activeURL = loadedURL || url
  const [notFoundNotice, setNotFoundNotice] = useState(false)
  // Where the current reveal is going, for the hint - named the way the form
  // names it.
  const [revealLabel, setRevealLabel] = useState<string | undefined>(undefined)
  const { i18n } = useTranslation()
  const language = i18n.language
  const languageRef = useRef(language)
  languageRef.current = language
  const strings = useMemo(() => stringsFor(language), [language])
  const stringsRef = useRef(strings)
  stringsRef.current = strings
  const stacked = useMaxWidth(PAYLOAD_MID_BREAK_PX)

  // `useForm()` is the form's API, read at the time it is needed; it does not
  // re-render this component when a field changes (see `FormWatcher`).
  const form = useForm()
  const formRef = useRef(form)
  formRef.current = form
  const getFieldsRef = useRef(form.getFields)
  getFieldsRef.current = form.getFields
  const dispatchFieldsRef = useRef(form.dispatchFields)
  dispatchFieldsRef.current = form.dispatchFields

  // The edited document's field config: it knows which tab holds a field and
  // which rows sit on the way to it, so a reveal can go straight there
  // instead of clicking through tabs to find out.
  const { collectionSlug, globalSlug, hasSavePermission } = useDocumentInfo()
  const { config, getEntityConfig } = useConfig()
  const entityConfig = collectionSlug
    ? getEntityConfig({ collectionSlug })
    : globalSlug
      ? getEntityConfig({ globalSlug })
      : undefined
  const schemaRef = useRef<{ blocksMap: BlocksMap; fields: SchemaField[] } | null>(null)
  schemaRef.current = entityConfig
    ? {
        blocksMap: (config.blocksMap ?? {}) as unknown as BlocksMap,
        fields: entityConfig.fields as unknown as SchemaField[],
      }
    : null
  const hasSavePermissionRef = useRef(hasSavePermission)
  hasSavePermissionRef.current = hasSavePermission
  /**
   * Whether the form takes changes - asked when it matters, not remembered
   * from the last render: Payload flips `disabled` on the form's own object
   * (a lock taken over, a document moved to the trash) without rendering this.
   */
  const isReadOnly = useCallback(
    () => hasSavePermissionRef.current === false || Boolean(formRef.current.disabled),
    [],
  )

  /* ---------------------------------------------------------------- state */

  const [outline, setOutline] = useState<null | Outline>(null)
  const outlineRef = useRef<null | Outline>(null)
  const outlineSignatureRef = useRef('')
  /** The row the editor is at, by row ids - what the preview frames and the path bar spells out. */
  const [selection, setSelection] = useState<null | string>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  /** The row focus mode shows, by row ids; `null` shows everything. */
  const [focusRoot, setFocusRoot] = useState<null | string>(null)
  const [focusModeChoice, setFocusModeChoice] = useStored<boolean | null>(
    FOCUS_MODE_KEY,
    (value): value is boolean => isBoolean(value),
    null,
  )
  const focusMode =
    features.focusMode && (focusModeChoice ?? (editor.focusMode === 'on' || (stacked && isLivePreviewing)))
  const focusModeRef = useRef(focusMode)
  focusModeRef.current = focusMode
  const [outlineOpen, setOutlineOpen] = useStored(OUTLINE_KEY, isBoolean, false)
  /** A row the editor asked to add a block below, while they pick which. */
  const [insertBelow, setInsertBelow] = useState<{ field: SchemaField; path: string } | null>(null)

  /** The preview, once it has loaded and spoken: how to send it a message. */
  const previewRef = useRef<{ post: (message: Record<string, unknown>) => void } | null>(null)
  const postToPreview = useCallback((message: Record<string, unknown>) => previewRef.current?.post(message), [])

  /*
   * Where document values go once the preview has asked for them. The
   * preview used to ask again after every render batch - i.e. every
   * keystroke - and got the whole form serialised each time; now the admin
   * sends a snapshot when the values actually changed, and only then.
   */
  const valuesChannelRef = useRef<{ lastSignature: string; post: (leaves: DocumentLeafValue[]) => void } | null>(
    null,
  )

  /** Shared with the focus listeners below; see `suppressFocusEcho` in the reveal. */
  const engineRef = useRef({ suppressFocusEcho: false })
  const revealRef = useRef<Reveal>(() => {})

  /*
   * The veil: the form faded out while a reveal opens rows, switches tabs and
   * jumps, and faded in once the field is in place.
   *
   * Without it a jump to a field closed three levels down is seen in stages -
   * a header lights up, a row slides open empty, its fields pop in, the page
   * leaps, the field flashes - which reads as lag even where it is quick. With
   * it, it is one change: the form goes, and comes back at the field. Only
   * where the page jumps anyway (`scrollBehavior: 'instant'`, the theme's
   * default): an animated glide is there to show the way, and hiding it would
   * hide the point. And only when something moves - a field in plain view is
   * flashed where it is.
   *
   * One veil at a time, owned by the newest reveal: a second click while the
   * first is under way takes it over rather than lifting it half-way.
   */
  const veilRef = useRef<{ curtain: Curtain | null; owner: number; safety?: ReturnType<typeof setTimeout> }>({
    curtain: null,
    owner: 0,
  })
  const unveil = useCallback((owner?: number) => {
    const state = veilRef.current
    if (owner === undefined || owner !== state.owner || !state.curtain) {
      return
    }
    clearTimeout(state.safety)
    state.curtain.lift()
    state.curtain = null
  }, [])
  const veilForm = useCallback((): number => {
    const state = veilRef.current
    const owner = state.owner + 1
    state.owner = owner
    if (!state.curtain) {
      const main = editMainEl()
      const parts = main
        ? Array.from(main.children).filter(
            (child): child is HTMLElement => child instanceof HTMLElement && !child.hasAttribute(HOST_ATTRIBUTE),
          )
        : []
      const curtains = parts.map((part) => drawCurtain(part, { fade: true }))
      state.curtain = { lift: () => curtains.forEach((curtain) => curtain.lift()) }
    }
    clearTimeout(state.safety)
    state.safety = setTimeout(() => unveil(owner), VEIL_MAX_MS)
    return owner
  }, [unveil])
  const unveilRef = useRef(unveil)
  unveilRef.current = unveil
  useEffect(
    () => () => {
      // Gone in the middle of a jump - after an error, say - the editor must
      // not leave the form faded out behind it.
      const state = veilRef.current
      clearTimeout(state.safety)
      state.curtain?.lift()
      state.curtain = null
    },
    [],
  )

  /* -------------------------------------------------------- reveal engine */

  useEffect(() => {
    // One controller per reveal: a newer click aborts everything the older
    // one still has in flight - its waits, its scroll corrections and, most
    // importantly, a tab search that would otherwise keep clicking tabs (and
    // finally restore the old ones) underneath the reveal that replaced it.
    let revealController: AbortController | undefined

    // Set while a reveal focuses the field it just scrolled to. That focus
    // fires `focusin` exactly like a real one, and the reverse direction would
    // send it straight back to the preview - scrolling it away from the very
    // element the user clicked (in a long rich text, back to its first
    // paragraph, since the field's own path is all a `focusin` can tell us).
    let echoTimer: ReturnType<typeof setTimeout> | undefined
    let noticeTimer: ReturnType<typeof setTimeout> | undefined
    let labelTimer: ReturnType<typeof setTimeout> | undefined
    let healTimer: ReturnType<typeof setTimeout> | undefined
    const showNotFound = () => {
      clearTimeout(noticeTimer)
      setNotFoundNotice(true)
      noticeTimer = setTimeout(() => setNotFoundNotice(false), NOT_FOUND_NOTICE_MS)
    }

    revealRef.current = (path, { caret, focus = true, onStatus, veil } = {}) => {
      const sendStatus = (status: RevealStatus, label?: string) => onStatus?.(status, label)
      // Under the veil nothing is seen until the end: no route to light up, no
      // area to fade in on its own.
      const veiled = veil !== undefined
      // The page may only move once the form is out of sight: a jump during
      // the fade is a jump the editor sees.
      const veilDownAt = veiled ? performance.now() + VEIL_FADE_MS : 0
      const glow = (el: Element | null | undefined) => {
        if (!veiled) {
          pulse(el)
        }
      }
      const formState = getFieldsRef.current()
      const resolvedPath = resolveRowIDs(path, formState)
      const schema = schemaRef.current

      // Answered before anything moves - the preview marks the click the
      // moment it happens and names where it's going from this reply.
      const target =
        resolvedPath && schema ? describeTarget(schema.fields, resolvedPath, formState, schema.blocksMap) : null
      const label = target ? labelOfTarget(target, languageRef.current) : undefined
      sendStatus('started', label)
      clearTimeout(labelTimer)
      setRevealLabel(label)

      if (!resolvedPath) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console -- intentional dev-only diagnostic
          console.warn(`[payload-live-preview-inspector] Could not resolve a row id in path "${path}"`)
        }
        unveilRef.current(veil)
        sendStatus('not-found')
        showNotFound()
        return
      }

      revealController?.abort()
      const controller = new AbortController()
      revealController = controller
      const { signal } = controller
      const timer = createRevealTimer(resolvedPath)

      /** Sets `collapsed` on rows of one or more Array/Blocks fields - one dispatch per field, so none overwrites another. */
      const setRowsCollapsed = (rows: { index: number; path: string }[], collapsed: boolean) => {
        const byPath = new Map<string, Set<number>>()
        for (const { index, path: rowsPath } of rows) {
          byPath.set(rowsPath, (byPath.get(rowsPath) ?? new Set()).add(index))
        }
        for (const [rowsPath, indices] of byPath) {
          const formRows = getFieldsRef.current()[rowsPath]?.rows
          if (formRows) {
            dispatchFieldsRef.current({
              type: 'SET_ROW_COLLAPSED',
              path: rowsPath,
              updatedRows: formRows.map((row, i) => (indices.has(i) ? { ...row, collapsed } : row)),
            } as never)
          }
        }
      }

      // Open rows Payload rendered nothing into (see `findUnrenderedRows`):
      // what an editor saw on a customer page, until they closed and reopened
      // the row themselves. The same, done here - first invisibly, and only
      // if that isn't enough, the way they did it. Any open row near the
      // viewport counts, not only the ones this reveal opened: the one found
      // stuck there had been open all along, inside a section the reveal
      // opened.
      const healUnrenderedRows = async (): Promise<void> => {
        if (findUnrenderedRows().length === 0) {
          return
        }
        // Still rendering is not stuck.
        await waitForElement(() => null, 150, { signal })
        let stuck = findUnrenderedRows()
        if (stuck.length === 0 || signal.aborted) {
          return
        }
        const allRendered = () => (findUnrenderedRows().length === 0 ? document.body : null)
        const names = () => stuck.map(({ index, path: rowsPath }) => `"${rowsPath}.${index}"`).join(', ')

        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console -- intentional dev-only diagnostic
          console.warn(
            `[payload-live-preview-inspector] Open row(s) ${names()} with none of their fields rendered by Payload - asking again`,
          )
        }
        await Promise.all(stuck.map(({ fields }) => renotifyIntersection(fields)))
        await waitForElement(allRendered, 300, { signal })
        stuck = findUnrenderedRows()
        if (stuck.length === 0 || signal.aborted) {
          return
        }

        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console -- intentional dev-only diagnostic
          console.warn(`[payload-live-preview-inspector] Row(s) ${names()} still empty - reopening`)
        }
        setRowsCollapsed(stuck, true)
        // Closed for good first - Payload hides a closed row's content only
        // once its closing animation has run.
        await waitForElement(() => null, accordionAnimationMs, { signal })
        if (!signal.aborted) {
          setRowsCollapsed(stuck, false)
        }
      }

      // Areas hidden while Payload renders into them (see `drawCurtain`).
      // Always lifted in the end - an aborted or failed reveal must not leave
      // anything invisible.
      const curtains: Curtain[] = []
      const hideWhileRendering = (el: HTMLElement | null | undefined, options?: { fade?: boolean }) => {
        if (!veiled) {
          curtains.push(drawCurtain(el, options))
        }
      }
      const liftCurtains = () => {
        for (const curtain of curtains.splice(0)) {
          curtain.lift()
        }
      }

      const revealField = async (): Promise<'ancestor' | 'exact' | 'not-found'> => {
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
          checkExact() ?? (resolvedPathDepth(resolvedPath) > depth ? resolveFieldElement(resolvedPath) : null)

        const totalDepth = resolvedPath.split('.').length

        // Phase 1: the plan. The field config says which tabs have to be
        // active and which rows expanded on the way to the target, so none of
        // it has to be found out by trying.
        const plan = schema ? planReveal(schema.fields, resolvedPath, formState, schema.blocksMap) : null
        let planApplied = false
        const depthBeforePlan = resolvedPathDepth(resolvedPath)

        // One camera for the whole reveal (see `createCamera`): every stop on
        // the way bends the motion instead of ending it.
        const camera = createCamera({ behavior: scrollBehavior, offset: scrollOffset ?? DEFAULT_SCROLL_OFFSET, signal })
        /** The deepest part of the path that is rendered, asked afresh on every frame. */
        const deepest = () => checkExact() ?? resolveFieldElement(resolvedPath)

        // Move at once when nothing on the way is left to open - every tab
        // active, every collapsible and row open: the page heads for the
        // deepest part of the path that is rendered, bending onto the target
        // as it mounts, with no pause between click and motion.
        const routeInView =
          plan &&
          schema &&
          plan.steps.every((step) => {
            if (step.kind === 'row') {
              return !formState[step.path]?.rows?.[step.index]?.collapsed
            }
            if (step.kind === 'collapsible') {
              const collapsible = collapsibleOf(document.getElementById(step.id))
              return Boolean(collapsible) && !isCollapsedCollapsible(collapsible)
            }
            const tabsEl = findTabsElement(step, schema.fields, formState, schema.blocksMap)
            return Boolean(tabsEl && tabButtonsOf(tabsEl)[step.index]?.classList.contains(TAB_BUTTON_ACTIVE_CLASS))
          })
        const target = deepest()
        // Under a veil there is no way to show, only an end to arrive at.
        if (!veiled && routeInView && target && !(checkExact() && isInRestingView(target))) {
          camera.aim(deepest)
        }

        if (plan && schema && !checkExact()) {
          // Go to where each thing opens and open it there. Opened out of
          // sight, a tab switch clamps the page's scroll and a row grows
          // somewhere the editor isn't looking - all they see is a jump.
          // It opens as the page arrives, not after it has stopped: the
          // motion goes on from there to the next stop or the field.
          //
          // Except for a tab: switching it replaces everything beneath it,
          // and done mid-motion that cut the motion short with a jump. A
          // tab switches once the page is still.
          const bringIntoView = async (control: HTMLElement | null | undefined, { atRest = false } = {}) => {
            // A control focus mode hides has no place on the page to travel
            // to - it is operated where it is. Nor has one under the veil.
            if (veiled || (control && control.getClientRects().length === 0)) {
              return
            }
            if (control && !isInOpeningView(control)) {
              // Never travel blind: what opened before has rendered by now
              // (this step's control was found in it), and once it has
              // settled it fades in as the page moves off - settled first,
              // or it would still be shifting while the editor watches.
              if (curtains.length > 0) {
                await waitForQuietFrames(signal)
              }
              liftCurtains()
              camera.aim(control)
              await (atRest ? camera.arrived() : camera.near(OPEN_WHEN_NEAR_PX))
            }
          }
          const rowHeaderOf = (rowsPath: string, index: number) =>
            toggleWrapOf(collapsibleOf(document.getElementById(rowIDFromPath(`${rowsPath}.${index}`) ?? '')))

          planApplied = plan.complete
          let clicked = false
          let rowsExpanded = false

          for (const [position, step] of plan.steps.entries()) {
            if (step.kind === 'row') {
              if (rowsExpanded || !getFieldsRef.current()[step.path]?.rows?.[step.index]?.collapsed) {
                continue
              }

              const find = () => rowHeaderOf(step.path, step.index)
              await bringIntoView(clicked ? await waitForElement(find, tabSwitchWaitMs, { signal }) : find())
              if (signal.aborted) {
                return 'not-found'
              }

              // This row and every collapsed one inside it, in one go and
              // through the form state that owns the flag - not one toggle
              // click per level, each waiting for the last to render. Rows
              // that aren't mounted yet (behind a tab still to switch) take
              // the flag just the same and render expanded when they do.
              const rows: { index: number; path: string }[] = []
              for (const inner of plan.steps.slice(position)) {
                if (inner.kind !== 'row') {
                  continue
                }
                if (!getFieldsRef.current()[inner.path]?.rows?.[inner.index]?.collapsed) {
                  continue
                }
                rows.push(inner)
              }
              // Nested rows open inside the first one: its box hides them all.
              // The rows below it on screen step aside too - they would be
              // pushed down in bursts as it fills - and come back where they
              // end up.
              const rowEl = document.getElementById(rowIDFromPath(`${step.path}.${step.index}`) ?? '')
              hideWhileRendering(openingAreaOf(collapsibleOf(rowEl)))
              for (const below of veiled ? [] : visibleRowsAfter(rowEl)) {
                hideWhileRendering(below, { fade: true })
              }
              setRowsCollapsed(rows, false)
              rowsExpanded = true
              clicked = true

              // Let React commit the expansion before anything reads the DOM:
              // a row still *rendered* collapsed would look like a toggle to
              // click to the accordion fallback below, which would then close
              // what was just opened.
              await nextFrames(2)
              if (signal.aborted) {
                return 'not-found'
              }
              for (const row of rows) {
                glow(rowHeaderOf(row.path, row.index))
              }
              continue
            }

            // Tabs and collapsibles from the outside in: an inner one only
            // exists once the outer one holding it is open. Only after
            // something changed can the next one still be mounting, so only
            // then is it waited for.
            if (step.kind === 'collapsible') {
              const find = () => document.getElementById(step.id)
              const collapsibleEl = clicked ? await waitForElement(find, tabSwitchWaitMs, { signal }) : find()
              if (signal.aborted) {
                return 'not-found'
              }
              if (!collapsibleEl) {
                planApplied = false
                break
              }
              const collapsible = collapsibleOf(collapsibleEl)
              if (isCollapsedCollapsible(collapsible)) {
                const toggleWrap = toggleWrapOf(collapsible)
                await bringIntoView(toggleWrap)
                if (signal.aborted) {
                  return 'not-found'
                }
                glow(toggleWrap)
                hideWhileRendering(openingAreaOf(collapsible))
                toggleButtonOf(collapsible)?.click()
                clicked = true
              }
              continue
            }

            const find = () => findTabsElement(step, schema.fields, getFieldsRef.current(), schema.blocksMap)
            const tabsEl = clicked ? await waitForElement(find, tabSwitchWaitMs, { signal }) : find()
            if (signal.aborted) {
              return 'not-found'
            }

            const button = tabsEl ? tabButtonsOf(tabsEl)[step.index] : undefined
            if (!button) {
              // Not identifiable (a tab with nothing in it to recognise it
              // by) - leave the rest of the tabs to the search below.
              planApplied = false
              break
            }

            if (!button.classList.contains(TAB_BUTTON_ACTIVE_CLASS)) {
              await bringIntoView(button, { atRest: true })
              if (signal.aborted) {
                return 'not-found'
              }
              glow(button)
              hideWhileRendering(tabContentOf(tabsEl))
              button.click()
              clicked = true
            }
          }

          timer.phase('open')

          // Opened: the header was only a way there. Chasing it further - the
          // page too short to bring it all the way up until the rows below
          // it had rendered - was a motion of its own before the one to the
          // field. The next aim is the field.
          if (clicked) {
            camera.hold()
          }

          // Whatever the plan changed renders now - wait for it to show,
          // i.e. for the target or at least a deeper part of its path than
          // before. No idle cut-off: this wait follows a click.
          if (clicked && !checkExact()) {
            await waitForElement(progressBeyond(depthBeforePlan), tabSwitchWaitMs, { signal })
            if (signal.aborted) {
              return 'not-found'
            }
          }
          timer.phase('mount')
          // And let it finish rendering before the page moves on: the fields
          // it mounted, the editors they initialise.
          if (clicked) {
            await waitForQuietFrames(signal)
            if (signal.aborted) {
              return 'not-found'
            }
          }
          await healUnrenderedRows()
          if (signal.aborted) {
            return 'not-found'
          }
          timer.phase('settle')
        }

        // Phase 2: whatever the plan didn't cover. Expanding a rendered
        // ancestor's collapsed accordions (collapsible fields keep their
        // state in the component, not the form) is always cheaper than
        // touching tabs; tabs are only searched when the plan couldn't say
        // which one to open.
        for (let step = 0; step <= totalDepth && !checkExact(); step++) {
          const progressed = progressBeyond(resolvedPathDepth(resolvedPath))

          const ancestor = resolveFieldElement(resolvedPath)
          if (ancestor && expandCollapsedAncestors(ancestor)) {
            // Only reached again after this wait, so a pending toggle click
            // is committed long before `expandCollapsedAncestors` re-reads
            // its class. Slow mounts (a rich-text editor, below-viewport
            // deferred fields) that outlive this budget are caught by the
            // scroll-and-settle phase below.
            await waitForElement(progressed, accordionAnimationMs, { signal })
          } else if (planApplied) {
            // The right tabs are open already; what is still missing is
            // mounting (a lazy editor, a field below the fold), which the
            // scroll below brings about. Searching other tabs can only hurt.
            break
          } else {
            const found = await revealTabForElement(progressed, tabSwitchWaitMs, ancestor ?? document, signal)
            if (!found) {
              break
            }
          }
          if (signal.aborted) {
            return 'not-found'
          }
        }
        timer.phase('expand')

        let el = resolveFieldElement(resolvedPath)

        if (!el) {
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console -- intentional dev-only diagnostic
            console.warn(`[payload-live-preview-inspector] Could not resolve path "${resolvedPath}" to a field`)
          }
          return 'not-found'
        }

        if (veiled) {
          const wait = veilDownAt - performance.now()
          if (wait > 0) {
            await waitForElement(() => null, wait, { signal })
            if (signal.aborted) {
              return 'not-found'
            }
          }
        }

        // Phase 3: scroll and settle. Payload defers rendering fields that
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
            await waitForElementLayout(el, accordionAnimationMs, signal)
            if (signal.aborted) {
              return 'not-found'
            }
          }

          // Arrived already: opened right where the editor is looking, the
          // field is in plain view - moving the page now would only take it
          // away from under their eyes to put it at the offset. (Measured:
          // that nudge was the second motion after nearly every row opened,
          // the field sitting just under the header the page had come to.)
          await camera.arrived()
          // Payload renders a deep path level by level, each one a frame or
          // more after the last. Aimed at every level as it appeared, that
          // was one motion per level with a halt in between; once the target
          // itself has shown, it is one motion, or none. Given up on silence:
          // what only renders when scrolled near is left to the motion below.
          if (step === 0 && !checkExact()) {
            await waitForElement(checkExact, tabSwitchWaitMs, { idleMs: IDLE_GIVE_UP_MS, signal })
            if (signal.aborted) {
              return 'not-found'
            }
          }
          // And until it holds still: levels above it that are still
          // rendering push it down in bursts, a few frames apart - followed
          // as they came, that was a second motion after a halt. Behind the
          // curtain, the wait shows nothing.
          const arrived = checkExact()
          if (step === 0 && arrived) {
            await waitForStablePosition(arrived, { frames: 6, signal, timeoutMs: 600 })
            if (signal.aborted) {
              return 'not-found'
            }
          }
          if (arrived && isInRestingView(arrived)) {
            liftCurtains()
            el = arrived
            break
          }

          // Aimed at the deepest part of the path that is rendered *on each
          // frame*: the target mounts during this very motion as soon as it
          // comes within Payload's render margin of the viewport, and the
          // motion bends toward it instead of finishing the trip to an
          // ancestor and starting a second one from there. What opened
          // fades in on the way.
          const ancestorEl = el
          camera.aim(() => deepest() ?? ancestorEl)
          liftCurtains()
          await camera.arrived()
          if (signal.aborted) {
            return 'not-found'
          }
          el = checkExact() ?? resolveFieldElement(resolvedPath) ?? el

          // Already on the exact target (or as deep as we will ever get and
          // nothing deeper mounted after the scroll) - stop here.
          //
          // The one wait in a reveal that may give up on silence: unlike the
          // tab and accordion waits above, this one triggered nothing. The
          // scroll it follows has settled, so anything it set off (Payload
          // mounts deferred fields as they enter the viewport) has either
          // shown itself or is still loading - and both of those count as
          // activity. Without this, every reveal ended in ~1.4s of waiting
          // for a DOM that was already final.
          const next =
            checkExact() ??
            (await waitForElement(progressBeyond(resolvedPathDepth(resolvedPath)), tabSwitchWaitMs, {
              idleMs: IDLE_GIVE_UP_MS,
              signal,
            }))
          if (signal.aborted) {
            return 'not-found'
          }
          if (!next || next === el) {
            break
          }
          el = next
        }
        timer.phase('scroll')

        if (focus) {
          // Cleared on a macrotask rather than right after the call: `focusin`
          // itself is synchronous, but an editor settling the selection we just
          // set (Lexical does) can move focus again in a microtask. Real user
          // focus cannot land inside that window, so nothing legitimate is lost.
          engineRef.current.suppressFocusEcho = true
          const caretEl = focusElement(el, caret, { inFields: el.id === rowIDFromPath(resolvedPath) })
          echoTimer = setTimeout(() => {
            engineRef.current.suppressFocusEcho = false
          })

          // The scroll above put the *field* at `scrollOffset`; in a long rich
          // text the clicked position can still be far below the fold, so bring
          // the caret itself into view - but only when it actually is off
          // screen, since `scrollToElement` otherwise re-centers a field the
          // user can already see.
          if (caretEl) {
            const { bottom, top } = caretEl.getBoundingClientRect()
            if (top < 0 || bottom > window.innerHeight) {
              camera.aim(caretEl)
              await camera.arrived()
              if (signal.aborted) {
                return 'not-found'
              }
            }
          }
        }

        // Last, once nothing moves any more: a field that lights up while the
        // page still slides under it reads as restless, not as "here". The
        // form comes back at the same moment.
        unveilRef.current(veil)
        sharedFlashElement(el, { className: classes.flash, color: flashColor, durationMs: flashDurationMs })
        timer.phase('focus')

        return el === checkExact() ? 'exact' : 'ancestor'
      }

      void revealField()
        .catch((error: unknown) => {
          // A jump that broke ends like one that found nothing: everything it
          // hid comes back, and the editor hears that the field is not there.
          // eslint-disable-next-line no-console -- a jump that broke has to leave a trace
          console.error(`[payload-live-preview-inspector] The jump to "${resolvedPath}" failed.`, error)
          return 'not-found' as const
        })
        .then((outcome) => {
          liftCurtains()
          // Lifted by now unless the reveal failed or a newer one took it over.
          unveilRef.current(veil)
          timer.end(signal.aborted ? 'aborted' : outcome)
          // Rows deeper inside mount only after the ones around them rendered -
          // one more look once all of it had the time to.
          if (!signal.aborted) {
            clearTimeout(healTimer)
            healTimer = setTimeout(() => void healUnrenderedRows(), 600)
          }
          if (!signal.aborted) {
            sendStatus(outcome === 'not-found' ? 'not-found' : 'done')
            labelTimer = setTimeout(() => setRevealLabel(undefined), 1_500)
            if (outcome === 'not-found') {
              showNotFound()
            }
          }
          if (revealController === controller) {
            revealController = undefined
          }
        })
    }

    return () => {
      clearTimeout(echoTimer)
      clearTimeout(noticeTimer)
      clearTimeout(labelTimer)
      clearTimeout(healTimer)
      revealController?.abort()
      revealRef.current = () => {}
    }
  }, [accordionAnimationMs, flashColor, flashDurationMs, scrollBehavior, scrollOffset, tabSwitchWaitMs])

  /* ------------------------------------------------------------ selection */

  /** The row focus mode shows, as the DOM applies it - ahead of React, see `select`. */
  const isolationRef = useRef<null | string>(null)

  /**
   * Hides everything in the form but the row focus mode shows: the row itself
   * or - still mounting behind rows a reveal is opening - the deepest row on
   * the way to it that is there already.
   */
  const applyIsolation = useCallback(() => {
    const root = editMainEl()
    if (!root) {
      return
    }
    const target = isolationRef.current
    if (!target) {
      isolate(root, null)
      return
    }
    const formState = getFieldsRef.current()
    const chain = chainOf(outlineRef.current?.byRowIDPath.get(target))
    const rowEl = (rowIDPath: string) => {
      const path = resolveRowIDs(rowIDPath, formState)
      return path ? document.getElementById(rowIDFromPath(path) ?? '') : null
    }
    let el: HTMLElement | null = null
    for (const node of [...chain].reverse()) {
      el = rowEl(node.rowIDPath)
      if (el) {
        break
      }
    }
    isolate(root, el, chain[0] ? rowEl(chain[0].rowIDPath) : null)
  }, [])

  const scrollBehaviorRef = useRef(scrollBehavior)
  scrollBehaviorRef.current = scrollBehavior

  /**
   * Veils the form for a reveal of `path` that is going to change what it
   * shows - focus mode moving to another row, or a field that is not in plain
   * view - and returns the veil's owner, for the reveal to lift; `undefined`
   * where nothing will visibly move, or where the page glides instead of
   * jumping (see `veilRef`). A veil already down is always taken over.
   */
  const beginTravel = useCallback(
    (path: string, isolateTo: null | string): number | undefined => {
      if (veilRef.current.curtain) {
        return veilForm()
      }
      if (scrollBehaviorRef.current !== 'instant') {
        return undefined
      }
      if (focusModeRef.current && isolateTo !== isolationRef.current) {
        return veilForm()
      }
      const formState = getFieldsRef.current()
      const resolved = resolveRowIDs(path, formState)
      if (!resolved) {
        return undefined
      }
      const fieldPath = fieldPathFromFormState(resolved, formState)
      const el = resolveExactFieldElement(resolved) ?? (fieldPath ? resolveExactFieldElement(fieldPath) : null)
      return el && el.getClientRects().length > 0 && isInRestingView(el) ? undefined : veilForm()
    },
    [veilForm],
  )
  const beginTravelRef = useRef(beginTravel)
  beginTravelRef.current = beginTravel

  /**
   * The editor is at `rowIDPath` now. Where it came from decides what else
   * follows: a choice in the preview, the outline or the path bar narrows
   * focus mode to it; a field focused in the form only says where the editor
   * is, and leaves what focus mode shows alone - narrowing it under their
   * hands as they tab through a column would hide the field they tab to next.
   */
  const select = useCallback(
    (rowIDPath: null | string, from: SelectionSource, { focusField = false, reveal = false } = {}) => {
      const narrows = focusModeRef.current && from !== 'form'
      const veil =
        reveal && rowIDPath ? beginTravel(rowIDPath, narrows ? rowIDPath : isolationRef.current) : undefined
      setSelection(rowIDPath)
      if (narrows) {
        setFocusRoot(rowIDPath)
        // At once, before the reveal below starts: it opens the way to the
        // row, and what it opens should already be all there is to see.
        isolationRef.current = rowIDPath
        applyIsolation()
      }
      if (reveal && rowIDPath) {
        revealRef.current(rowIDPath, { focus: focusField, veil })
      }
      if (features.blockToolbar) {
        postToPreview({ type: SELECT_MESSAGE_TYPE, path: rowIDPath })
      }
      if (rowIDPath && from !== 'preview' && from !== 'form') {
        // Taken there in the preview too, the way focusing a field is.
        postToPreview({ type: FOCUS_MESSAGE_TYPE, path: rowIDPath })
      }
    },
    [applyIsolation, beginTravel, features.blockToolbar, postToPreview],
  )
  const selectRef = useRef(select)
  selectRef.current = select

  /* ------------------------------------------------------------- outline */

  const pushStructure = useCallback(() => {
    if (!features.blockToolbar || !outlineRef.current) {
      return
    }
    postToPreview({
      type: STRUCTURE_MESSAGE_TYPE,
      rows: previewRowsOf(outlineRef.current),
      strings: previewStringsOf(stringsRef.current),
    })
  }, [features.blockToolbar, postToPreview])

  const needsOutline = features.outline || features.pathBar || features.focusMode || features.blockToolbar

  const recomputeOutline = useCallback(() => {
    const schema = schemaRef.current
    if (!needsOutline || !schema) {
      return
    }
    const next = buildOutline(schema.fields, getFieldsRef.current(), {
      blocksMap: schema.blocksMap,
      language: languageRef.current,
      readOnly: isReadOnly(),
    })
    outlineRef.current = next
    const signature = outlineSignature(next)
    if (signature !== outlineSignatureRef.current) {
      outlineSignatureRef.current = signature
      setOutline(next)
      pushStructure()
    }
  }, [isReadOnly, needsOutline, pushStructure])

  // Labels are in the admin's language: a new language is a new outline.
  useEffect(() => {
    outlineSignatureRef.current = ''
    recomputeOutline()
  }, [language, recomputeOutline])

  // A row that went away takes the selection and focus mode to the row around it.
  useEffect(() => {
    if (!outline) {
      return
    }
    const parentRowOf = (path: string): null | string => rowIDPathOf(path.split('.').slice(0, -1).join('.'))
    const survivor = (path: null | string): null | string => {
      for (let current = path; current; current = parentRowOf(current)) {
        if (outline.byRowIDPath.has(current)) {
          return current
        }
      }
      return null
    }
    // Gone from the form, not merely not in the outline yet: a row just added
    // is selected before the outline, rebuilt a moment later, has it.
    const gone = (path: string) =>
      !outline.byRowIDPath.has(path) && resolveRowIDs(path, getFieldsRef.current()) === null
    if (selection && gone(selection)) {
      setSelection(survivor(selection))
    }
    if (focusRoot && gone(focusRoot)) {
      setFocusRoot(survivor(focusRoot))
    }
  }, [focusRoot, outline, selection])

  /* ------------------------------------------------- the form, as it changes */

  // Push new document values to the preview once the form has been still
  // for a moment - and only when they actually differ from the last push
  // (a change to a number or a checkbox leaves every string alone).
  const formChangeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onFormChange = useCallback(() => {
    clearTimeout(formChangeTimer.current)
    formChangeTimer.current = setTimeout(() => {
      const channel = valuesChannelRef.current
      if (channel) {
        const leaves = collectLeafValues(getFieldsRef.current())
        const signature = signatureOf(leaves)
        if (signature !== channel.lastSignature) {
          channel.lastSignature = signature
          channel.post(leaves)
        }
      }
      recomputeOutline()
    }, VALUES_PUSH_DEBOUNCE_MS)
  }, [recomputeOutline])
  useEffect(() => () => clearTimeout(formChangeTimer.current), [])

  /* ---------------------------------------------------------- row actions */

  /** The ids of the rows in the field `path` is a row of, as they are now. */
  const rowIDsAround = (path: string): Set<string> => {
    const row = splitRowPath(path)
    return new Set((row ? getFieldsRef.current()[row.fieldPath]?.rows : undefined)?.map((entry) => entry.id) ?? [])
  }

  /**
   * The row-id path of the row a duplicate or an insert put at `path`, once the
   * form state has it - a row whose id none of `before` had. The form applies
   * the change on its next render, so until then the row at that index is the
   * one that is about to move down, and selecting it would select the wrong
   * block (and a "remove" right after would remove it).
   */
  const waitForNewRow = useCallback(async (path: string, before: Set<string>): Promise<null | string> => {
    const row = splitRowPath(path)
    if (!row) {
      return null
    }
    const started = Date.now()
    while (Date.now() - started < NEW_ROW_WAIT_MS) {
      const id = getFieldsRef.current()[row.fieldPath]?.rows?.[row.index]?.id
      if (id && !before.has(id)) {
        return toRowIDPath(path, getFieldsRef.current())
      }
      await nextFrames(2)
    }
    return null
  }, [])

  /** Until Payload's form has taken a change made to `formState` - or a while has passed. */
  const formChangedFrom = useCallback(async (formState: unknown): Promise<void> => {
    const started = Date.now()
    while (getFieldsRef.current() === formState && Date.now() - started < NEW_ROW_WAIT_MS) {
      await nextFrames(1)
    }
  }, [])

  const formAPI = (): RowFormAPI => formRef.current as unknown as RowFormAPI

  /**
   * Selects a row that was just added and puts the cursor in its first field -
   * once it has one. Payload renders a new row's fields only after a round to
   * the server, so revealing it at once found an empty row and focused
   * nothing; and the block drawer, closing, hands focus back to wherever it
   * came from, which would undo a focus set too early.
   */
  const selectNewRow = useCallback(async (rowIDPath: string) => {
    selectRef.current(rowIDPath, 'toolbar')
    const started = Date.now()
    while (Date.now() - started < NEW_ROW_WAIT_MS * 2) {
      const path = resolveRowIDs(rowIDPath, getFieldsRef.current())
      const row = path ? document.getElementById(rowIDFromPath(path) ?? '') : null
      if (!path) {
        return
      }
      if (
        row?.querySelector(
          `:scope ${selectorOf(PAYLOAD_CLASS.renderFields)} :is(input, textarea, select, [contenteditable="true"])`,
        )
      ) {
        break
      }
      await nextFrames(3)
    }
    revealRef.current(rowIDPath, { focus: true, veil: beginTravelRef.current(rowIDPath, isolationRef.current) })
  }, [])

  const runRowAction = useCallback(
    async (action: RowAction, rowIDPath: string) => {
      const formState = getFieldsRef.current()
      const path = resolveRowIDs(rowIDPath, formState)
      // What the row allows, from the form as it is now: the outline is
      // rebuilt a moment after each change, and an action checked against
      // the one before could take a row too many past min or max rows.
      const schema = schemaRef.current
      const node =
        path && schema
          ? buildOutline(schema.fields, formState, {
              blocksMap: schema.blocksMap,
              language: languageRef.current,
              readOnly: isReadOnly(),
            }).byPath.get(path)
          : undefined
      if (!path || !node) {
        return
      }
      const label = node.label

      if (action === 'select' || action === 'edit') {
        selectRef.current(rowIDPath, 'toolbar', { focusField: action === 'edit', reveal: true })
        return
      }
      if (isReadOnly()) {
        return
      }

      if ((action === 'up' || action === 'down') && node.abilities.move) {
        const moved = moveRow(formAPI(), path, action === 'up' ? -1 : 1)
        await formChangedFrom(formState)
        if (moved) {
          // The same row, by its id - which is what selection follows.
          selectRef.current(rowIDPath, 'toolbar')
          toast.success(stringsRef.current.moved(label), {
            action: { label: stringsRef.current.undo, onClick: moved.undo },
          })
        }
        return
      }

      if (action === 'duplicate' && node.abilities.duplicate) {
        const before = rowIDsAround(path)
        const copy = duplicateRow(formAPI(), path)
        if (copy) {
          const copyID = await waitForNewRow(copy.path, before)
          if (copyID) {
            selectRef.current(copyID, 'toolbar', { reveal: true })
          }
          toast.success(stringsRef.current.duplicated(label), {
            action: { label: stringsRef.current.undo, onClick: copy.undo },
          })
        }
        return
      }

      if (action === 'remove' && node.abilities.remove) {
        const removed = removeRow(formAPI(), path)
        await formChangedFrom(formState)
        if (removed) {
          selectRef.current(node.parent?.rowIDPath ?? null, 'toolbar')
          toast.success(stringsRef.current.removed(label), {
            action: { label: stringsRef.current.undo, onClick: removed.undo },
            duration: 8_000,
          })
        }
        return
      }

      if (action === 'insert' && node.abilities.insert) {
        const schema = schemaRef.current
        const target = schema ? describeTarget(schema.fields, path, formState, schema.blocksMap) : null
        const field = target?.field
        if (!field) {
          return
        }
        if (field.type === 'blocks') {
          // Which block is the editor's choice, made in Payload's own drawer.
          setInsertBelow({ field, path })
          return
        }
        const before = rowIDsAround(path)
        const added = insertRowBelow(formAPI(), path)
        if (added) {
          const addedID = await waitForNewRow(added.path, before)
          if (addedID) {
            await selectNewRow(addedID)
          }
        }
      }
    },
    [formChangedFrom, isReadOnly, selectNewRow, waitForNewRow],
  )
  const runRowActionRef = useRef(runRowAction)
  runRowActionRef.current = runRowAction

  /*
   * Row actions from the preview, one at a time and each against the form the
   * last one left: rows are addressed by index, which every move and removal
   * shifts. A few may wait - two quick clicks on "up" are two moves - and
   * past that the preview is sending faster than anyone clicks, so the rest
   * is dropped.
   */
  const rowActionsRef = useRef<{ pending: number; queue: Promise<void> }>({ pending: 0, queue: Promise.resolve() })
  const queueRowAction = useCallback((action: RowAction, rowIDPath: string) => {
    const state = rowActionsRef.current
    if (state.pending >= MAX_QUEUED_ROW_ACTIONS) {
      return
    }
    state.pending += 1
    state.queue = state.queue
      .then(() => runRowActionRef.current(action, rowIDPath))
      .catch((error: unknown) => {
        // eslint-disable-next-line no-console -- a block action that broke has to leave a trace
        console.error(`[payload-live-preview-inspector] The block action "${action}" failed.`, error)
      })
      .finally(() => {
        state.pending -= 1
      })
  }, [])

  /* ------------------------------------------------------- preview channel */

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

    const post = (message: Record<string, unknown>) =>
      iframeRef.current?.contentWindow?.postMessage(message, expectedOrigin)
    // From now on, not only once the preview has spoken: a focused field is
    // sent along even to a preview whose first message was missed.
    previewRef.current = { post }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const { data } = event
      if (!data || typeof data !== 'object') {
        return
      }

      if (data.type === SETTINGS_MESSAGE_TYPE) {
        setPreviewSettings(
          data.disableInteractions && typeof data.interactionModifier === 'string'
            ? { interactionModifier: data.interactionModifier }
            : undefined,
        )
        // A preview just loaded: give it the admin's colours, the rows its
        // toolbar works on, and what is selected.
        post({ type: THEME_MESSAGE_TYPE, accent: accentColor() })
        pushStructure()
        if (features.blockToolbar && selectionRef.current) {
          post({ type: SELECT_MESSAGE_TYPE, path: selectionRef.current })
        }
        return
      }

      if (data.type === REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE) {
        // The iframe wants the current field values for value matching -
        // reply with every string leaf, addressed by stable row ids, and
        // keep it posted from now on.
        const source = event.source as Window
        const channel = {
          lastSignature: '',
          post: (leaves: DocumentLeafValue[]) =>
            source.postMessage({ type: DOCUMENT_VALUES_MESSAGE_TYPE, leaves }, expectedOrigin),
        }
        const leaves = collectLeafValues(getFieldsRef.current())
        channel.lastSignature = signatureOf(leaves)
        channel.post(leaves)
        valuesChannelRef.current = channel
        // Asked until answered, so also the reliable moment for the rows.
        pushStructure()
        return
      }

      if (data.type === ROW_ACTION_MESSAGE_TYPE) {
        if (
          features.blockToolbar &&
          typeof data.path === 'string' &&
          isRowAction(data.action) &&
          (!changesForm(data.action) || followsAGesture())
        ) {
          queueRowAction(data.action, data.path)
        }
        return
      }

      if (data.type !== CLICK_MESSAGE_TYPE || typeof data.path !== 'string') {
        return
      }

      // Older clients send no id and get no status.
      const clickID: unknown = data.id
      const onStatus = (status: RevealStatus, label?: string) => {
        if (typeof clickID === 'number') {
          post({ id: clickID, type: REVEAL_STATUS_MESSAGE_TYPE, label, status })
        }
      }

      // The block the clicked field is in is where the editor is now - and,
      // in focus mode, all the form shows.
      const formState = getFieldsRef.current()
      const resolvedPath = resolveRowIDs(data.path, formState)
      const rowPath = resolvedPath ? rowPathOf(resolvedPath, formState) : null
      const rowIDPath = rowPath ? toRowIDPath(rowPath, formState) : null
      // Down before focus mode moves: what it hides and shows is part of the
      // change the editor sees only the end of.
      const veil = beginTravelRef.current(
        data.path,
        focusModeRef.current && rowIDPath ? rowIDPath : isolationRef.current,
      )
      if (rowIDPath) {
        selectRef.current(rowIDPath, 'preview')
      }

      revealRef.current(data.path, { caret: parseCaretHint(data.caret), onStatus, veil })
    }

    window.addEventListener('message', handleMessage)

    return () => {
      window.removeEventListener('message', handleMessage)
      previewRef.current = null
      valuesChannelRef.current = null
    }
  }, [iframeRef, activeURL, features.blockToolbar, pushStructure, queueRowAction])

  /* --------------------------------------- the form, as the editor moves in it */

  useEffect(() => {
    // Reverse direction: focusing a field in the admin form scrolls to and
    // flashes the matching element in the preview, the same way a click
    // there reveals the field here. And wherever it is, that is where the
    // editor is: the selection follows.
    const onFieldFocus = (el: HTMLElement) => {
      const path = pathFromFieldElement(el)
      if (!path) {
        return
      }
      const formState = getFieldsRef.current()
      const rowPath = rowPathOf(path, formState)
      const rowIDPath = rowPath ? toRowIDPath(rowPath, formState) : null
      if (rowIDPath !== selectionRef.current) {
        selectRef.current(rowIDPath, 'form')
      }

      // A whole Array/Blocks field ("Add block", its own label) has no one
      // place on the page to go to - better to stay put than to jump to
      // its first row.
      if (formState[path]?.rows) {
        return
      }

      postToPreview({ type: FOCUS_MESSAGE_TYPE, caret: caretHintFromSelection(el), path: toRowIDPath(path, formState) })
    }

    // A pointer places the caret only *after* moving focus, so a hint read
    // during `focusin` would still describe the field being left. The field
    // is remembered instead and sent from the click that completes the same
    // interaction, by which point the caret is where the user put it - one
    // message per interaction either way.
    let pointerActive = false
    let pendingPointerFocus: HTMLElement | null = null

    const handlePointerDown = () => {
      pointerActive = true
      pendingPointerFocus = null
    }

    const handlePointerUp = () => {
      pointerActive = false
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (engineRef.current.suppressFocusEcho || !(event.target instanceof HTMLElement)) {
        return
      }
      if (pointerActive) {
        pendingPointerFocus = event.target
        return
      }

      onFieldFocus(event.target)
    }

    // Also the only signal for a caret moved *within* the focused field:
    // clicking from one paragraph of a rich text to another fires no further
    // focus event, so the preview would stay pointed at the first one.
    const handleClick = (event: MouseEvent) => {
      const pending = pendingPointerFocus
      pointerActive = false
      pendingPointerFocus = null

      if (engineRef.current.suppressFocusEcho) {
        return
      }

      // The focused element owns the caret; the click target may be a label
      // or a wrapper that merely handed focus to it. Without focus (a click
      // on inert markup), there is nothing a `focusin` would have reported
      // either.
      const active = document.activeElement
      const el =
        pending ??
        (active instanceof HTMLElement && event.target instanceof Node && active.contains(event.target)
          ? active
          : null)

      if (el) {
        onFieldFocus(el)
      }
    }

    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('pointerdown', handlePointerDown, { capture: true })
    document.addEventListener('pointerup', handlePointerUp, { capture: true })
    document.addEventListener('click', handleClick, { capture: true })

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      document.removeEventListener('pointerup', handlePointerUp, { capture: true })
      document.removeEventListener('click', handleClick, { capture: true })
    }
  }, [postToPreview])

  /* ----------------------------------------------------------- focus mode */

  // What focus mode shows, kept true as Payload renders: the row once it
  // mounts, what the form adds beside it later.
  const isolationTarget = features.focusMode && focusMode ? focusRoot : null
  useEffect(() => {
    isolationRef.current = isolationTarget
    if (!features.focusMode) {
      return
    }
    const stop = watchDom(document.body, applyIsolation)
    return () => {
      stop()
      const root = editMainEl()
      if (root) {
        isolate(root, null)
      }
    }
  }, [applyIsolation, features.focusMode, isolationTarget, outline])

  const toggleFocusMode = () => {
    const next = !focusMode
    const root = next ? selection : null
    // Everything but one block goes, or everything comes back: always a change
    // worth a veil where the page jumps.
    const veil =
      selection && (scrollBehavior === 'instant' || veilRef.current.curtain) ? veilForm() : undefined
    setFocusModeChoice(next)
    setFocusRoot(root)
    // Applied now, under the veil, rather than on the next render.
    focusModeRef.current = next
    isolationRef.current = root
    applyIsolation()
    if (selection) {
      // Kept in view either way: narrowed to it, or with everything back around it.
      revealRef.current(selection, { focus: false, veil })
    }
  }

  const toggleOutline = () => setOutlineOpen(!outlineOpen)

  /* ------------------------------------------------------------- hosts */

  const showSplit = features.split && isLivePreviewing && previewWindowType === 'iframe' && (!stacked || features.stacked)
  const splitHost = useHost(
    HOST.split,
    () => {
      const wrapper = editMainWrapperEl()
      const preview = livePreviewWindowEl()
      return wrapper && preview && preview.parentElement === wrapper ? { before: preview, parent: wrapper } : null
    },
    showSplit,
  )
  const outlineHost = useHost(
    HOST.outline,
    () => {
      const wrapper = editMainWrapperEl()
      return wrapper ? { parent: wrapper } : null
    },
    features.outline && outlineOpen,
  )
  // Where the editor is - or, in focus mode with the cursor outside every row,
  // what focus mode shows.
  const pathTarget = selection ?? (focusMode ? focusRoot : null)
  const chain = useMemo(
    () => chainOf(pathTarget ? outline?.byRowIDPath.get(pathTarget) : null),
    [outline, pathTarget],
  )
  // Always there when anything in it is: the switches live in it.
  const showPathBar = features.pathBar || features.outline || features.focusMode
  const pathHost = useHost(
    HOST.pathBar,
    () => {
      const main = editMainEl()
      return main ? { parent: main } : null
    },
    showPathBar,
  )

  // A Payload the plugin does not know says so once, in the console, rather
  // than as pieces of the editor quietly not there.
  useEffect(() => {
    const timer = setTimeout(() => {
      const missing = missingLandmarks({ livePreview: isLivePreviewing && previewWindowType === 'iframe' }).filter(
        (name) => !reportedMissing.has(name),
      )
      if (missing.length === 0) {
        return
      }
      missing.forEach((name) => reportedMissing.add(name))
      // eslint-disable-next-line no-console -- what tells a site owner why the editor is incomplete
      console.warn(
        `[payload-live-preview-inspector] Not found in Payload's admin: ${missing.map((name) => `.${name}`).join(', ')}. ` +
          'This Payload version renders its edit view differently from the ones the plugin was tested with, and ' +
          'the parts of the editor that need these stay off - a newer version of the plugin should bring them back.',
      )
    }, LANDMARK_CHECK_MS)
    return () => clearTimeout(timer)
  }, [isLivePreviewing, previewWindowType])

  const previewToolsHost = useHost(
    HOST.previewTools,
    () => {
      const toolbar = livePreviewToolbarEl()
      return toolbar ? { parent: toolbar } : null
    },
    isLivePreviewing && previewWindowType === 'iframe',
  )

  /** "All fields": focus mode shows everything again, and the block the editor is at stays in view. */
  const showAllFields = () => {
    const veil = selection && (scrollBehavior === 'instant' || veilRef.current.curtain) ? veilForm() : undefined
    setFocusRoot(null)
    isolationRef.current = null
    applyIsolation()
    if (selection) {
      revealRef.current(selection, { focus: false, veil })
    }
  }

  /* -------------------------------------------------- adding a block below */

  const { closeModal, openModal } = useModal()
  const drawerSlug = `payload-live-preview-inspector-insert-${collectionSlug ?? globalSlug ?? 'doc'}`
  useEffect(() => {
    if (!insertBelow) {
      return
    }
    openModal(drawerSlug)
    // The "+" was clicked in the preview, so the keyboard is still in its
    // frame: typing would not reach the drawer's search, nor Escape close it.
    // Brought over to the search once the drawer has opened.
    let frame = 0
    let tries = 0
    //
    // After the drawer's own dialog has taken focus, which it does a frame or
    // two after opening: focused before that, the search lost it to the
    // dialog straight away (measured on krc, 2 ms apart).
    const focusSearch = () => {
      const search = document.querySelector<HTMLInputElement>(`${selectorOf(PAYLOAD_CLASS.drawerOpen)} input`)
      const dialogHasFocus = Boolean(search && document.activeElement?.contains(search))
      if (search && (dialogHasFocus || tries > 30)) {
        window.focus()
        search.focus()
        return
      }
      if (++tries < 120) {
        frame = requestAnimationFrame(focusSearch)
      }
    }
    frame = requestAnimationFrame(focusSearch)
    return () => cancelAnimationFrame(frame)
  }, [drawerSlug, insertBelow, openModal])

  const insertDrawer = insertBelow
    ? (() => {
        const filter = (getFieldsRef.current()[splitRowPath(insertBelow.path)?.fieldPath ?? ''] as
          | { blocksFilterOptions?: unknown }
          | undefined)?.blocksFilterOptions
        const all = (insertBelow.field.blockReferences ?? insertBelow.field.blocks ?? []) as (
          | { slug: string }
          | string
        )[]
        const allowed = Array.isArray(filter)
          ? all.filter((block) => filter.includes(typeof block === 'string' ? block : block.slug))
          : all
        return (
          <BlocksDrawer
            addRow={async (_index, blockType) => {
              const path = insertBelow.path
              setInsertBelow(null)
              closeModal(drawerSlug)
              const before = rowIDsAround(path)
              const added = insertRowBelow(formAPI(), path, blockType)
              if (added) {
                const addedID = await waitForNewRow(added.path, before)
                if (addedID) {
                  await selectNewRow(addedID)
                }
              }
            }}
            addRowIndex={(splitRowPath(insertBelow.path)?.index ?? 0) + 1}
            blocks={allowed as never}
            drawerSlug={drawerSlug}
            labels={(insertBelow.field.labels ?? { plural: 'Blocks', singular: 'Block' }) as never}
          />
        )
      })()
    : null

  /* ----------------------------------------------------------------- render */

  const styles = useMemo(
    () => editorStyles({ mobile: features.stacked, split: features.split }),
    [features.stacked, features.split],
  )

  const modifier = previewSettings?.interactionModifier ?? ''
  const modifierLabel = Object.hasOwn(MODIFIER_LABELS, modifier) ? MODIFIER_LABELS[modifier] : undefined
  const hintSentence = `${strings.hint}${modifierLabel ? strings.hintModifier(modifierLabel) : ''}`
  const status = notFoundNotice
    ? { text: strings.notFound, tone: 'notice' as const }
    : revealLabel
      ? { text: `→ ${revealLabel}`, tone: 'active' as const }
      : undefined

  return (
    <div className={editorClasses.root} data-payload-live-preview-inspector-toolbar="">
      <style>{styles}</style>
      <FormWatcher onChange={onFormChange} />
      {previewToolsHost &&
        createPortal(
          <PreviewTools
            hint={hintSentence}
            language={language}
            status={status}
            strings={strings}
            viewports={stacked ? [] : features.viewports}
          />,
          previewToolsHost,
        )}
      {splitHost &&
        createPortal(
          <SplitHandle
            getWrapper={editMainWrapperEl}
            outlineOpen={Boolean(outlineHost)}
            stacked={stacked}
            strings={strings}
          />,
          splitHost,
        )}
      {outlineHost &&
        createPortal(
          <OutlinePanel
            activePath={selection}
            focusRootPath={focusMode ? focusRoot : null}
            onClose={toggleOutline}
            onHover={(node) => {
              if (features.blockToolbar) {
                postToPreview({ type: HOVER_MESSAGE_TYPE, path: node?.rowIDPath ?? null })
              }
            }}
            onSelect={(node: OutlineNode) => {
              select(node.rowIDPath, 'outline', { reveal: true })
              if (stacked) {
                toggleOutline()
              }
            }}
            outline={outline}
            strings={strings}
          />,
          outlineHost,
        )}
      {pathHost &&
        createPortal(
          <PathBar
            chain={chain}
            focusMode={focusMode}
            focusRootPath={focusMode ? focusRoot : null}
            onSelect={(node) => {
              if (!node) {
                if (focusMode && focusRoot) {
                  showAllFields()
                }
                return
              }
              select(node.rowIDPath, 'path', { reveal: true })
            }}
            onToggleFocus={features.focusMode ? toggleFocusMode : undefined}
            onToggleOutline={features.outline ? toggleOutline : undefined}
            outlineOpen={outlineOpen}
            showPath={features.pathBar}
            strings={strings}
          />,
          pathHost,
        )}
      {insertDrawer}
    </div>
  )
}

/**
 * The one part that re-renders on every change to the form - and renders
 * nothing. `useAllFormFields()` re-renders whoever calls it on each keystroke
 * anywhere in the form; here that costs nothing, where in the editor above it
 * would re-render the outline, the path bar and the toolbar with it.
 */
const FormWatcher: React.FC<{ onChange: () => void }> = ({ onChange }) => {
  const [fields] = useAllFormFields()
  useEffect(() => {
    onChange()
  }, [fields, onChange])
  return null
}
