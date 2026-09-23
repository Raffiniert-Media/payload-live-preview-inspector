// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  collectLeafValues,
  DEFAULT_TAB_SWITCH_WAIT_MS,
  expandCollapsedAncestors,
  fieldIDFromPath,
  fieldPathFromFormState,
  findUnrenderedRows,
  flashElement,
  focusElement,
  pathFromFieldElement,
  resolvedPathDepth,
  resolveExactFieldElement,
  resolveFieldElement,
  resolveRowIDs,
  revealTabForElement,
  rowIDFromPath,
  scrollToElement,
  toRowIDPath,
  unrenderedRowFields,
  waitForElement,
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

describe('pathFromFieldElement', () => {
  it('reads the path off a simple field control id', () => {
    document.body.innerHTML = '<div id="field-layout__0__heading"><input id="field-layout__0__heading" /></div>'
    expect(pathFromFieldElement(document.querySelector('input')!)).toBe('layout.0.heading')
  })

  it('climbs from a nested element up to the ancestor that carries the id', () => {
    // RadioGroup renders its id on the <ul>, focus lands on a nested <input>.
    document.body.innerHTML = '<ul id="field-visibility"><li><input type="radio" /></li></ul>'
    const nested = document.querySelector('input')!
    expect(pathFromFieldElement(nested)).toBe('visibility')
  })

  it('climbs through several levels to a data-field-path ancestor (Lexical: no id on the field wrapper)', () => {
    document.body.innerHTML =
      '<div data-field-path="body"><div class="lexical-editor" contenteditable="true"><p>text</p></div></div>'
    expect(pathFromFieldElement(document.querySelector('p')!)).toBe('body')
  })

  it('reads a row off its header, not the Array/Blocks field around it', () => {
    // The row toggle sits in the row, but in none of its fields; the next id
    // up is the whole blocks field - whose first row is the top of the page.
    document.body.innerHTML = `
      <div id="field-layout">
        <div id="layout-row-3"><div class="collapsible__toggle-wrap"><button>Toggle</button></div></div>
        <div id="layout-3-items-row-1"><button id="nested">Toggle</button></div>
      </div>`
    expect(pathFromFieldElement(document.querySelector('button')!)).toBe('layout.3')
    expect(pathFromFieldElement(document.getElementById('nested')!)).toBe('layout.3.items.1')
  })

  it('passes over the scroll id an Array row header also carries', () => {
    document.body.innerHTML = `
      <div id="items-row-1"><div id="scroll-_r_5_-row-1"><span id="label">Row 02</span></div></div>`
    expect(pathFromFieldElement(document.getElementById('label')!)).toBe('items.1')
  })

  it('returns null when the element is outside any field', () => {
    document.body.innerHTML = '<button id="save">Save</button>'
    expect(pathFromFieldElement(document.getElementById('save')!)).toBeNull()
  })
})

describe('resolveExactFieldElement', () => {
  it('resolves the full path only - no prefix fallback', () => {
    document.body.innerHTML = '<div id="layout-row-1"></div>'
    expect(resolveExactFieldElement('layout.1')?.id).toBe('layout-row-1')
    // The prefix would resolve, but the exact leaf does not exist.
    expect(resolveExactFieldElement('layout.1.heading')).toBeNull()
  })

  it('falls back to a data-field-path attribute (Lexical rich text renders no field id)', () => {
    document.body.innerHTML = '<div data-field-path="body" id="rich-text-wrapper"></div>'
    expect(resolveExactFieldElement('body')?.id).toBe('rich-text-wrapper')
    expect(resolveFieldElement('body.root.children.0.children.0.text')?.id).toBe('rich-text-wrapper')
  })

  it('prefers the field id over a data-field-path match', () => {
    document.body.innerHTML = '<input id="field-title" /><div data-field-path="title" id="wrapper"></div>'
    expect(resolveExactFieldElement('title')?.id).toBe('field-title')
  })
})

describe('resolvedPathDepth', () => {
  it('returns the segment count of the deepest resolvable prefix', () => {
    document.body.innerHTML = '<div id="layout-row-2"></div>'
    expect(resolvedPathDepth('layout.2.groups.2.title')).toBe(2)

    document.body.innerHTML = '<div id="layout-2-groups-row-2"></div>'
    expect(resolvedPathDepth('layout.2.groups.2.title')).toBe(4)

    document.body.innerHTML = '<input id="field-layout__2__groups__2__title" />'
    expect(resolvedPathDepth('layout.2.groups.2.title')).toBe(5)
  })

  it('returns 0 when nothing resolves', () => {
    expect(resolvedPathDepth('layout.2.groups.2.title')).toBe(0)
  })
})

describe('fieldPathFromFormState', () => {
  const formState = {
    'layout.0.rich': { value: {} },
    title: { value: 'x' },
  }

  it('returns the path itself when it is a form field', () => {
    expect(fieldPathFromFormState('title', formState)).toBe('title')
  })

  it('trims a too-deep path (e.g. stega inside rich text) to its owning field', () => {
    expect(fieldPathFromFormState('layout.0.rich.root.children.0.text', formState)).toBe('layout.0.rich')
  })

  it('returns null when no prefix is a form field (e.g. a bare row path)', () => {
    expect(fieldPathFromFormState('layout.0', formState)).toBeNull()
  })
})

describe('revealTabForElement', () => {
  const buildTabs = (labels: string[], activeIndex: number) => {
    const bar = document.createElement('div')
    return labels.map((label, index) => {
      const button = document.createElement('button')
      button.className =
        index === activeIndex ? 'tabs-field__tab-button tabs-field__tab-button--active' : 'tabs-field__tab-button'
      button.textContent = label
      bar.append(button)
      document.body.append(bar)
      return button
    })
  }

  it('returns immediately when the element is already present', async () => {
    document.body.innerHTML = '<input id="field-title" />'
    const el = await revealTabForElement(() => document.getElementById('field-title'), 50)
    expect(el?.id).toBe('field-title')
  })

  it('clicks through inactive tabs until the element appears', async () => {
    const [, meta] = buildTabs(['Content', 'Meta'], 0)
    // Simulate Payload rendering the panel after the tab becomes active.
    meta.addEventListener('click', () => {
      meta.classList.add('tabs-field__tab-button--active')
      document.body.insertAdjacentHTML('beforeend', '<input id="field-metaNote" />')
    })

    const el = await revealTabForElement(() => document.getElementById('field-metaNote'), 50)

    expect(el?.id).toBe('field-metaNote')
  })

  it('restores the originally active tab when nothing is found anywhere', async () => {
    const [content, meta] = buildTabs(['Content', 'Meta'], 0)
    meta.addEventListener('click', () => {
      content.classList.remove('tabs-field__tab-button--active')
      meta.classList.add('tabs-field__tab-button--active')
    })
    content.addEventListener('click', () => {
      meta.classList.remove('tabs-field__tab-button--active')
      content.classList.add('tabs-field__tab-button--active')
    })

    const el = await revealTabForElement(() => document.getElementById('field-missing'), 20)

    expect(el).toBeNull()
    expect(content.classList.contains('tabs-field__tab-button--active')).toBe(true)
    expect(meta.classList.contains('tabs-field__tab-button--active')).toBe(false)
  })

  it('stops clicking and restores nothing once a newer reveal aborts it', async () => {
    const [content, meta, seo] = buildTabs(['Content', 'Meta', 'SEO'], 0)
    const controller = new AbortController()
    const clicks: string[] = []
    for (const button of [content, meta, seo]) {
      button.addEventListener('click', () => clicks.push(button.textContent ?? ''))
    }
    // The newer reveal takes over while the sweep waits on the first tab.
    meta.addEventListener('click', () => setTimeout(() => controller.abort(), 5))

    const el = await revealTabForElement(() => document.getElementById('field-missing'), 200, document, controller.signal)

    expect(el).toBeNull()
    // Neither the next tab nor the restoring click on "Content" - either
    // would undo the tab the newer reveal just switched to.
    expect(clicks).toEqual(['Meta'])
  })

  it('defaults to a generous per-tab wait (1500ms), not a couple of frames', () => {
    // Regression guard: a too-short default (250ms) let the sweep give up on
    // the correct tab before a heavier tab's fields (rich-text editors,
    // deeply nested blocks) finished rendering, so it tried the rest and
    // reverted - looking like the click did nothing. Configurable via the
    // plugin's `tabSwitchWaitMs` option.
    expect(DEFAULT_TAB_SWITCH_WAIT_MS).toBeGreaterThanOrEqual(1000)
  })

  it('never touches tabs outside the given root (a rendered ancestor pins the target to the active tab)', async () => {
    const [content, meta] = buildTabs(['Content', 'Meta'], 0)
    const contentClicks = vi.fn()
    const metaClicks = vi.fn()
    content.addEventListener('click', contentClicks)
    meta.addEventListener('click', metaClicks)

    const row = document.createElement('div')
    row.id = 'layout-row-0'
    document.body.append(row)

    const el = await revealTabForElement(() => null, 20, row)

    expect(el).toBeNull()
    expect(contentClicks).not.toHaveBeenCalled()
    expect(metaClicks).not.toHaveBeenCalled()
  })

  it('still sweeps tabs nested inside the root', async () => {
    const [, topMeta] = buildTabs(['Content', 'Meta'], 0)
    const topMetaClicks = vi.fn()
    topMeta.addEventListener('click', topMetaClicks)

    const row = document.createElement('div')
    row.id = 'layout-row-0'
    const innerActive = document.createElement('button')
    innerActive.className = 'tabs-field__tab-button tabs-field__tab-button--active'
    const innerHidden = document.createElement('button')
    innerHidden.className = 'tabs-field__tab-button'
    innerHidden.addEventListener('click', () => {
      innerHidden.classList.add('tabs-field__tab-button--active')
      row.insertAdjacentHTML('beforeend', '<input id="field-layout__0__text" />')
    })
    row.append(innerActive, innerHidden)
    document.body.append(row)

    const el = await revealTabForElement(() => document.getElementById('field-layout__0__text'), 50, row)

    expect(el?.id).toBe('field-layout__0__text')
    expect(topMetaClicks).not.toHaveBeenCalled()
  })

  it('still finds the field when a tab genuinely takes a while to render it', async () => {
    // Simulates the real regression: the tab's fields don't appear
    // synchronously on click, but slightly later (e.g. a rich-text editor
    // finishing its own render pass) - comfortably within the default
    // per-tab budget, but well past the old hardcoded 250ms.
    const [, meta] = buildTabs(['Content', 'Meta'], 0)
    meta.addEventListener('click', () => {
      meta.classList.add('tabs-field__tab-button--active')
      setTimeout(() => {
        document.body.insertAdjacentHTML('beforeend', '<input id="field-metaNote" />')
      }, 300)
    })

    const el = await revealTabForElement(() => document.getElementById('field-metaNote'), DEFAULT_TAB_SWITCH_WAIT_MS)

    expect(el?.id).toBe('field-metaNote')
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

  it('truncates at a $rowId segment whose prefix is not an array field (a path into rich-text JSON)', () => {
    // A stega path pointing inside a rich-text value: Lexical blocks carry
    // ids of their own, but `body.root.children` is not a form field - the
    // truncated prefix still resolves to the owning `body` field via the
    // usual prefix fallback.
    const formState = { body: { value: { root: {} } } }
    expect(resolveRowIDs('body.root.children.$lexBlock.fields.note', formState)).toBe('body.root.children')
  })

  it('still returns null for a deleted row of a real array field', () => {
    const formState = { layout: { rows: [{ id: 'a' }] } }
    expect(resolveRowIDs('layout.$deleted.heading', formState)).toBeNull()
  })

  it('returns null when the path starts with an unresolvable $rowId segment', () => {
    expect(resolveRowIDs('$orphan.heading', {})).toBeNull()
  })
})

describe('toRowIDPath', () => {
  it('replaces a numeric row index with the row current id', () => {
    const formState = { layout: { rows: [{ id: 'a' }, { id: 'b' }] } }
    expect(toRowIDPath('layout.1.heading', formState)).toBe('layout.$b.heading')
  })

  it('passes through paths with no numeric segments unchanged', () => {
    expect(toRowIDPath('title', {})).toBe('title')
  })

  it('resolves multiple nested row indexes', () => {
    const formState = {
      layout: { rows: [{ id: 'row-a' }] },
      'layout.0.nested': { rows: [{ id: 'nested-a' }, { id: 'nested-b' }] },
    }
    expect(toRowIDPath('layout.0.nested.1.text', formState)).toBe('layout.$row-a.nested.$nested-b.text')
  })

  it('keeps a numeric segment as-is when its parent has no rows', () => {
    expect(toRowIDPath('group.0.label', {})).toBe('group.0.label')
  })

  it('is the inverse of resolveRowIDs', () => {
    const formState = { layout: { rows: [{ id: 'a' }, { id: 'b' }] } }
    const rowIDPath = 'layout.$b.heading'
    expect(toRowIDPath(resolveRowIDs(rowIDPath, formState)!, formState)).toBe(rowIDPath)
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

  it('skips row bookkeeping (blockType, id), which is never content', () => {
    const formState = {
      layout: { rows: [{ id: 'a' }] },
      'layout.0.blockType': { value: 'hero' },
      'layout.0.heading': { value: 'Welcome' },
      'layout.0.id': { value: 'a' },
    }

    expect(collectLeafValues(formState)).toEqual([{ path: 'layout.$a.heading', value: 'Welcome' }])
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

  it('collects rich-text text runs, each addressed by the owning field path', () => {
    const formState = {
      body: {
        value: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', text: 'First paragraph run' },
                  { type: 'text', format: 1, text: 'bold run' },
                ],
              },
              { type: 'paragraph', children: [{ type: 'text', text: 'Second paragraph' }] },
            ],
          },
        },
      },
    }

    expect(collectLeafValues(formState)).toEqual([
      { path: 'body', value: 'First paragraph run' },
      { path: 'body', value: 'bold run' },
      { path: 'body', value: 'Second paragraph' },
    ])
  })

  it('addresses rich-text runs inside array rows via stable row ids', () => {
    const formState = {
      layout: { rows: [{ id: 'a' }] },
      'layout.0.body': {
        value: { root: { children: [{ children: [{ type: 'text', text: 'Nested rich text' }] }] } },
      },
    }

    expect(collectLeafValues(formState)).toEqual([{ path: 'layout.$a.body', value: 'Nested rich text' }])
  })

  it('ignores structural strings in rich-text values and empty text runs', () => {
    const formState = {
      body: {
        value: {
          root: {
            type: 'root',
            children: [{ children: [{ type: 'text', text: '   ' }], direction: 'ltr', format: 'left' }],
          },
        },
      },
    }

    expect(collectLeafValues(formState)).toEqual([])
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
    vi.unstubAllGlobals()
  })

  /**
   * happy-dom never scrolls - simulate a page: `scrollY` follows the
   * `scrollTo`/`scrollBy` calls (clamped to `maxY`, like a real document
   * end), and the element's viewport top is its document position minus it.
   */
  const simulatePage = ({
    afterScroll,
    docTop,
    maxY = Number.POSITIVE_INFINITY,
  }: {
    afterScroll?: (y: number) => void
    docTop: number
    maxY?: number
  }) => {
    let y = 0
    const page = { docTop }
    const setY = (next: number) => {
      y = Math.max(0, Math.min(maxY, next))
      afterScroll?.(y)
    }
    const scrollTo = vi.fn((options: { top: number }) => setY(options.top))
    const scrollBy = vi.fn((options: { top: number }) => setY(y + options.top))
    vi.stubGlobal('scrollTo', scrollTo)
    vi.stubGlobal('scrollBy', scrollBy)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    const descriptor = Object.getOwnPropertyDescriptor(window, 'scrollY')
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
    // The document is as tall as `maxY` lets it scroll.
    const heightDescriptor = Object.getOwnPropertyDescriptor(document.documentElement, 'scrollHeight')
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => (Number.isFinite(maxY) ? maxY : 1e9) + window.innerHeight,
    })

    const element = (position: () => number) => {
      const el = document.createElement('div')
      document.body.append(el)
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({ top: position() - y }) as DOMRect)
      return el
    }

    return {
      el: element(() => page.docTop),
      element,
      page,
      restore: () => {
        if (descriptor) {
          Object.defineProperty(window, 'scrollY', descriptor)
        } else {
          Reflect.deleteProperty(window, 'scrollY')
        }
        if (heightDescriptor) {
          Object.defineProperty(document.documentElement, 'scrollHeight', heightDescriptor)
        } else {
          Reflect.deleteProperty(document.documentElement, 'scrollHeight')
        }
      },
      scrollBy,
      scrollTo,
      y: () => y,
    }
  }

  it('animates the page until the element sits at the offset', async () => {
    const sim = simulatePage({ docTop: 3000 })

    await scrollToElement(sim.el, 80)

    expect(sim.scrollBy.mock.calls.length).toBeGreaterThan(3)
    expect(sim.y()).toBeCloseTo(2920, 0)
    sim.restore()
  })

  it('keeps the animation short however far it goes', async () => {
    const sim = simulatePage({ docTop: 50_000 })
    const startedAt = performance.now()

    await scrollToElement(sim.el, 80)

    expect(performance.now() - startedAt).toBeLessThan(1_000)
    expect(sim.y()).toBeCloseTo(49_920, 0)
    sim.restore()
  })

  it('follows an element that moves while the page is scrolling toward it', async () => {
    const sim = simulatePage({ docTop: 3000 })
    // Rows expanding above the target push it down mid-flight.
    setTimeout(() => {
      sim.page.docTop = 3600
    }, 50)

    await scrollToElement(sim.el, 80)

    expect(sim.y()).toBeCloseTo(3520, 0)
    sim.restore()
  })

  it('bends toward a deeper element the moment the target getter returns it', async () => {
    const sim = simulatePage({ docTop: 3000 })
    const deeper = sim.element(() => 3400)
    let mounted = false
    setTimeout(() => {
      mounted = true
    }, 50)

    await scrollToElement(() => (mounted ? deeper : sim.el), 80)

    expect(sim.y()).toBeCloseTo(3320, 0)
    sim.restore()
  })

  it('slows down over a frame the page spent rendering, instead of leaping to catch up', async () => {
    const steps: number[] = []
    let last = 0
    let stalled = false
    const sim = simulatePage({
      afterScroll: (y) => {
        steps.push(Math.abs(y - last))
        last = y
        if (!stalled && y > 1000) {
          // The main thread busy for 200ms, like React mounting a row's fields.
          stalled = true
          const until = performance.now() + 200
          while (performance.now() < until) {
            // spin
          }
        }
      },
      docTop: 3000,
    })

    await scrollToElement(sim.el, 80)

    expect(sim.y()).toBeCloseTo(2920, 0)
    // Uncapped, the frame after the stall covered 200ms of the curve at once.
    expect(Math.max(...steps)).toBeLessThan(700)
  })

  it('keeps clear of an offset that changes while the page moves (a header that shows up)', async () => {
    const sim = simulatePage({ docTop: 3000 })
    let inset = 12
    setTimeout(() => {
      inset = 76
    }, 60)

    await scrollToElement(sim.el, () => inset, 'smooth', undefined, true)

    expect(sim.y()).toBeCloseTo(2924, 0)
  })

  it('jumps instead of animating when the user prefers reduced motion', async () => {
    const sim = simulatePage({ docTop: 500 })
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))

    await scrollToElement(sim.el, 80)

    expect(sim.scrollTo).not.toHaveBeenCalled()
    expect(sim.scrollBy).toHaveBeenCalledWith({ behavior: 'instant', top: 420 })
    sim.restore()
  })

  it('jumps instead of animating when the caller asks for it', async () => {
    const sim = simulatePage({ docTop: 3000 })

    await scrollToElement(sim.el, 80, 'instant')

    expect(sim.scrollTo).not.toHaveBeenCalled()
    expect(sim.scrollBy).toHaveBeenCalledWith({ behavior: 'instant', top: 2920 })
    sim.restore()
  })

  it('does nothing when the element is already in position', async () => {
    const sim = simulatePage({ docTop: 80 })

    await scrollToElement(sim.el, 80)

    expect(sim.scrollTo).not.toHaveBeenCalled()
    expect(sim.scrollBy).not.toHaveBeenCalled()
    sim.restore()
  })

  it('resolves right away when the element is already on screen, nudging it in the background', async () => {
    // Within happy-dom's 768px viewport, but not at the offset.
    const sim = simulatePage({ docTop: 400 })

    await scrollToElement(sim.el, 80)
    expect(sim.y()).toBeLessThan(320)

    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(sim.y()).toBeCloseTo(320, 0)
    sim.restore()
  })

  it('stops where it is once its signal aborts - a newer reveal took over', async () => {
    const sim = simulatePage({ docTop: 3000 })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 60)

    await scrollToElement(sim.el, 80, 'smooth', controller.signal)

    expect(sim.y()).toBeGreaterThan(0)
    expect(sim.y()).toBeLessThan(2920)
    sim.restore()
  })

  it('lets go the moment the editor scrolls for themselves', async () => {
    const sim = simulatePage({ docTop: 3000 })
    setTimeout(() => window.dispatchEvent(new Event('wheel')), 60)

    await scrollToElement(sim.el, 80)

    expect(sim.y()).toBeLessThan(2920)
    sim.restore()
  })

  it('corrects for layout that shifts right after the animation ends', async () => {
    // A deferred field mounts above the target as soon as the page arrives.
    const sim = simulatePage({
      afterScroll: (y) => {
        if (y >= 2920) {
          sim.page.docTop = 3250
        }
      },
      docTop: 3000,
    })

    const scrolls = sim.scrollBy.mock.calls.length
    await scrollToElement(sim.el, 80)

    // Glided there in several steps, not jumped.
    expect(sim.scrollBy.mock.calls.length - scrolls).toBeGreaterThan(3)
    expect(sim.y()).toBeCloseTo(3170, 0)
    sim.restore()
  })

  it('stops correcting when the page cannot scroll any further (target near the document end)', async () => {
    const sim = simulatePage({ docTop: 3000, maxY: 2500 })
    const startedAt = performance.now()

    await scrollToElement(sim.el, 80)

    expect(sim.y()).toBe(2500)
    // One correction attempt that moved nothing, not the whole budget.
    expect(performance.now() - startedAt).toBeLessThan(1_200)
    sim.restore()
  })

  it('does not wait out an animation that cannot move the page (target past the document end)', async () => {
    const sim = simulatePage({ docTop: 3000, maxY: 0 })
    const startedAt = performance.now()

    await scrollToElement(sim.el, 80, 'smooth', undefined, true)

    expect(sim.scrollBy).not.toHaveBeenCalled()
    expect(performance.now() - startedAt).toBeLessThan(50)
    sim.restore()
  })

  it('cancels a scroll still running in the background when a new one starts', async () => {
    const sim = simulatePage({ docTop: 400 })
    const other = sim.element(() => 5000)

    await scrollToElement(sim.el, 80) // on screen: keeps animating in the background
    await scrollToElement(other, 80)

    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(sim.y()).toBeCloseTo(4920, 0)
    sim.restore()
  })
})

describe('waitForElement', () => {
  const fakeTimers = () =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves as soon as the check finds the element', async () => {
    fakeTimers()
    const el = document.createElement('input')
    let found: HTMLElement | null = null
    void waitForElement(() => found, 1500).then((result) => {
      el.dataset.resolved = String(result === el)
    })

    await vi.advanceTimersByTimeAsync(32)
    expect(el.dataset.resolved).toBeUndefined()

    found = el
    await vi.advanceTimersByTimeAsync(32)
    expect(el.dataset.resolved).toBe('true')
  })

  it('waits out its whole budget on a silent DOM by default', async () => {
    /*
     * The default has to be this patient, and the reason is a regression that
     * already happened: Payload mounts a tab's fields a few hundred *silent*
     * milliseconds after the tab button is clicked, so a caller waiting on a
     * reaction it triggered cannot read silence as "nothing is coming".
     * `revealTabForElement` above covers the symptom; this covers the rule.
     */
    fakeTimers()
    let resolved = false
    void waitForElement(() => null, 1500).then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(1400)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(120)
    expect(resolved).toBe(true)
  })

  it('gives up early on a silent DOM when the caller opted in', async () => {
    fakeTimers()
    let resolved = false
    void waitForElement(() => null, 1500, { idleMs: 250 }).then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(200)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(100)
    expect(resolved).toBe(true)
  })

  it('keeps waiting past the idle window while the DOM is still changing', async () => {
    fakeTimers()
    let found: HTMLElement | null = null
    let resolved = false
    void waitForElement(() => found, 1500, { idleMs: 250 }).then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(200)
    document.body.append(document.createElement('div'))
    await vi.advanceTimersByTimeAsync(200)

    // 400ms in, and 400 > 250: without the mutation resetting the window this
    // would already have given up.
    expect(resolved).toBe(false)

    const el = document.createElement('input')
    found = el
    await vi.advanceTimersByTimeAsync(32)
    expect(resolved).toBe(true)
  })
})

describe('waitForElement abort', () => {
  it('resolves null as soon as its signal aborts, without waiting out the budget', async () => {
    const controller = new AbortController()
    const startedAt = performance.now()
    setTimeout(() => controller.abort(), 10)

    const el = await waitForElement(() => null, 5_000, { signal: controller.signal })

    expect(el).toBeNull()
    expect(performance.now() - startedAt).toBeLessThan(1_000)
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

  it('places the caret at the clicked text position and returns its element', () => {
    document.body.innerHTML =
      '<div data-field-path="body"><div contenteditable="true"><p>Rich text paragraph</p></div></div>'
    const field = document.querySelector<HTMLElement>('[data-field-path="body"]')!

    const caretEl = focusElement(field, { offset: 5, text: 'Rich text paragraph' })

    expect(caretEl).toBe(document.querySelector('p'))
    expect(window.getSelection()!.anchorOffset).toBe(5)
  })

  it('falls back to plain focusing when the hint no longer matches', () => {
    document.body.innerHTML = '<div id="field"><input type="text" value="Something else"></div>'
    const input = document.querySelector('input')!
    const focusSpy = vi.spyOn(input, 'focus')

    const caretEl = focusElement(document.getElementById('field')!, { offset: 2, text: 'Gone' })

    expect(caretEl).toBeNull()
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

describe('unrenderedRowFields', () => {
  const row = (collapsed: boolean, fields: string) => {
    document.body.innerHTML = `
      <div id="layout-row-0">
        <div class="collapsible${collapsed ? ' collapsible--collapsed' : ''}">
          <div class="collapsible__toggle-wrap"></div>
          <div><div class="collapsible__content"><div class="render-fields">${fields}</div></div></div>
        </div>
      </div>`
    return document.getElementById('layout-row-0')
  }

  it('finds the fields container of an open row Payload rendered nothing into', () => {
    expect(unrenderedRowFields(row(false, ''))?.className).toBe('render-fields')
  })

  it('leaves a rendered row, a closed one and a missing one alone', () => {
    expect(unrenderedRowFields(row(false, '<div class="field-type"></div>'))).toBeNull()
    expect(unrenderedRowFields(row(true, ''))).toBeNull()
    expect(unrenderedRowFields(null)).toBeNull()
  })
})

describe('findUnrenderedRows', () => {
  it('lists every open, empty row with its path - not scroll ids, closed or rendered rows', () => {
    const row = (id: string, collapsed: boolean, fields: string) => `
      <div id="${id}"><div class="collapsible${collapsed ? ' collapsible--collapsed' : ''}">
        <div><div class="render-fields">${fields}</div></div>
      </div></div>`
    document.body.innerHTML =
      row('layout-4-rows-row-1', false, '') +
      row('layout-4-rows-row-2', true, '') +
      row('layout-row-0', false, '<div class="field-type"></div>') +
      row('scroll-_r_1_-row-0', false, '')

    expect(findUnrenderedRows().map(({ index, path }) => `${path}.${index}`)).toEqual(['layout.4.rows.1'])
  })
})
