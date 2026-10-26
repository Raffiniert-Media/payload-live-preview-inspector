import { afterEach, describe, expect, it, vi } from 'vitest'

import { inspectable, inspectableDocument, isInspectable, isInspecting, pathOf, SERIALIZED_PATH_KEY } from './inspectable.js'
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

  describe('isInspectable', () => {
    it('recognises a wrapped node and its children', () => {
      const page = inspectable({ layout: [{ id: 'a', heading: 'Hi' }], title: 'Hello' })

      expect(isInspectable(page)).toBe(true)
      expect(isInspectable(page.layout)).toBe(true)
      expect(isInspectable(page.layout[0])).toBe(true)
    })

    it('recognises a tree wrapped with enabled: false', () => {
      // The point of the guard is to tell "not wrapped" from "wrapped and
      // switched off" - the second one must not be reported as a mistake,
      // because it is what a public page looks like.
      const page = inspectable({ layout: [{ id: 'a' }] }, { enabled: false })

      expect(isInspectable(page)).toBe(true)
      expect(isInspectable(page.layout[0])).toBe(true)
    })

    it('rejects raw data, primitives and null - without warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(isInspectable({ id: 'a', heading: 'Hi' })).toBe(false)
      expect(isInspectable([{ id: 'a' }])).toBe(false)
      expect(isInspectable('Hello')).toBe(false)
      expect(isInspectable(null)).toBe(false)
      expect(isInspectable(undefined)).toBe(false)

      // The whole reason this exists: asking is silent, unlike pathOf().
      expect(warn).not.toHaveBeenCalled()
    })

    it('recognises a node that crossed a serialization boundary', () => {
      const page = inspectable({ meta: { title: 'x' } }, { serializable: true })
      const crossed = JSON.parse(JSON.stringify(page.meta)) as Record<string, unknown>

      expect(isInspectable(crossed)).toBe(true)
      expect(pathOf(crossed)).toEqual(attr('meta'))
    })
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
    it('encodes each prose string field path into its value', () => {
      const page = inspectable(
        { layout: [{ id: 'a', heading: 'Hi there friend' }], title: 'Hello world' },
        { stega: true },
      )

      expect(findStegaPaths(page.title)).toEqual(['title'])
      expect(stegaClean(page.title)).toBe('Hello world')
      expect(findStegaPaths(page.layout[0].heading)).toEqual(['layout.$a.heading'])
      expect(stegaClean(page.layout[0].heading)).toBe('Hi there friend')
    })

    it('leaves strings untouched when stega is off (default)', () => {
      const page = inspectable({ title: 'Hello world' })
      expect(page.title).toBe('Hello world')
    })

    it('never encodes single-token values - select/radio values and enum-like fields stay raw', () => {
      const page = inspectable(
        { heading: 'Kontakt', iconColorState: 'default', size: 'primary-dark', tagPosition: 'topRight' },
        { stega: true },
      )

      const iconColorStates = { default: { base: '#000' } } as Record<string, { base: string }>
      expect(iconColorStates[page.iconColorState].base).toBe('#000')

      expect(page.iconColorState).toBe('default')
      expect(page.tagPosition).toBe('topRight')
      expect(page.size).toBe('primary-dark')
      // Single-word display text isn't stega-tagged either - value matching
      // or pathOf() cover it. Better untagged than a production TypeError.
      expect(page.heading).toBe('Kontakt')
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
      const page = inspectable({ tags: ['featured stories', 'news'] }, { stega: true })

      expect(page.tags[0]).toBe('featured stories')
      expect(page.tags.includes('news')).toBe(true)
    })

    it('encodes nothing when the tree is disabled', () => {
      const page = inspectable({ title: 'Hello world' }, { enabled: false, stega: true })
      expect(page.title).toBe('Hello world')
    })

    it('does not interfere with pathOf()', () => {
      const page = inspectable({ layout: [{ id: 'a', heading: 'Hi' }] }, { stega: true })
      expect(pathOf(page.layout[0], 'heading')).toEqual(attr('layout.$a.heading'))
    })

    it('force-encodes attribute-only display text (alt, ariaLabel, placeholder) even when single-word', () => {
      const page = inspectable(
        {
          ariaLabel: 'Suche',
          logo: { alt: 'Acme', url: 'https://example.com/api/media/file/acme-logo.svg' },
          placeholder: 'Name',
        },
        { stega: true },
      )

      expect(findStegaPaths(page.logo.alt)).toEqual(['logo.alt'])
      expect(stegaClean(page.logo.alt)).toBe('Acme')
      expect(findStegaPaths(page.ariaLabel)).toEqual(['ariaLabel'])
      expect(findStegaPaths(page.placeholder)).toEqual(['placeholder'])
      // Shape-based skips still protect URLs, even under a force key.
      expect(page.logo.url).toBe('https://example.com/api/media/file/acme-logo.svg')
      const urlAlt = inspectable({ alt: '/media/acme-logo.svg' }, { stega: true })
      expect(urlAlt.alt).toBe('/media/acme-logo.svg')
    })

    it('encodes a rich-text text node even when it is one word - a card titled "Personaltraining"', () => {
      const card = inspectable(
        {
          richText: { root: { children: [{ type: 'heading', children: [{ type: 'text', text: 'Personaltraining' }] }] } },
          variant: { text: 'primary' },
        },
        { stega: true },
      )

      const heading = card.richText.root.children[0].children[0].text
      expect(findStegaPaths(heading)).toEqual(['richText.root.children.0.children.0.text'])
      expect(stegaClean(heading)).toBe('Personaltraining')
      // A `text` key that is not a Lexical text node keeps the single-token rule.
      expect(card.variant.text).toBe('primary')
    })

    it('supports custom encodeKeys for known single-word display fields', () => {
      const page = inspectable(
        { buttonLabel: 'Kontakt', variant: 'default' },
        { stega: { encodeKeys: ['buttonLabel'] } },
      )

      expect(findStegaPaths(page.buttonLabel)).toEqual(['buttonLabel'])
      expect(page.variant).toBe('default')
    })

    it('lets skipKeys win over encodeKeys', () => {
      const page = inspectable({ alt: 'Acme' }, { stega: { skipKeys: ['alt'] } })
      expect(page.alt).toBe('Acme')
    })

    it('supports extra skipKeys for prose-shaped but programmatic fields', () => {
      const page = inspectable(
        { cssClasses: 'btn btn-primary is-large', teaser: 'Read the whole story' },
        { stega: { skipKeys: ['cssClasses'] } },
      )

      expect(page.cssClasses).toBe('btn btn-primary is-large')
      expect(findStegaPaths(page.teaser)).toEqual(['teaser'])
    })

    it('lets a filter override the default decision in both directions', () => {
      const page = inspectable(
        { buttonLabel: 'Kontakt', teaser: 'Read the whole story' },
        {
          stega: {
            filter: ({ defaultEncode, key }) => (key === 'buttonLabel' ? true : key === 'teaser' ? false : defaultEncode),
          },
        },
      )

      expect(findStegaPaths(page.buttonLabel)).toEqual(['buttonLabel'])
      expect(page.teaser).toBe('Read the whole story')
    })

    it('passes the full field path and value to the filter', () => {
      const seen: Array<{ defaultEncode: boolean; key: string; path: string; value: string }> = []
      const page = inspectable(
        { layout: [{ id: 'a', heading: 'Hi there' }] },
        { stega: { filter: (args) => (seen.push(args), args.defaultEncode) } },
      )

      void page.layout[0].heading

      expect(seen).toEqual([
        { defaultEncode: true, key: 'heading', path: 'layout.$a.heading', value: 'Hi there' },
      ])
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

  describe('inspectableDocument', () => {
    const post = { id: 12, links: [{ id: 'row-a', label: 'Read the whole story' }], title: 'Thomas B. trains' }

    it('wraps a document the page shows the way the page is wrapped, under the document’s own name', () => {
      const page = inspectable({ layout: [{ id: 'b1', blockType: 'carousel' }] }, { stega: true })
      const shown = inspectableDocument(page.layout[0], { id: 12, collection: 'posts' }, post)

      expect(pathOf(shown)).toEqual(attr('@posts:12'))
      expect(findStegaPaths(shown.title)).toEqual(['@posts:12.title'])
      expect(stegaClean(shown.title)).toBe('Thomas B. trains')
      // In the drawer the document opens straight from the database, in this
      // order - its rows go by position.
      expect(findStegaPaths(shown.links[0].label)).toEqual(['@posts:12.links.0.label'])
    })

    it('keeps the document’s own path through serialization - a card is a client component - and only that one', () => {
      const page = inspectable({ block: { id: 'b1' } }, { stega: true })
      const shown = inspectableDocument(page.block, { id: 12, collection: 'posts' }, post)
      const parsed = JSON.parse(JSON.stringify(shown)) as { links: Record<string, unknown>[] } & Record<string, unknown>

      expect(parsed[SERIALIZED_PATH_KEY]).toBe('@posts:12')
      expect(pathOf(parsed)).toEqual(attr('@posts:12'))
      expect(parsed.links[0]).not.toHaveProperty(SERIALIZED_PATH_KEY)
    })

    it('hands the data back untouched outside the preview - nothing for a visitor to pay for', () => {
      const off = inspectable({ block: { id: 'b1' } }, { enabled: false, stega: true })
      expect(inspectableDocument(off.block, { id: 12, collection: 'posts' }, post)).toBe(post)
      expect(inspectableDocument({ id: 'b1' }, { id: 12, collection: 'posts' }, post)).toBe(post)
      expect(inspectableDocument(off.block, { id: 12, collection: 'posts' }, null)).toBeNull()
    })

    it('rewraps a document that is already part of the page - a relationship’s value - without encoding twice', () => {
      const page = inspectable({ featured: [{ relationTo: 'posts', value: post }] }, { stega: true })
      const shown = inspectableDocument(page, { id: 12, collection: 'posts' }, page.featured[0].value)

      expect(findStegaPaths(shown.title)).toEqual(['@posts:12.title'])
    })

    it('tells a tree that is switched on from one that is not', () => {
      expect(isInspecting(inspectable({ block: { id: 'b1' } }).block)).toBe(true)
      expect(isInspecting(inspectable({ block: { id: 'b1' } }, { enabled: false }).block)).toBe(false)
      expect(isInspecting({ id: 'b1' })).toBe(false)
      expect(isInspecting('text')).toBe(false)
    })
  })
})
