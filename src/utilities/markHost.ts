/**
 * The one element every mark of the preview is drawn in: the hover frame,
 * the click mark, the flash after a reveal, the block toolbar.
 *
 * It sits in the browser's top layer, where dialogs and popovers are - above
 * everything the page draws, whatever the page's CSS says. A mark drawn on
 * the page's own element, or in a layer among the page's elements, can be cut
 * away by an `overflow: hidden` around it, covered by a positioned child,
 * outranked by a `z-index`, or moved by a `transform` on `body`; each of those
 * happened or was one stylesheet away. Measured on the first customer site:
 * an outline 2 px outside a before/after picture, cut away by its rounded
 * box; the same outline drawn inside, covered by the two pictures.
 *
 * A manual popover is how a page puts an element there; a browser without
 * popovers (before Chrome 114, Safari 17, Firefox 125) gets the same element
 * as a fixed layer at the highest `z-index`, which is what all of it was
 * before.
 */

/** On the host, so a test - or a site's own script - can find it. */
export const MARK_HOST_ATTRIBUTE = 'data-payload-live-preview-inspector-marks'

/*
 * Inline and `!important`, so no rule of the page reaches the host: neither
 * the browser's own popover look (a centred, bordered, opaque box) nor a
 * reset of the page's. What is inside is drawn by the marks' own classes.
 */
const HOST_STYLE: Record<string, string> = {
  background: 'transparent',
  border: '0',
  'clip-path': 'none',
  contain: 'none',
  filter: 'none',
  height: '100%',
  inset: '0',
  margin: '0',
  'max-height': 'none',
  'max-width': 'none',
  opacity: '1',
  overflow: 'visible',
  padding: '0',
  'pointer-events': 'none',
  position: 'fixed',
  transform: 'none',
  visibility: 'visible',
  width: '100%',
  'z-index': '2147483647',
}

const canPopover = (el: HTMLElement): boolean =>
  typeof (el as { showPopover?: unknown }).showPopover === 'function'

/**
 * Open, and the last thing in the top layer: the last one opened is drawn on
 * top, so a dialog the page opened since - a card opened in a window - would
 * otherwise cover the marks of what is in it.
 */
export const raiseMarkHost = (host: HTMLElement): void => {
  if (!canPopover(host)) {
    return
  }
  try {
    if (!host.matches(':popover-open')) {
      host.showPopover()
      return
    }
    const above = host.ownerDocument.querySelector(`:popover-open:not([${MARK_HOST_ATTRIBUTE}]), dialog:modal`)
    if (above) {
      host.hidePopover()
      host.showPopover()
    }
  } catch {
    // A browser that knows popovers but not one of these selectors: the host
    // stays where it is, which is still above the page.
  }
}

/** The host, created on first use, connected and raised. */
export const markHost = (doc: Document): HTMLElement => {
  let host = doc.querySelector<HTMLElement>(`[${MARK_HOST_ATTRIBUTE}]`)
  if (!host) {
    host = doc.createElement('div')
    host.setAttribute(MARK_HOST_ATTRIBUTE, '')
    for (const [property, value] of Object.entries(HOST_STYLE)) {
      host.style.setProperty(property, value, 'important')
    }
    if (canPopover(host)) {
      host.setAttribute('popover', 'manual')
    }
  }
  if (!host.isConnected) {
    doc.body.append(host)
  }
  raiseMarkHost(host)
  return host
}

/** Takes the host away once nothing is drawn in it any more. */
export const releaseMarkHost = (doc: Document): void => {
  const host = doc.querySelector<HTMLElement>(`[${MARK_HOST_ATTRIBUTE}]`)
  if (host && host.childElementCount === 0) {
    host.remove()
  }
}
