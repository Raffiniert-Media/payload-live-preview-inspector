import { afterEach, describe, expect, it, vi } from 'vitest'

import { inspectable, pathOf, SERIALIZED_PATH_KEY } from './inspectable.js'
import { LIVE_PREVIEW_PATH_ATTRIBUTE } from './pathAttribute.js'
import { findStegaPaths, stegaClean } from './stega.js'

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

  describe('stega', () => {
    it('encodes each string field path into its value', () => {
      const page = inspectable({ layout: [{ id: 'a', heading: 'Hi' }], title: 'Hello' }, { stega: true })

      expect(findStegaPaths(page.title)).toEqual(['title'])
      expect(stegaClean(page.title)).toBe('Hello')
      expect(findStegaPaths(page.layout[0].heading)).toEqual(['layout.$a.heading'])
      expect(stegaClean(page.layout[0].heading)).toBe('Hi')
    })

    it('leaves strings untouched when stega is off (default)', () => {
      const page = inspectable({ title: 'Hello' })
      expect(page.title).toBe('Hello')
    })

    it('skips programmatically-compared keys like id, blockType, and slug', () => {
      const page = inspectable(
        { layout: [{ id: 'a', slug: 'home', blockType: 'heroBlock' }] },
        { stega: true },
      )

      expect(page.layout[0].id).toBe('a')
      expect(page.layout[0].blockType).toBe('heroBlock')
      expect(page.layout[0].slug).toBe('home')
    })

    it('skips programmatic-looking values like URLs and dates', () => {
      const page = inspectable({ href: 'https://example.com', publishedAt: '2026-07-15' }, { stega: true })

      expect(page.href).toBe('https://example.com')
      expect(page.publishedAt).toBe('2026-07-15')
    })

    it('skips strings read out of arrays (hasMany values are compared)', () => {
      const page = inspectable({ tags: ['featured', 'news'] }, { stega: true })

      expect(page.tags[0]).toBe('featured')
      expect(page.tags.includes('news')).toBe(true)
    })

    it('encodes nothing when the tree is disabled', () => {
      const page = inspectable({ title: 'Hello' }, { enabled: false, stega: true })
      expect(page.title).toBe('Hello')
    })

    it('does not interfere with pathOf()', () => {
      const page = inspectable({ layout: [{ id: 'a', heading: 'Hi' }] }, { stega: true })
      expect(pathOf(page.layout[0], 'heading')).toEqual(attr('layout.$a.heading'))
    })
  })

  describe('serializable', () => {
    it('lets pathOf() work on nodes that crossed a JSON boundary', () => {
      const page = inspectable(
        { layout: [{ id: 'a', heading: 'Hi' }], meta: { seo: { title: 'x' } }, title: 'Hello' },
        { serializable: true },
      )
      const parsed = JSON.parse(JSON.stringify(page)) as typeof page

      expect(pathOf(parsed, 'title')).toEqual(attr('title'))
      expect(pathOf(parsed.layout[0])).toEqual(attr('layout.$a'))
      expect(pathOf(parsed.layout[0], 'heading')).toEqual(attr('layout.$a.heading'))
      expect(pathOf(parsed.meta.seo, 'title')).toEqual(attr('meta.seo.title'))
    })

    it('exposes the marker via Object.keys and spreads', () => {
      const page = inspectable({ meta: { title: 'x' } }, { serializable: true })

      expect(Object.keys(page.meta)).toContain(SERIALIZED_PATH_KEY)
      expect(({ ...page.meta } as Record<string, unknown>)[SERIALIZED_PATH_KEY]).toBe('meta')
    })

    it('adds no marker when serializable is off (default)', () => {
      const page = inspectable({ meta: { title: 'x' } })

      expect(Object.keys(page.meta)).not.toContain(SERIALIZED_PATH_KEY)
      expect(JSON.stringify(page)).toBe(JSON.stringify({ meta: { title: 'x' } }))
    })

    it('adds no marker when the tree is disabled', () => {
      const page = inspectable({ meta: { title: 'x' } }, { enabled: false, serializable: true })
      expect(JSON.stringify(page)).toBe(JSON.stringify({ meta: { title: 'x' } }))
    })

    it('preserves array iteration', () => {
      const page = inspectable({ layout: [{ id: 'a' }, { id: 'b' }] }, { serializable: true })
      expect(page.layout.map((block) => block.id)).toEqual(['a', 'b'])
    })
  })
})
