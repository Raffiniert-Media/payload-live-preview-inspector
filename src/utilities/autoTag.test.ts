// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyValueMatching, findTaggedElementAt, inferBlockContainers, scanStega } from './autoTag.js'
import { LIVE_PREVIEW_AUTO_ATTRIBUTE, LIVE_PREVIEW_PATH_ATTRIBUTE } from './pathAttribute.js'
import { encodeStegaPath } from './stega.js'

const pathAttr = (el: Element | null) => el?.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)
const autoAttr = (el: Element | null) => el?.getAttribute(LIVE_PREVIEW_AUTO_ATTRIBUTE)

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('scanStega', () => {
  it('tags the element containing an encoded text node', () => {
    document.body.innerHTML = `<h1 id="el">Hello${encodeStegaPath('title')}</h1>`
    scanStega(document)

    const el = document.getElementById('el')
    expect(pathAttr(el)).toBe('title')
    expect(autoAttr(el)).toBe('stega')
  })

  it('never overwrites an existing path attribute (explicit pathOf wins)', () => {
    document.body.innerHTML = `<h1 id="el" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="manual">Hello${encodeStegaPath('other')}</h1>`
    scanStega(document)

    const el = document.getElementById('el')
    expect(pathAttr(el)).toBe('manual')
    expect(autoAttr(el)).toBeNull()
  })

  it('decodes paths from text-bearing attributes like alt', () => {
    document.body.innerHTML = `<img id="el" alt="A picture${encodeStegaPath('hero.image.alt')}" />`
    scanStega(document)

    const el = document.getElementById('el')
    expect(pathAttr(el)).toBe('hero.image.alt')
    expect(autoAttr(el)).toBe('stega')
  })

  it('ignores encoded strings inside script tags (e.g. serialized RSC payloads)', () => {
    document.body.innerHTML = `<script id="el" type="application/json">{"title":"Hello${encodeStegaPath('title')}"}</script>`
    scanStega(document)

    expect(pathAttr(document.getElementById('el'))).toBeNull()
  })

  it('leaves untagged elements without encoded content alone', () => {
    document.body.innerHTML = '<p id="el">Plain text</p>'
    scanStega(document)

    expect(pathAttr(document.getElementById('el'))).toBeNull()
  })
})

describe('applyValueMatching', () => {
  it('tags an element whose whole text equals a unique field value', () => {
    document.body.innerHTML = '<footer id="el">Hello Live Preview</footer>'
    applyValueMatching(document, [{ path: 'title', value: 'Hello Live Preview' }])

    const el = document.getElementById('el')
    expect(pathAttr(el)).toBe('title')
    expect(autoAttr(el)).toBe('match')
  })

  it('normalizes whitespace and stega characters before comparing', () => {
    document.body.innerHTML = `<p id="el">  Hello${encodeStegaPath('x')}   world </p>`
    applyValueMatching(document, [{ path: 'greeting', value: 'Hello world' }])

    expect(pathAttr(document.getElementById('el'))).toBe('greeting')
  })

  it('skips values shared by more than one field (ambiguous)', () => {
    document.body.innerHTML = '<p id="el">Duplicate</p>'
    applyValueMatching(document, [
      { path: 'title', value: 'Duplicate' },
      { path: 'subtitle', value: 'Duplicate' },
    ])

    expect(pathAttr(document.getElementById('el'))).toBeNull()
  })

  it('reports a skipped ambiguous value once, naming the colliding fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    document.body.innerHTML = '<p id="el">Shared hero headline</p>'
    const leaves = [
      { path: 'title', value: 'Shared hero headline' },
      { path: 'hero.title', value: 'Shared hero headline' },
    ]

    applyValueMatching(document, leaves)
    applyValueMatching(document, leaves)

    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toContain('title, hero.title')
    expect(info.mock.calls[0][0]).toContain('Shared hero headline')
    info.mockRestore()
  })

  it('skips values shorter than the minimum length', () => {
    document.body.innerHTML = '<p id="el">Hi</p>'
    applyValueMatching(document, [{ path: 'title', value: 'Hi' }])

    expect(pathAttr(document.getElementById('el'))).toBeNull()
  })

  it('requires the whole text node to match, not a substring', () => {
    document.body.innerHTML = '<p id="el">Hello Live Preview and more</p>'
    applyValueMatching(document, [{ path: 'title', value: 'Hello Live Preview' }])

    expect(pathAttr(document.getElementById('el'))).toBeNull()
  })

  it('never overwrites an existing tag', () => {
    document.body.innerHTML = `<p id="el" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="manual">Hello Live Preview</p>`
    applyValueMatching(document, [{ path: 'title', value: 'Hello Live Preview' }])

    expect(pathAttr(document.getElementById('el'))).toBe('manual')
  })

  it('tags every occurrence of a unique value', () => {
    document.body.innerHTML = '<h1 id="a">Hello Live Preview</h1><footer id="b">Hello Live Preview</footer>'
    applyValueMatching(document, [{ path: 'title', value: 'Hello Live Preview' }])

    expect(pathAttr(document.getElementById('a'))).toBe('title')
    expect(pathAttr(document.getElementById('b'))).toBe('title')
  })
})

describe('findTaggedElementAt', () => {
  // happy-dom has no layout engine (and no elementsFromPoint) - stub the
  // stack a real browser would return at the point (topmost first) and the
  // elements' box sizes.
  const stubElementsFromPoint = (stack: Element[]) => {
    ;(document as unknown as Record<string, unknown>).elementsFromPoint = () => stack
  }

  const stubSize = (el: Element, width: number, height: number) => {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ height, width } as DOMRect)
  }

  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).elementsFromPoint
  })

  it('returns the smallest tagged element in the stack, looking through untagged overlays', () => {
    document.body.innerHTML = `
      <div id="card" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a">
        <a id="overlay" href="/x"></a>
        <h3 id="heading" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.heading">x</h3>
      </div>`
    const overlay = document.getElementById('overlay')!
    const heading = document.getElementById('heading')!
    const card = document.getElementById('card')!
    stubSize(heading, 200, 30)
    stubSize(card, 400, 300)

    // The overlay covers the heading - it comes first in the stack.
    stubElementsFromPoint([overlay, heading, card, document.body])

    expect(findTaggedElementAt(document, 10, 10)?.id).toBe('heading')
  })

  it('beats a TAGGED card-sized overlay with the smaller element beneath it', () => {
    // The real full-card-link case: the overlay itself is tagged (its
    // aria-label carries the link label's stega path) and spans the whole
    // card - it must not win over the heading under the pointer.
    document.body.innerHTML = `
      <div id="card" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a">
        <a id="overlay" href="/x" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.link.label"></a>
        <h3 id="heading" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.title">x</h3>
      </div>`
    const overlay = document.getElementById('overlay')!
    const heading = document.getElementById('heading')!
    const card = document.getElementById('card')!
    stubSize(overlay, 400, 300)
    stubSize(heading, 200, 30)
    stubSize(card, 400, 300)

    stubElementsFromPoint([overlay, heading, card, document.body])

    expect(findTaggedElementAt(document, 10, 10)?.id).toBe('heading')
  })

  it('resolves an equal-sized overlay vs. container by path depth - the more specific path wins', () => {
    // Pointer over card padding: no smaller element beneath - the tagged
    // overlay and the tagged card container have the same box. The
    // overlay's path is deeper (more specific: it addresses the link field
    // that this very overlay represents) - it wins over the generic row.
    document.body.innerHTML = `
      <div id="card" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a">
        <a id="overlay" href="/x" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.link.label"></a>
      </div>`
    const overlay = document.getElementById('overlay')!
    const card = document.getElementById('card')!
    stubSize(overlay, 400, 300)
    stubSize(card, 400, 300)

    stubElementsFromPoint([overlay, card, document.body])

    expect(findTaggedElementAt(document, 10, 10)?.id).toBe('overlay')
  })

  it('resolves an equal-sized overlay vs. a sibling leaf sharing the same path (real full-card-link case)', () => {
    // When a wrapping section has no padding, an overlay link and the
    // content <p> it covers can end up with literally the same
    // bounding box. Here both carry the exact same path (the overlay's
    // aria-label mirrors the paragraph's text) - either resolving is
    // correct, but a same-sized container sharing a path PREFIX must lose
    // to both (this reproduces the regression: the container used to win
    // via stack order, sending clicks to the row instead of the field).
    document.body.innerHTML = `
      <section id="container" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a">
        <a id="overlay" href="/x" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.text"></a>
        <p id="text" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.text">x</p>
      </section>`
    const overlay = document.getElementById('overlay')!
    const text = document.getElementById('text')!
    const container = document.getElementById('container')!
    stubSize(overlay, 300, 40)
    stubSize(text, 300, 40)
    stubSize(container, 300, 40)

    stubElementsFromPoint([overlay, text, container, document.body])

    const winner = findTaggedElementAt(document, 10, 10)
    expect(winner?.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE)).toBe('layout.$a.text')
  })

  it('still returns a tagged overlay when nothing else is tagged', () => {
    document.body.innerHTML = `
      <div id="card"><a id="overlay" href="/x" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.link.label"></a></div>`
    const overlay = document.getElementById('overlay')!
    stubSize(overlay, 400, 300)

    stubElementsFromPoint([overlay, document.getElementById('card')!, document.body])

    expect(findTaggedElementAt(document, 10, 10)?.id).toBe('overlay')
  })

  it('returns null when nothing in the stack is tagged', () => {
    document.body.innerHTML = '<p id="plain">x</p>'
    stubElementsFromPoint([document.getElementById('plain')!, document.body])

    expect(findTaggedElementAt(document, 10, 10)).toBeNull()
  })

  it('returns null when elementsFromPoint is unavailable', () => {
    const doc = { elementsFromPoint: undefined } as unknown as Document
    expect(findTaggedElementAt(doc, 10, 10)).toBeNull()
  })
})

describe('inferBlockContainers', () => {
  it('tags the common ancestor of leaves sharing a row prefix', () => {
    document.body.innerHTML = `
      <main>
        <section id="container">
          <h2 ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.heading">x</h2>
          <p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.subheading">y</p>
        </section>
        <p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="other">z</p>
      </main>`
    inferBlockContainers(document)

    const container = document.getElementById('container')
    expect(pathAttr(container)).toBe('layout.$a')
    expect(autoAttr(container)).toBe('container')
  })

  it('uses the parent element for a single leaf', () => {
    document.body.innerHTML = `
      <main>
        <section id="container"><p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.text">x</p></section>
        <p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="other">z</p>
      </main>`
    inferBlockContainers(document)

    expect(pathAttr(document.getElementById('container'))).toBe('layout.$a')
  })

  it('does nothing when the row is already tagged (manual pathOf(block))', () => {
    document.body.innerHTML = `
      <section ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a">
        <div id="inner"><h2 ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.heading">x</h2></div>
      </section>`
    inferBlockContainers(document)

    expect(pathAttr(document.getElementById('inner'))).toBeNull()
  })

  it('skips a candidate containing tags from a different row (interleaved markup)', () => {
    document.body.innerHTML = `
      <div id="mixed">
        <h2 ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.heading">x</h2>
        <p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.text">y</p>
        <p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$b.text">z</p>
      </div>`
    inferBlockContainers(document)

    expect(pathAttr(document.getElementById('mixed'))).toBeNull()
  })

  it('never tags the body itself', () => {
    document.body.innerHTML = `<p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.text">x</p>`
    // The single leaf's parent is <body> - too broad a guess.
    inferBlockContainers(document)

    expect(pathAttr(document.body)).toBeNull()
  })

  it('handles nested rows, tagging each level', () => {
    document.body.innerHTML = `
      <main>
        <section id="outer">
          <div id="inner">
            <p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.columns.$b.text">x</p>
          </div>
          <h2 ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.heading">y</h2>
        </section>
        <p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="other">z</p>
      </main>`
    inferBlockContainers(document)

    expect(pathAttr(document.getElementById('inner'))).toBe('layout.$a.columns.$b')
    expect(pathAttr(document.getElementById('outer'))).toBe('layout.$a')
  })
})
