// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  collectLeafValues,
  expandCollapsedAncestors,
  fieldIDFromPath,
  flashElement,
  focusElement,
  resolveFieldElement,
  resolveRowIDs,
  rowIDFromPath,
  scrollToElement,
  waitForElementLayout,
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

describe('collectLeafValues', () => {
  it('collects string leaves with row indexes translated to stable row ids', () => {
    const formState = {
      layout: { rows: [{ id: 'a' }, { id: 'b' }] },
      'layout.0.heading': { value: 'Welcome' },
      'layout.1.text': { value: 'Some content' },
      title: { value: 'Hello' },
    }

    expect(collectLeafValues(formState)).toEqual([
      { path: 'layout.$a.heading', value: 'Welcome' },
      { path: 'layout.$b.text', value: 'Some content' },
      { path: 'title', value: 'Hello' },
    ])
  })

  it('resolves nested rows through each array level', () => {
    const formState = {
      layout: { rows: [{ id: 'a' }] },
      'layout.0.nested': { rows: [{ id: 'x' }] },
      'layout.0.nested.0.label': { value: 'Deep' },
    }

    expect(collectLeafValues(formState)).toEqual([{ path: 'layout.$a.nested.$x.label', value: 'Deep' }])
  })

  it('skips non-string and empty values', () => {
    const formState = {
      checkbox: { value: true },
      count: { value: 3 },
      empty: { value: '   ' },
      missing: undefined,
      richText: { value: { root: {} } },
      title: { value: 'Hello' },
    }

    expect(collectLeafValues(formState)).toEqual([{ path: 'title', value: 'Hello' }])
  })

  it('keeps a numeric segment as-is when its parent has no rows', () => {
    const formState = {
      'group.0.label': { value: 'Odd but possible' },
    }

    expect(collectLeafValues(formState)).toEqual([{ path: 'group.0.label', value: 'Odd but possible' }])
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
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('scrolls by the element top minus the offset', () => {
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 500 } as DOMRect)
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)

    void scrollToElement(el, 80)

    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', top: 420 })
  })

  it('scrolls instantly instead of animating when the user prefers reduced motion', () => {
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 500 } as DOMRect)
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))

    void scrollToElement(el, 80)

    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'instant', top: 420 })
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

  it('resolves once "scrollend" fires when the element is off-screen and lands on target', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const rect = vi.spyOn(el, 'getBoundingClientRect')
    // Beyond happy-dom's default 768px innerHeight - genuinely off-screen.
    rect.mockReturnValueOnce({ top: 2000 } as DOMRect)
    // Settled exactly at the offset once the scroll finishes - no correction needed.
    rect.mockReturnValue({ top: 80 } as DOMRect)
    vi.stubGlobal('scrollBy', vi.fn())

    let resolved = false
    void scrollToElement(el, 80).then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    window.dispatchEvent(new Event('scrollend'))
    await Promise.resolve()
    await Promise.resolve()

    expect(resolved).toBe(true)
  })

  it('re-measures after the scroll settles and issues further corrections until it converges', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    const rect = vi.spyOn(el, 'getBoundingClientRect')
    rect.mockReturnValueOnce({ top: 2000 } as DOMRect) // before the first (smooth) scroll
    rect.mockReturnValueOnce({ top: 40 } as DOMRect) // layout shifted mid-scroll - still short of the offset
    rect.mockReturnValue({ top: 80 } as DOMRect) // converged after the correction
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)

    let resolved = false
    void scrollToElement(el, 80).then(() => {
      resolved = true
    })

    window.dispatchEvent(new Event('scrollend'))
    await Promise.resolve()
    await Promise.resolve()

    expect(resolved).toBe(false)
    expect(scrollBy).toHaveBeenNthCalledWith(1, { behavior: 'smooth', top: 1920 })
    expect(scrollBy).toHaveBeenNthCalledWith(2, { behavior: 'smooth', top: -40 })

    window.dispatchEvent(new Event('scrollend'))
    await Promise.resolve()
    await Promise.resolve()

    expect(resolved).toBe(true)
    expect(scrollBy).toHaveBeenCalledTimes(2)
  })

  it('stops retrying once the correction budget is exhausted', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    // Never converges, e.g. content keeps shifting on every measurement.
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 2000 } as DOMRect)
    const scrollBy = vi.fn()
    vi.stubGlobal('scrollBy', scrollBy)

    let resolved = false
    void scrollToElement(el, 80).then(() => {
      resolved = true
    })

    // Initial scroll + 2 corrections, each waiting for its own "scrollend".
    for (let i = 0; i < 3; i++) {
      window.dispatchEvent(new Event('scrollend'))
      await Promise.resolve()
      await Promise.resolve()
    }

    expect(resolved).toBe(true)
    expect(scrollBy).toHaveBeenCalledTimes(3)
  })

  it('falls back to resolving after a timeout if "scrollend" never fires', async () => {
    vi.useFakeTimers()
    const el = document.createElement('div')
    document.body.append(el)
    const rect = vi.spyOn(el, 'getBoundingClientRect')
    rect.mockReturnValueOnce({ top: 2000 } as DOMRect)
    // Converged by the time the fallback fires, so no further correction round is needed.
    rect.mockReturnValue({ top: 80 } as DOMRect)
    vi.stubGlobal('scrollBy', vi.fn())

    let resolved = false
    void scrollToElement(el, 80).then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
  })
})

describe('waitForElementLayout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately when the element already has a layout box', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ height: 24 } as DOMRect)

    await expect(waitForElementLayout(el)).resolves.toBeUndefined()
  })

  it('waits until the element becomes measurable', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    })
    const el = document.createElement('div')
    document.body.append(el)
    const rect = vi.spyOn(el, 'getBoundingClientRect')
    // Still `display: none` for the first two frames after the toggle click.
    rect.mockReturnValueOnce({ height: 0 } as DOMRect)
    rect.mockReturnValueOnce({ height: 0 } as DOMRect)
    rect.mockReturnValue({ height: 24 } as DOMRect)

    let resolved = false
    void waitForElementLayout(el).then(() => {
      resolved = true
    })

    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(16 * 3)
    expect(resolved).toBe(true)
  })

  it('gives up after the timeout when the element never gets a layout box', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    })
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ height: 0 } as DOMRect)

    let resolved = false
    void waitForElementLayout(el, 350).then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(340)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(32)
    expect(resolved).toBe(true)
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
