// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AutoTagger } from './autoTagger.js'

import { createAutoTagger } from './autoTagger.js'
import { LIVE_PREVIEW_AUTO_ATTRIBUTE, LIVE_PREVIEW_PATH_ATTRIBUTE } from './pathAttribute.js'
import { encodeStegaPath } from './stega.js'

const pathAttr = (el: Element | null) => el?.getAttribute(LIVE_PREVIEW_PATH_ATTRIBUTE) ?? null
const autoAttr = (el: Element | null) => el?.getAttribute(LIVE_PREVIEW_AUTO_ATTRIBUTE) ?? null

/** Mutation observer callbacks are microtasks - let them run before flushing. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

let tagger: AutoTagger | undefined

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  tagger?.disconnect()
  tagger = undefined
})

describe('createAutoTagger', () => {
  it('tags the whole document on its first pass', () => {
    document.body.innerHTML = `<h1 id="title">Hello world${encodeStegaPath('title')}</h1>`
    tagger = createAutoTagger(document, { stega: true, valueMatching: true })

    tagger.flush()

    expect(pathAttr(document.getElementById('title'))).toBe('title')
  })

  it('tags content added later, without a full rescan', async () => {
    tagger = createAutoTagger(document, { stega: true, valueMatching: true })
    tagger.flush()

    document.body.insertAdjacentHTML('beforeend', `<p id="late">Late text${encodeStegaPath('late')}</p>`)
    await settle()
    tagger.flush()

    expect(pathAttr(document.getElementById('late'))).toBe('late')
  })

  it('re-judges an element whose text React changed in place', async () => {
    document.body.innerHTML = '<h2 id="heading">Old heading</h2>'
    tagger = createAutoTagger(document, { stega: false, valueMatching: true })
    tagger.setLeaves([
      { path: 'a', value: 'Old heading' },
      { path: 'b', value: 'New heading' },
    ])
    tagger.flush()
    const heading = document.getElementById('heading')!
    expect(pathAttr(heading)).toBe('a')

    // Same text node, new data - what React does when a value is edited.
    heading.firstChild!.nodeValue = 'New heading'
    await settle()
    tagger.flush()

    expect(pathAttr(heading)).toBe('b')
  })

  it('drops a match tag whose value is no longer on screen', async () => {
    document.body.innerHTML = '<h2 id="heading">Old heading</h2>'
    tagger = createAutoTagger(document, { stega: false, valueMatching: true })
    tagger.setLeaves([{ path: 'a', value: 'Old heading' }])
    tagger.flush()

    const heading = document.getElementById('heading')!
    heading.textContent = 'Something unrelated'
    await settle()
    tagger.flush()

    expect(pathAttr(heading)).toBeNull()
    expect(autoAttr(heading)).toBeNull()
  })

  it('re-matches against new document values', () => {
    document.body.innerHTML = '<h2 id="heading">Typed heading</h2>'
    tagger = createAutoTagger(document, { stega: false, valueMatching: true })
    tagger.setLeaves([{ path: 'a', value: 'Typed headin' }])
    tagger.flush()
    expect(pathAttr(document.getElementById('heading'))).toBeNull()

    tagger.setLeaves([{ path: 'a', value: 'Typed heading' }])
    tagger.flush()

    expect(pathAttr(document.getElementById('heading'))).toBe('a')
  })

  it('never touches explicit pathOf() tags', async () => {
    document.body.innerHTML = `<h2 id="heading" ${LIVE_PREVIEW_PATH_ATTRIBUTE}="manual">Old heading</h2>`
    tagger = createAutoTagger(document, { stega: false, valueMatching: true })
    tagger.setLeaves([{ path: 'b', value: 'New heading' }])
    tagger.flush()

    document.getElementById('heading')!.firstChild!.nodeValue = 'New heading'
    await settle()
    tagger.flush()

    expect(pathAttr(document.getElementById('heading'))).toBe('manual')
  })

  it('infers containers once leaves are tagged, and re-infers when rows change', async () => {
    document.body.innerHTML = `
      <main>
        <section id="a"><h2>${`Heading A${encodeStegaPath('layout.$a.heading')}`}</h2></section>
        <p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="other">z</p>
      </main>`
    tagger = createAutoTagger(document, { stega: true, valueMatching: false })
    tagger.flush()
    expect(pathAttr(document.getElementById('a'))).toBe('layout.$a')

    // The leaf moves out: the section no longer holds anything of the row.
    const heading = document.querySelector('h2')!
    document.querySelector('main')!.append(heading)
    await settle()
    tagger.flush()

    expect(autoAttr(document.getElementById('a'))).toBeNull()
  })

  it('ignores values when value matching is off', () => {
    document.body.innerHTML = '<h2 id="heading">Some heading</h2>'
    tagger = createAutoTagger(document, { stega: true, valueMatching: false })
    tagger.setLeaves([{ path: 'a', value: 'Some heading' }])
    tagger.flush()

    expect(pathAttr(document.getElementById('heading'))).toBeNull()
  })
})
