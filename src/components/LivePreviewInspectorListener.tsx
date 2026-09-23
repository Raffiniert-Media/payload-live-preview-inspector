'use client'

import {
  useAllFormFields,
  useConfig,
  useDocumentInfo,
  useForm,
  useLivePreviewContext,
  useTranslation,
} from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'

import type { RevealStatus } from '../utilities/messageTypes.js'
import type { DocumentLeafValue } from '../utilities/pathResolution.js'
import type { BlocksMap, SchemaField } from '../utilities/revealPlan.js'

import { caretHintFromSelection, parseCaretHint } from '../utilities/caret.js'
import {
  CLICK_MESSAGE_TYPE,
  DOCUMENT_VALUES_MESSAGE_TYPE,
  FOCUS_MESSAGE_TYPE,
  REQUEST_DOCUMENT_VALUES_MESSAGE_TYPE,
  REVEAL_STATUS_MESSAGE_TYPE,
  SETTINGS_MESSAGE_TYPE,
  THEME_MESSAGE_TYPE,
} from '../utilities/messageTypes.js'
import {
  collectLeafValues,
  DEFAULT_COLLAPSIBLE_ANIMATION_MS,
  DEFAULT_TAB_SWITCH_WAIT_MS,
  expandCollapsedAncestors,
  fieldPathFromFormState,
  focusElement,
  IDLE_GIVE_UP_MS,
  pathFromFieldElement,
  resolvedPathDepth,
  resolveExactFieldElement,
  resolveFieldElement,
  resolveRowIDs,
  revealTabForElement,
  rowIDFromPath,
  scrollToElement,
  flashElement as sharedFlashElement,
  toRowIDPath,
  waitForElement,
  waitForElementLayout,
} from '../utilities/pathResolution.js'
import {
  describeTarget,
  findTabsElement,
  labelOfTarget,
  planReveal,
  TAB_BUTTON_ACTIVE_CLASS,
  tabButtonsOf,
} from '../utilities/revealPlan.js'
import { createRevealTimer } from '../utilities/revealTimer.js'
import classes from './LivePreviewInspectorListener.module.css'

export type LivePreviewInspectorListenerProps = {
  /** Maximum wait (ms) for a just-expanded accordion to render its content before scrolling. Defaults to 350. */
  accordionAnimationMs?: number
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

/**
 * How to name the modifier key to an editor.
 *
 * Both spellings, because the hint is read on the machine it applies to and
 * neither name alone is recognisable on both: a Mac keyboard says `⌥`, a PC
 * keyboard says `Alt`. `'none'` is absent on purpose - it maps to no label, and
 * the hint then leaves the sentence out rather than promising a key that does
 * nothing.
 */
/** Quiet time after the last form change before new values go to the preview. */
const VALUES_PUSH_DEBOUNCE_MS = 200
/** How long the hint says a click found no field. */
const NOT_FOUND_NOTICE_MS = 3_000

/** Payload's accent colour, resolved in the admin's current light/dark theme. */
const accentColor = (): string =>
  getComputedStyle(document.documentElement).getPropertyValue('--theme-success-500').trim()

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

const MODIFIER_LABELS: Record<string, string | undefined> = {
  alt: '⌥ (Alt)',
  ctrl: '⌃ (Ctrl)',
  meta: '⌘ (Cmd)',
  shift: '⇧ (Shift)',
}

export const LivePreviewInspectorListener: React.FC<LivePreviewInspectorListenerProps> = ({
  accordionAnimationMs = DEFAULT_COLLAPSIBLE_ANIMATION_MS,
  flashColor,
  flashDurationMs,
  scrollBehavior = 'smooth',
  scrollOffset,
  tabSwitchWaitMs = DEFAULT_TAB_SWITCH_WAIT_MS,
}) => {
  const { iframeRef, isLivePreviewing, loadedURL, url } = useLivePreviewContext()

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
  const [previewSettings, setPreviewSettings] = useState<
    { interactionModifier: string } | undefined
  >(undefined)
  const activeURL = loadedURL || url
  const [notFoundNotice, setNotFoundNotice] = useState(false)
  // Where the current reveal is going, for the hint - named the way the form
  // names it.
  const [revealLabel, setRevealLabel] = useState<string | undefined>(undefined)
  const { i18n } = useTranslation()
  const languageRef = useRef(i18n.language)
  languageRef.current = i18n.language

  /*
   * Where document values go once the preview has asked for them. The
   * preview used to ask again after every render batch - i.e. every
   * keystroke - and got the whole form serialised each time; now the admin
   * sends a snapshot when the values actually changed, and only then.
   */
  const valuesChannelRef = useRef<{ lastSignature: string; post: (leaves: DocumentLeafValue[]) => void } | null>(
    null,
  )

  // `useForm().getFields` is an imperative getter that reads the current form
  // state on demand, unlike `useAllFormFields()`, which re-renders this
  // component on every keystroke anywhere in the form. We only need the
  // freshest state at click time, so a ref (rather than an effect dependency)
  // is enough to always call the latest version without re-subscribing.
  const { dispatchFields, getFields } = useForm()
  // Subscribed only to learn *that* the form changed, for the values push
  // below. This re-renders the listener on every change, which is cheap -
  // it renders one line of text - and everything it reads goes through
  // `getFields` at the time it is needed.
  const [formFields] = useAllFormFields()
  const getFieldsRef = useRef(getFields)
  getFieldsRef.current = getFields
  const dispatchFieldsRef = useRef(dispatchFields)
  dispatchFieldsRef.current = dispatchFields

  // The edited document's field config: it knows which tab holds a field and
  // which rows sit on the way to it, so a reveal can go straight there
  // instead of clicking through tabs to find out.
  const { collectionSlug, globalSlug } = useDocumentInfo()
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
    let suppressFocusEcho = false
    let echoTimer: ReturnType<typeof setTimeout> | undefined

    let noticeTimer: ReturnType<typeof setTimeout> | undefined
    let labelTimer: ReturnType<typeof setTimeout> | undefined
    const showNotFound = () => {
      clearTimeout(noticeTimer)
      setNotFoundNotice(true)
      noticeTimer = setTimeout(() => setNotFoundNotice(false), NOT_FOUND_NOTICE_MS)
    }

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
        // A preview just loaded: give it the admin's colours.
        ;(event.source as Window).postMessage({ type: THEME_MESSAGE_TYPE, accent: accentColor() }, expectedOrigin)
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
        return
      }

      if (data.type !== CLICK_MESSAGE_TYPE || typeof data.path !== 'string') {
        return
      }

      // Older clients send no id and get no status.
      const clickID: unknown = data.id
      const sendStatus = (status: RevealStatus, label?: string) => {
        if (typeof clickID === 'number') {
          iframeRef.current?.contentWindow?.postMessage(
            { id: clickID, type: REVEAL_STATUS_MESSAGE_TYPE, label, status },
            expectedOrigin,
          )
        }
      }

      const caret = parseCaretHint(data.caret)
      const formState = getFieldsRef.current()
      const resolvedPath = resolveRowIDs(data.path, formState)
      const schema = schemaRef.current

      // Answered before anything moves - the preview marks the click the
      // moment it happens and names where it's going from this reply.
      const target = resolvedPath && schema ? describeTarget(schema.fields, resolvedPath, formState, schema.blocksMap) : null
      const label = target ? labelOfTarget(target, languageRef.current) : undefined
      sendStatus('started', label)
      clearTimeout(labelTimer)
      setRevealLabel(label)

      if (!resolvedPath) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console -- intentional dev-only diagnostic
          console.warn(`[payload-live-preview-inspector] Could not resolve a row id in path "${data.path}"`)
        }
        sendStatus('not-found')
        showNotFound()
        return
      }

      revealController?.abort()
      const controller = new AbortController()
      revealController = controller
      const { signal } = controller
      const timer = createRevealTimer(resolvedPath)

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
          checkExact() ??
          (resolvedPathDepth(resolvedPath) > depth ? resolveFieldElement(resolvedPath) : null)

        const totalDepth = resolvedPath.split('.').length

        // Phase 1: the plan. The field config says which tabs have to be
        // active and which rows expanded on the way to the target, so none of
        // it has to be found out by trying.
        const plan = schema ? planReveal(schema.fields, resolvedPath, formState, schema.blocksMap) : null
        let planApplied = false
        const depthBeforePlan = resolvedPathDepth(resolvedPath)

        // Move at once when the route stays in view: every tab on the way is
        // already active and every collapsible open, so all that is left is
        // expanding rows - and the page can glide toward the deepest part of
        // the path that is rendered while that happens, bending onto the
        // target as it mounts. Waiting for the expansion first is the pause
        // between click and motion that made reveals feel hesitant.
        // (Heading anywhere while a tab is still to be switched would aim at
        // content about to be replaced.)
        let glide: Promise<void> | undefined
        const routeInView =
          plan &&
          schema &&
          plan.steps.every((step) => {
            if (step.kind === 'row') {
              return true
            }
            if (step.kind === 'collapsible') {
              const collapsible = document.getElementById(step.id)?.querySelector('.collapsible')
              return Boolean(collapsible) && !collapsible?.classList.contains('collapsible--collapsed')
            }
            const tabsEl = findTabsElement(step, schema.fields, formState, schema.blocksMap)
            return Boolean(tabsEl && tabButtonsOf(tabsEl)[step.index]?.classList.contains(TAB_BUTTON_ACTIVE_CLASS))
          })
        if (routeInView && resolveFieldElement(resolvedPath)) {
          glide = scrollToElement(
            () => checkExact() ?? resolveFieldElement(resolvedPath),
            scrollOffset,
            scrollBehavior,
            signal,
            true,
          )
        }

        if (plan && schema && !checkExact()) {
          // Every collapsed row on the way, in one go and through the form
          // state that owns the flag - not one toggle click per level, each
          // waiting for the last to render. Rows that aren't mounted yet (in
          // another tab, below the fold) take the flag just the same and
          // render expanded when they do.
          let expanded = false
          for (const step of plan.steps) {
            if (step.kind !== 'row') {
              continue
            }
            const rows = getFieldsRef.current()[step.path]?.rows
            if (!rows?.[step.index]?.collapsed) {
              continue
            }
            dispatchFieldsRef.current({
              type: 'SET_ROW_COLLAPSED',
              path: step.path,
              updatedRows: rows.map((row, index) => (index === step.index ? { ...row, collapsed: false } : row)),
            })
            expanded = true
          }

          if (expanded) {
            // Let React commit the expansion before anything reads the DOM:
            // a row still *rendered* collapsed would look like a toggle to
            // click to the accordion fallback below, which would then close
            // what was just opened.
            await nextFrames(2)
            if (signal.aborted) {
              return 'not-found'
            }
            for (const step of plan.steps) {
              if (step.kind === 'row') {
                pulse(
                  document
                    .getElementById(rowIDFromPath(`${step.path}.${step.index}`) ?? '')
                    ?.querySelector('.collapsible__toggle-wrap'),
                )
              }
            }
          }

          // Tabs and collapsibles from the outside in: an inner one only
          // exists once the outer one holding it is open. Only after
          // something changed can the next one still be mounting, so only
          // then is it waited for.
          planApplied = plan.complete
          let clicked = expanded

          for (const step of plan.steps) {
            if (step.kind === 'row') {
              continue
            }

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
              const collapsible = collapsibleEl.querySelector<HTMLElement>('.collapsible')
              if (collapsible?.classList.contains('collapsible--collapsed')) {
                pulse(collapsible.querySelector(':scope > .collapsible__toggle-wrap'))
                collapsible
                  .querySelector<HTMLButtonElement>(':scope > .collapsible__toggle-wrap > .collapsible__toggle')
                  ?.click()
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
              pulse(button)
              button.click()
              clicked = true
            }
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
          timer.phase('plan')
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

          // Aimed at the deepest part of the path that is rendered *on each
          // frame*: the target mounts during this very scroll as soon as it
          // comes within Payload's render margin of the viewport, and the
          // motion then bends toward it instead of finishing the trip to an
          // ancestor and starting a second one from there.
          const ancestorEl = el
          if (glide) {
            // Already under way since the click - let it finish.
            await glide
            glide = undefined
          } else {
            await scrollToElement(
              () => checkExact() ?? resolveFieldElement(resolvedPath) ?? ancestorEl,
              scrollOffset,
              scrollBehavior,
              signal,
            )
          }
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

        sharedFlashElement(el, { className: classes.flash, color: flashColor, durationMs: flashDurationMs })

        // Cleared on a macrotask rather than right after the call: `focusin`
        // itself is synchronous, but an editor settling the selection we just
        // set (Lexical does) can move focus again in a microtask. Real user
        // focus cannot land inside that window, so nothing legitimate is lost.
        suppressFocusEcho = true
        const caretEl = focusElement(el, caret)
        echoTimer = setTimeout(() => {
          suppressFocusEcho = false
        })

        // The scroll above put the *field* at `scrollOffset`; in a long rich
        // text the clicked position can still be far below the fold, so bring
        // the caret itself into view - but only when it actually is off
        // screen, since `scrollToElement` otherwise re-centers a field the
        // user can already see.
        if (caretEl) {
          const { bottom, top } = caretEl.getBoundingClientRect()
          if (top < 0 || bottom > window.innerHeight) {
            await scrollToElement(caretEl, scrollOffset, scrollBehavior, signal)
          }
        }
        timer.phase('focus')

        return el === checkExact() ? 'exact' : 'ancestor'
      }

      void revealField().then((outcome) => {
        timer.end(signal.aborted ? 'aborted' : outcome)
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

    // Reverse direction: focusing a field in the admin form scrolls to and
    // flashes the matching element in the preview, the same way a click
    // there reveals the field here.
    const sendFocus = (el: HTMLElement) => {
      const path = pathFromFieldElement(el)
      if (!path) {
        return
      }

      const rowIDPath = toRowIDPath(path, getFieldsRef.current())
      iframeRef.current?.contentWindow?.postMessage(
        { type: FOCUS_MESSAGE_TYPE, caret: caretHintFromSelection(el), path: rowIDPath },
        expectedOrigin,
      )
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
      if (suppressFocusEcho || !(event.target instanceof HTMLElement)) {
        return
      }
      if (pointerActive) {
        pendingPointerFocus = event.target
        return
      }

      sendFocus(event.target)
    }

    // Also the only signal for a caret moved *within* the focused field:
    // clicking from one paragraph of a rich text to another fires no further
    // focus event, so the preview would stay pointed at the first one.
    const handleClick = (event: MouseEvent) => {
      const pending = pendingPointerFocus
      pointerActive = false
      pendingPointerFocus = null

      if (suppressFocusEcho) {
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
        sendFocus(el)
      }
    }

    window.addEventListener('message', handleMessage)
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('pointerdown', handlePointerDown, { capture: true })
    document.addEventListener('pointerup', handlePointerUp, { capture: true })
    document.addEventListener('click', handleClick, { capture: true })

    return () => {
      window.removeEventListener('message', handleMessage)
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      document.removeEventListener('pointerup', handlePointerUp, { capture: true })
      document.removeEventListener('click', handleClick, { capture: true })
      clearTimeout(echoTimer)
      clearTimeout(noticeTimer)
      clearTimeout(labelTimer)
      revealController?.abort()
      valuesChannelRef.current = null
    }
  }, [
    iframeRef,
    activeURL,
    accordionAnimationMs,
    flashColor,
    flashDurationMs,
    scrollBehavior,
    scrollOffset,
    tabSwitchWaitMs,
  ])

  // Push new document values to the preview once the form has been still
  // for a moment - and only when they actually differ from the last push
  // (a change to a number or a checkbox leaves every string alone).
  useEffect(() => {
    const timer = setTimeout(() => {
      const channel = valuesChannelRef.current
      if (!channel) {
        return
      }
      const leaves = collectLeafValues(getFieldsRef.current())
      const signature = signatureOf(leaves)
      if (signature !== channel.lastSignature) {
        channel.lastSignature = signature
        channel.post(leaves)
      }
    }, VALUES_PUSH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [formFields])

  if (!isLivePreviewing) {
    return null
  }

  if (notFoundNotice) {
    return (
      <div className={classes.hint} role="status">
        That element’s field isn’t in this form (a removed row, or a field only editable in a drawer)
      </div>
    )
  }

  const modifierLabel = MODIFIER_LABELS[previewSettings?.interactionModifier ?? '']

  if (revealLabel) {
    return (
      <div className={`${classes.hint} ${classes.hintActive}`} role="status">
        → {revealLabel}
      </div>
    )
  }

  return (
    <div className={classes.hint}>
      Click an element in the Live Preview to jump to its field
      {modifierLabel ? ` — hold ${modifierLabel} to use the page instead` : ''}
    </div>
  )
}
