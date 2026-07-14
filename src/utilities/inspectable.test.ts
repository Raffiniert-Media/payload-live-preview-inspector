import { afterEach, describe, expect, it, vi } from 'vitest'

import { inspectable, pathOf } from './inspectable.js'
import { LIVE_PREVIEW_PATH_ATTRIBUTE } from './pathAttribute.js'

const attr = (path: string) => ({ [LIVE_PREVIEW_PATH_ATTRIBUTE]: path })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('inspectable / pathOf', () => {
  it('resolves a root-level field via subPath', () => {
    const page = inspectable({ title: 'Hello' })
    expect(pathOf(page, 'title')).toEqual(attr('title'))
  })

  it('addresses array rows by their stable id', () => {
    const page = inspectable({ layout: [{ id: 'a' }, { id: 'b' }] })
    expect(pathOf(page.layout[1])).toEqual(attr('layout.$b'))
    expect(pathOf(page.layout[0], 'heading')).toEqual(attr('layout.$a.heading'))
  })

  it('falls back to the index for rows without an id', () => {
    const page = inspectable({ layout: [{ heading: 'x' }] })
    expect(pathOf(page.layout[0])).toEqual(attr('layout.0'))
  })

  it('tracks paths through nested arrays', () => {
    const page = inspectable({
      layout: [{ id: 'a', items: [{ id: 'x' }, { id: 'y' }] }],
    })
    expect(pathOf(page.layout[0].items[1], 'label')).toEqual(attr('layout.$a.items.$y.label'))
  })

  it('tracks paths through nested groups (plain objects)', () => {
    const page = inspectable({ meta: { seo: { title: 'x' } } })
    expect(pathOf(page.meta.seo, 'title')).toEqual(attr('meta.seo.title'))
  })

  it('carries paths through array iteration methods', () => {
    const page = inspectable({ layout: [{ id: 'a' }, { id: 'b' }] })
    const paths = page.layout.map((block) => pathOf(block))
    expect(paths).toEqual([attr('layout.$a'), attr('layout.$b')])
  })

  it('returns primitives untouched', () => {
    const page = inspectable({ count: 3, layout: [{ id: 'a', heading: 'Hi' }], title: 'Hello' })
    expect(page.title).toBe('Hello')
    expect(page.count).toBe(3)
    expect(page.layout[0].id).toBe('a')
    expect(page.layout[0].heading).toBe('Hi')
  })

  it('returns a stable proxy for repeated access to the same property', () => {
    const page = inspectable({ layout: [{ id: 'a' }] })
    expect(page.layout).toBe(page.layout)
    expect(page.layout[0]).toBe(page.layout[0])
  })

  it('warns and returns no attribute for values not wrapped by inspectable()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(pathOf({ id: 'a' })).toEqual({})
    expect(pathOf('title')).toEqual({})
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('warns and returns no attribute when called on the root without a subPath', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const page = inspectable({ title: 'Hello' })
    expect(pathOf(page)).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('passes non-object values through unchanged', () => {
    expect(inspectable(null)).toBeNull()
    expect(inspectable('x')).toBe('x')
  })

  describe('enabled: false', () => {
    it('emits no attributes anywhere in the tree, without warnings', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const page = inspectable(
        { layout: [{ id: 'a', items: [{ id: 'x' }] }], title: 'Hello' },
        { enabled: false },
      )

      expect(pathOf(page, 'title')).toEqual({})
      expect(pathOf(page.layout[0])).toEqual({})
      expect(pathOf(page.layout[0].items[0], 'label')).toEqual({})
      expect(warn).not.toHaveBeenCalled()
    })

    it('still returns the underlying data unchanged', () => {
      const page = inspectable({ count: 3, layout: [{ id: 'a', heading: 'Hi' }] }, { enabled: false })

      expect(page.count).toBe(3)
      expect(page.layout[0].heading).toBe('Hi')
      expect(page.layout.map((block) => block.id)).toEqual(['a'])
    })

    it('emits attributes as usual when enabled is true or omitted', () => {
      const page = inspectable({ title: 'Hello' }, { enabled: true })
      expect(pathOf(page, 'title')).toEqual(attr('title'))
    })
  })
})
