// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { applyValueMatching, inferBlockContainers, scanStega } from './autoTag.js'
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
