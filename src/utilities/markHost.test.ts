// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MARK_HOST_ATTRIBUTE, markHost, raiseMarkHost, releaseMarkHost } from './markHost.js'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('markHost', () => {
  it('is one element for every mark, made once', () => {
    const host = markHost(document)
    expect(markHost(document)).toBe(host)
    expect(document.querySelectorAll(`[${MARK_HOST_ATTRIBUTE}]`)).toHaveLength(1)
  })

  it('keeps every rule of the page off itself - inline and important', () => {
    const host = markHost(document)
    for (const property of ['position', 'z-index', 'overflow', 'transform', 'pointer-events', 'margin', 'border']) {
      expect(host.style.getPropertyPriority(property), property).toBe('important')
    }
    expect(host.style.getPropertyValue('pointer-events')).toBe('none')
  })

  it('opens as a manual popover, into the top layer, where the browser has them', () => {
    // happy-dom has no popovers: give it the one call that matters.
    const shown = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: shown })
    vi.spyOn(HTMLElement.prototype, 'matches').mockReturnValue(false)
    try {
      const host = markHost(document)
      expect(host.getAttribute('popover')).toBe('manual')
      expect(shown).toHaveBeenCalled()
    } finally {
      delete (HTMLElement.prototype as { showPopover?: unknown }).showPopover
    }
  })

  it('is a fixed layer at the highest z-index where the browser has no popovers', () => {
    const host = markHost(document)
    expect(host.hasAttribute('popover')).toBe(false)
    expect(host.style.getPropertyValue('position')).toBe('fixed')
    expect(host.style.getPropertyValue('z-index')).toBe('2147483647')
  })

  it('opens again over a dialog the page opened after it - the last one opened is on top', () => {
    const host = markHost(document)
    const order: string[] = []
    host.showPopover = () => order.push('show')
    host.hidePopover = () => order.push('hide')
    host.matches = () => true
    vi.spyOn(document, 'querySelector').mockReturnValue(document.createElement('dialog'))
    raiseMarkHost(host)
    expect(order).toEqual(['hide', 'show'])
  })

  it('goes once nothing is drawn in it', () => {
    const host = markHost(document)
    host.append(document.createElement('div'))
    releaseMarkHost(document)
    expect(host.isConnected).toBe(true)
    host.replaceChildren()
    releaseMarkHost(document)
    expect(host.isConnected).toBe(false)
  })
})
