// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  expandCollapsedAncestors,
  fieldIDFromPath,
  flashElement,
  focusElement,
  resolveFieldElement,
  resolveRowIDs,
  rowIDFromPath,
  scrollToElement,
} from './pathResolution.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('fieldIDFromPath', () => {
  it('replaces dots with double underscores', () => {
    expect(fieldIDFromPath('layout.0.heading')).toBe('field-layout__0__heading')
    expect(fieldIDFromPath('title')).toBe('field-title')
  })
})

describe('rowIDFromPath', () => {
  it('builds a row id for a path ending in a numeric segment', () => {
    expect(rowIDFromPath('layout.2')).toBe('layout-row-2')
    expect(rowIDFromPath('a.b.3')).toBe('a-b-row-3')
  })

  it('returns null for paths not ending in a numeric segment', () => {
    expect(rowIDFromPath('layout.heading')).toBeNull()
    expect(rowIDFromPath('title')).toBeNull()
  })
})

describe('resolveFieldElement', () => {
  it('resolves a leaf field id directly', () => {
    document.body.innerHTML = '<input id="field-title" />'
    expect(resolveFieldElement('title')?.id).toBe('field-title')
  })

  it('resolves a row wrapper id when the path points at a whole row', () => {
    document.body.innerHTML = '<div id="layout-row-1"></div>'
    expect(resolveFieldElement('layout.1')?.id).toBe('layout-row-1')
  })

  it('falls back to a shorter prefix when the exact path has no match', () => {
    // "layout.1.heroBlock.heading" has no field, but the row it lives in does.
    document.body.innerHTML = '<div id="layout-row-1"></div>'
    expect(resolveFieldElement('layout.1.heroBlock.heading')?.id).toBe('layout-row-1')
  })

  it('returns null when nothing in the path resolves', () => {
    document.body.innerHTML = '<div id="unrelated"></div>'
    expect(resolveFieldElement('layout.1.heading')).toBeNull()
  })
})

describe('resolveRowIDs', () => {
  it('replaces a $rowId segment with the row current index', () => {
    const formState = { layout: { rows: [{ id: 'a' }, { id: 'b' }] } }
    expect(resolveRowIDs('layout.$b.heading', formState)).toBe('layout.1.heading')
  })

  it('passes through paths with no $ segments unchanged', () => {
    const formState = {}
    expect(resolveRowIDs('title', formState)).toBe('title')
  })

  it('returns null when the row id no longer exists', () => {
    const formState = { layout: { rows: [{ id: 'a' }] } }
    expect(resolveRowIDs('layout.$missing.heading', formState)).toBeNull()
  })

  it('resolves multiple nested $rowId segments', () => {
    const formState = {
      layout: { rows: [{ id: 'row-a' }] },
      'layout.0.nested': { rows: [{ id: 'nested-a' }, { id: 'nested-b' }] },
    }
    expect(resolveRowIDs('layout.$row-a.nested.$nested-b.text', formState)).toBe('layout.0.nested.1.text')
  })
})

describe('expandCollapsedAncestors', () => {
  const buildCollapsible = (collapsed: boolean) => {
    const toggle = document.createElement('button')
    toggle.className = 'collapsible__toggle'
    const toggleWrap = document.createElement('div')
    toggleWrap.className = 'collapsible__toggle-wrap'
    toggleWrap.append(toggle)

    const collapsible = document.createElement('div')
    collapsible.className = collapsed ? 'collapsible collapsible--collapsed' : 'collapsible'
    collapsible.append(toggleWrap)

    return { collapsible, toggle }
  }

  it('clicks the toggle of a collapsed ancestor and returns true', () => {
    const { collapsible, toggle } = buildCollapsible(true)
    const field = document.createElement('div')
    collapsible.append(field)
    document.body.append(collapsible)

    const onClick = vi.fn()
    toggle.addEventListener('click', onClick)

    expect(expandCollapsedAncestors(field)).toBe(true)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('clicks the toggle of its own collapsed descendant (row wrapper case)', () => {
    const { collapsible, toggle } = buildCollapsible(true)
    const rowWrapper = document.createElement('div')
    rowWrapper.append(collapsible)
    document.body.append(rowWrapper)

    const onClick = vi.fn()
    toggle.addEventListener('click', onClick)

    expect(expandCollapsedAncestors(rowWrapper)).toBe(true)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('returns false when nothing is collapsed', () => {
    const { collapsible } = buildCollapsible(false)
    const field = document.createElement('div')
    collapsible.append(field)
    document.body.append(collapsible)

    expect(expandCollapsedAncestors(field)).toBe(false)
  })
})

describe('scrollToElement', () => {
  it('scrolls by the element top minus the offset', () => {
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 500 } as DOMRect)
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)

    void scrollToElement(el, 80)

    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', top: 420 })
  })

  it('resolves once "scrollend" fires when the element is off-screen', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    // Beyond happy-dom's default 768px innerHeight - genuinely off-screen.
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 2000 } as DOMRect)
    vi.stubGlobal('scrollBy', vi.fn())

    let resolved = false
    void scrollToElement(el, 80).then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    window.dispatchEvent(new Event('scrollend'))
    await Promise.resolve()

    expect(resolved).toBe(true)
  })

  it('resolves immediately when the element is already in position', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 80 } as DOMRect)
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)

    await scrollToElement(el, 80)

    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('resolves immediately (without waiting for "scrollend") when already visible in the viewport, even if not exactly at the offset', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    // On screen (within happy-dom's default 768px innerHeight) but nowhere
    // near the 80px offset - still nudged toward it, but not worth a wait.
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 300 } as DOMRect)
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)

    await scrollToElement(el, 80)

    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', top: 220 })
  })

  it('falls back to resolving after a timeout if "scrollend" never fires', async () => {
    vi.useFakeTimers()
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 2000 } as DOMRect)
    vi.stubGlobal('scrollBy', vi.fn())

    let resolved = false
    void scrollToElement(el, 80).then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)

    vi.useRealTimers()
  })
})

describe('focusElement', () => {
  it('focuses the element itself when it is focusable', () => {
    const input = document.createElement('input')
    document.body.append(input)
    const focusSpy = vi.spyOn(input, 'focus')

    focusElement(input)

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('focuses the first focusable descendant when the element itself is a container', () => {
    const wrapper = document.createElement('div')
    const input = document.createElement('input')
    wrapper.append(input)
    document.body.append(wrapper)
    const focusSpy = vi.spyOn(input, 'focus')

    focusElement(wrapper)

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
  })
})

describe('flashElement', () => {
  it('adds the flash class and removes it after animationend', () => {
    const el = document.createElement('div')
    document.body.append(el)

    flashElement(el, { className: 'flash' })

    expect(el.classList.contains('flash')).toBe(true)

    el.dispatchEvent(new Event('animationend'))

    expect(el.classList.contains('flash')).toBe(false)
  })

  it('applies a custom color and duration as inline styles', () => {
    const el = document.createElement('div')
    document.body.append(el)

    flashElement(el, { className: 'flash', color: '#ff0000', durationMs: 500 })

    expect(el.style.getPropertyValue('--payload-live-preview-inspector-flash-color')).toBe('#ff0000')
    expect(el.style.animationDuration).toBe('500ms')
  })
})
