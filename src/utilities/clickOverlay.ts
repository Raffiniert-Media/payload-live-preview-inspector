/** Class names the overlay's parts take, from the client's CSS module. */
export type ClickOverlayClasses = {
  box: string
  chip: string
  clip: string
  layer: string
  ripple: string
}

export type ClickOverlay = {
  /** The admin answered: fade out, or say there was nothing to go to. */
  finish: (outcome: 'done' | 'not-found') => void
  /** Drops the mark at once - a newer click, an unmount. */
  hide: () => void
  /** Names where the click is going. */
  setLabel: (label: string) => void
  /** Marks `el` as clicked, with a ripple from the click point. */
  show: (el: HTMLElement, point: { x: number; y: number }) => void
}

/** Attribute the layer is found by (tests, and anyone restyling it). */
export const OVERLAY_ATTRIBUTE = 'data-payload-live-preview-inspector-overlay'

/** How long the finished mark lingers before it has faded. */
const FINISH_MS = { done: 1_100, 'not-found': 1_400 }

/**
 * The instant answer to a click in the preview: the element is framed and
 * tinted, a ripple spreads from where the pointer went down, and a chip names
 * the field the admin is heading for - all within the frame the click
 * happened in, long before the admin has moved.
 *
 * Drawn in a layer of its own over the page rather than onto the clicked
 * element: styling the host's markup would fight its own CSS, and adding
 * children to elements React renders is how a page's reconciliation breaks.
 * The frame follows the element on every frame while it shows, since the
 * page may scroll or reflow underneath it.
 */
export const createClickOverlay = (doc: Document, classes: ClickOverlayClasses): ClickOverlay => {
  let layer: HTMLDivElement | undefined
  let box: HTMLDivElement | undefined
  let chip: HTMLDivElement | undefined
  let clip: HTMLDivElement | undefined
  let target: HTMLElement | undefined
  let frame = 0
  let finishTimer: ReturnType<typeof setTimeout> | undefined

  const ensureLayer = (): HTMLDivElement => {
    if (!layer || !layer.isConnected) {
      layer = doc.createElement('div')
      layer.className = classes.layer
      layer.setAttribute(OVERLAY_ATTRIBUTE, '')
      layer.setAttribute('aria-hidden', 'true')
      doc.body.append(layer)
    }
    return layer
  }

  const follow = () => {
    if (!target || !box) {
      return
    }
    const rect = target.getBoundingClientRect()
    box.style.transform = `translate(${rect.left}px, ${rect.top}px)`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
    // Keep the chip readable when the element starts right at the top.
    box.dataset.chipInside = rect.top < 24 ? 'true' : 'false'
    frame = requestAnimationFrame(follow)
  }

  const hide = () => {
    cancelAnimationFrame(frame)
    clearTimeout(finishTimer)
    box?.remove()
    box = undefined
    chip = undefined
    clip = undefined
    target = undefined
  }

  return {
    finish: (outcome) => {
      if (!box) {
        return
      }
      box.dataset.state = outcome
      clearTimeout(finishTimer)
      finishTimer = setTimeout(hide, FINISH_MS[outcome])
    },
    hide,
    setLabel: (label) => {
      if (!chip || !label) {
        return
      }
      chip.textContent = label
      chip.dataset.visible = 'true'
    },
    show: (el, point) => {
      hide()
      const root = ensureLayer()
      target = el

      box = doc.createElement('div')
      box.className = classes.box
      box.dataset.state = 'pending'

      clip = doc.createElement('div')
      clip.className = classes.clip
      chip = doc.createElement('div')
      chip.className = classes.chip
      box.append(clip, chip)
      root.append(box)
      follow()

      const rect = el.getBoundingClientRect()
      const ripple = doc.createElement('span')
      ripple.className = classes.ripple
      // Big enough to reach the element's farthest corner from the click.
      const radius = Math.hypot(
        Math.max(point.x - rect.left, rect.right - point.x),
        Math.max(point.y - rect.top, rect.bottom - point.y),
      )
      ripple.style.left = `${point.x - rect.left - radius}px`
      ripple.style.top = `${point.y - rect.top - radius}px`
      ripple.style.width = ripple.style.height = `${radius * 2}px`
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
      clip.append(ripple)
    },
  }
}
