import type { PreviewStrings } from './i18n.js'
import type { PreviewRow } from './structure.js'

import { LIVE_PREVIEW_PATH_ATTRIBUTE } from './pathAttribute.js'

/** Class names the toolbar's parts take, from the client's CSS module. */
export type BlockToolbarClasses = {
  frame: string
  hoverFrame: string
  label: string
  layer: string
  toolbar: string
  toolbarButton: string
  toolbarSeparator: string
}

/** What a toolbar button asks the admin to do; see `RowAction` on the admin's side. */
export type BlockToolbarAction = 'down' | 'duplicate' | 'edit' | 'insert' | 'remove' | 'select' | 'up'

export type BlockToolbar = {
  destroy: () => void
  /** The row the admin's outline points at, marked without moving the page. */
  hover: (path: null | string) => void
  /** Whether `target` is part of the toolbar - a click there is the toolbar's, not the page's. */
  owns: (target: EventTarget | null) => boolean
  /** The row the editor is at, framed with the toolbar on it. */
  select: (path: null | string) => void
  /** The document's rows and the words to use, from the admin. */
  setStructure: (rows: PreviewRow[], strings: PreviewStrings) => void
}

/** Attribute the toolbar's layer is found by - tests, and anyone restyling it. */
export const BLOCK_TOOLBAR_ATTRIBUTE = 'data-payload-live-preview-inspector-block-toolbar'

/** Room kept between the toolbar and the edge of whatever it would otherwise touch. */
const GAP_PX = 6

const escape = (value: string): string =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&')

/**
 * Where a row is on the page: the element tagged with its path, or - when no
 * single element is - the box around everything tagged inside it.
 */
export const rowRectOf = (doc: Document, path: string): DOMRect | null => {
  const own = doc.querySelector<HTMLElement>(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}="${escape(path)}"]`)
  if (own) {
    return own.getBoundingClientRect()
  }
  const inside = doc.querySelectorAll<HTMLElement>(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}^="${escape(`${path}.`)}"]`)
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const el of Array.from(inside)) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      continue
    }
    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    right = Math.max(right, rect.right)
    bottom = Math.max(bottom, rect.bottom)
  }
  return Number.isFinite(left) ? new DOMRect(left, top, right - left, bottom - top) : null
}

/**
 * Where the toolbar goes for a row at `rect`: above its top-left corner; below
 * it when there is no room above (the page's sticky header is there) and the
 * row is short enough to be covered by the toolbar - a heading, a button row;
 * inside its top otherwise. Kept on screen, and below anything fixed at the
 * top of the page (`topInset`).
 */
export const toolbarPosition = (
  rect: { bottom: number; left: number; top: number },
  size: { height: number; width: number },
  viewport: { height: number; width: number },
  topInset = 0,
): { left: number; top: number } => {
  const floor = topInset + GAP_PX
  const ceiling = viewport.height - size.height - GAP_PX
  const above = rect.top - size.height - GAP_PX
  const below = rect.bottom + GAP_PX
  // Inside, the toolbar would hide most of a row not much taller than itself.
  const short = rect.bottom - rect.top < size.height * 3
  const top =
    above >= floor
      ? above
      : short && below >= floor && below <= ceiling
        ? below
        : Math.max(floor, Math.min(rect.top + GAP_PX, rect.bottom - size.height - GAP_PX))
  const left = Math.max(GAP_PX, Math.min(rect.left, viewport.width - size.width - GAP_PX))
  return { left, top: Math.min(top, ceiling) }
}

/**
 * How far down the page's own fixed and sticky bars reach at `x` - its sticky
 * header - so the toolbar can sit below them instead of over them. The
 * toolbar's own layer does not count.
 */
export const pageTopInset = (doc: Document, x: number, own: Element): number => {
  const view = doc.defaultView
  if (!view || typeof doc.elementsFromPoint !== 'function') {
    return 0
  }
  let inset = 0
  for (let bar = 0; bar < 3; bar++) {
    const painted = doc.elementsFromPoint(x, inset + 1).find((el) => !own.contains(el))
    let bottom = 0
    for (let node: Element | null = painted ?? null; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
      const { position } = view.getComputedStyle(node)
      if (position === 'fixed' || position === 'sticky') {
        const box = node.getBoundingClientRect()
        // A backdrop reaching the bottom covers everything; it is not a bar.
        if (box.bottom < view.innerHeight * 0.5) {
          bottom = box.bottom
        }
        break
      }
    }
    if (bottom <= inset) {
      break
    }
    inset = bottom
  }
  return inset
}

/** How often the page's bars are measured again while the toolbar shows. */
const INSET_EVERY_MS = 250

/** Frames without anything moving before the toolbar stops following every frame. */
const STILL_FRAMES = 30
/** How often a toolbar at rest looks again. */
const RESTING_CHECK_MS = 200

const ICONS: Record<Exclude<BlockToolbarAction, 'edit'>, string> = {
  down: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  duplicate: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
  insert: '<path d="M8 3v10M3 8h10"/>',
  remove: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/>',
  select: '<path d="M5 7l3-3 3 3M8 4v9"/><path d="M3 2.5h10"/>',
  up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
}

const icon = (action: Exclude<BlockToolbarAction, 'edit'>): string =>
  `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[action]}</svg>`

/**
 * The selected block in the preview: a frame around it and a toolbar on it -
 * move it, duplicate it, add one below, remove it, or step out to the block
 * around it - and a mark for the row the admin's outline points at.
 *
 * Drawn in a layer of its own over the page, like the click mark: the page's
 * markup is never touched, so the page's CSS cannot reach the toolbar and the
 * page's reconciliation cannot break on it. The toolbar does nothing itself -
 * every button is a message to the admin, which owns the form - and what the
 * buttons may do comes from there too, row by row.
 */
export const createBlockToolbar = (
  doc: Document,
  classes: BlockToolbarClasses,
  { onAction }: { onAction: (action: BlockToolbarAction, path: string) => void },
): BlockToolbar => {
  const rows = new Map<string, PreviewRow>()
  let inset = 0
  let insetMeasuredAt = 0
  let strings: null | PreviewStrings = null
  let selected: null | string = null
  let hovered: null | string = null
  let frame = 0
  // Following at rest - see `follow`.
  let lastPlaced = ''
  let stillFor = 0
  let resting = 0

  const layer = doc.createElement('div')
  layer.className = classes.layer
  layer.setAttribute(BLOCK_TOOLBAR_ATTRIBUTE, '')
  const selection = doc.createElement('div')
  selection.className = classes.frame
  const hover = doc.createElement('div')
  hover.className = classes.hoverFrame
  const toolbar = doc.createElement('div')
  toolbar.className = classes.toolbar
  toolbar.setAttribute('role', 'toolbar')
  // Nothing shows until there is something to frame.
  for (const part of [hover, selection, toolbar]) {
    part.style.display = 'none'
  }
  layer.append(hover, selection, toolbar)

  const attach = () => {
    if (!layer.isConnected) {
      doc.body.append(layer)
    }
  }

  const place = (box: HTMLElement, rect: DOMRect | null) => {
    // `display`, not `hidden`: a class that sets `display` beats the attribute.
    if (!rect) {
      box.style.display = 'none'
      return
    }
    box.style.removeProperty('display')
    box.style.transform = `translate(${rect.left}px, ${rect.top}px)`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
  }

  /*
   * Every frame while anything moves - a scroll, a row opening - and, once
   * nothing has for a while, a look a few times a second that changes
   * nothing unless something did: a toolbar re-placed every frame on a page
   * at rest kept the editor's machine from ever idling. What moves a row
   * without an event (an image loading above it, a carousel) is still caught.
   */
  const follow = () => {
    frame = 0
    const view = doc.defaultView
    if (!view) {
      return
    }
    const selectedRect = selected ? rowRectOf(doc, selected) : null
    const hoverRect = hovered && hovered !== selected ? rowRectOf(doc, hovered) : null
    const placed = [selectedRect, hoverRect]
      .map((rect) => (rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : '-'))
      .concat(String(view.innerWidth), String(view.innerHeight))
      .join('|')
    const wasResting = stillFor >= STILL_FRAMES
    stillFor = placed === lastPlaced ? stillFor + 1 : 0
    lastPlaced = placed

    if (!wasResting || stillFor === 0) {
      place(selection, selectedRect)
      place(hover, hoverRect)

      const showToolbar = Boolean(selectedRect && selected && rows.has(selected) && strings)
      if (showToolbar) {
        toolbar.style.removeProperty('display')
      } else {
        toolbar.style.display = 'none'
      }
      if (showToolbar && selectedRect) {
        const now = Date.now()
        if (now - insetMeasuredAt > INSET_EVERY_MS) {
          insetMeasuredAt = now
          inset = pageTopInset(doc, Math.max(0, Math.min(view.innerWidth - 1, selectedRect.left + 8)), layer)
        }
        const { left, top } = toolbarPosition(
          selectedRect,
          { height: toolbar.offsetHeight, width: toolbar.offsetWidth },
          { height: view.innerHeight, width: view.innerWidth },
          inset,
        )
        toolbar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
      }
    }

    if (!selected && !hovered) {
      return
    }
    if (stillFor < STILL_FRAMES) {
      frame = view.requestAnimationFrame(follow)
    } else {
      resting = view.setTimeout(() => {
        resting = 0
        frame = view.requestAnimationFrame(follow)
      }, RESTING_CHECK_MS)
    }
  }

  /** Back to following every frame. */
  const wake = () => {
    const view = doc.defaultView ?? window
    stillFor = 0
    if (resting) {
      view.clearTimeout(resting)
      resting = 0
    }
    if (!frame) {
      frame = view.requestAnimationFrame(follow)
    }
  }

  const schedule = () => {
    attach()
    wake()
  }

  // A scroll or a resized window moves every row at once - and from rest, it
  // should not wait for the next look.
  const view = doc.defaultView ?? window
  const onViewChange = () => {
    if (selected || hovered) {
      wake()
    }
  }
  view.addEventListener('scroll', onViewChange, { capture: true, passive: true })
  view.addEventListener('resize', onViewChange, { passive: true })

  const button = (action: BlockToolbarAction, title: string, enabled: boolean, content: string) => {
    const el = doc.createElement('button')
    el.type = 'button'
    el.className = classes.toolbarButton
    el.dataset.action = action
    el.title = title
    el.setAttribute('aria-label', title)
    el.disabled = !enabled
    el.innerHTML = content
    return el
  }

  const render = () => {
    toolbar.replaceChildren()
    const row = selected ? rows.get(selected) : undefined
    if (!row || !strings) {
      return
    }
    toolbar.setAttribute('aria-label', row.label)
    const label = button('edit', strings.editHere, true, '')
    label.classList.add(classes.label)
    label.textContent = row.label
    if (row.summary) {
      label.title = `${row.label} · ${row.summary}`
    }
    const separator = () => {
      const el = doc.createElement('span')
      el.className = classes.toolbarSeparator
      return el
    }
    const { abilities } = row
    toolbar.append(
      label,
      ...(row.parent ? [button('select', strings.selectParent, true, icon('select'))] : []),
      separator(),
      button('up', strings.moveUp, abilities.move && row.index > 0, icon('up')),
      button('down', strings.moveDown, abilities.move && row.index < row.count - 1, icon('down')),
      button('duplicate', strings.duplicate, abilities.duplicate, icon('duplicate')),
      button('insert', strings.addBelow, abilities.insert, icon('insert')),
      separator(),
      button('remove', strings.remove, abilities.remove, icon('remove')),
    )
  }

  const onToolbarClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const target = (event.target as Element | null)?.closest?.('button[data-action]') as HTMLButtonElement | null
    if (!target || target.disabled || !selected) {
      return
    }
    const action = target.dataset.action as BlockToolbarAction
    const row = rows.get(selected)
    if (action === 'select' && row?.parent) {
      api.select(row.parent)
      onAction('select', row.parent)
      return
    }
    onAction(action, selected)
  }
  toolbar.addEventListener('click', onToolbarClick)
  // The page must not see the toolbar's pointer at all - no hover state
  // underneath, no drag starting on a carousel below it.
  const stop = (event: Event) => event.stopPropagation()
  for (const type of ['mousedown', 'pointerdown', 'touchstart']) {
    toolbar.addEventListener(type, stop)
  }

  const api: BlockToolbar = {
    destroy: () => {
      view.cancelAnimationFrame(frame)
      view.clearTimeout(resting)
      frame = 0
      resting = 0
      view.removeEventListener('scroll', onViewChange, { capture: true })
      view.removeEventListener('resize', onViewChange)
      toolbar.removeEventListener('click', onToolbarClick)
      layer.remove()
    },
    hover: (path) => {
      hovered = path
      schedule()
    },
    owns: (target) => target instanceof Node && layer.contains(target),
    select: (path) => {
      if (path === selected) {
        return
      }
      selected = path
      render()
      schedule()
    },
    setStructure: (next, nextStrings) => {
      rows.clear()
      for (const row of next) {
        rows.set(row.path, row)
      }
      strings = nextStrings
      render()
      schedule()
    },
  }

  return api
}
