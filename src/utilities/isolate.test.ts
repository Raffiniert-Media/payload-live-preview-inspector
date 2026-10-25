// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  ABOVE_ATTRIBUTE,
  AROUND_ATTRIBUTE,
  FOCUSING_ATTRIBUTE,
  HIDDEN_ATTRIBUTE,
  HOST_ATTRIBUTE,
  isolate,
} from './isolate.js'

/** The shape of a form with a tab bar, a sidebar, sections, rows and columns. */
const FORM = `
  <main id="root">
    <div id="host" ${HOST_ATTRIBUTE}></div>
    <div id="fields">
      <div id="title"></div>
      <div id="tabs">
        <div id="tab-buttons"></div>
        <div id="tab-content">
          <div id="sections">
            <div id="section-0"><header id="section-0-header"></header>
              <div id="section-0-rows">
                <div id="row-0"><div id="col-0"></div><div id="col-1"><p id="text"></p></div></div>
                <div id="row-1"></div>
              </div>
            </div>
            <div id="section-1"></div>
          </div>
          <button id="add-section"></button>
        </div>
      </div>
    </div>
    <aside id="sidebar"></aside>
  </main>
`

const hidden = () => Array.from(document.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`), (el) => el.id).sort()
const byId = (id: string) => document.getElementById(id) as HTMLElement

describe('isolate', () => {
  beforeEach(() => {
    document.body.innerHTML = FORM
  })

  it('hides every sibling on the way up, and nothing on the way or inside', () => {
    expect(isolate(byId('root'), byId('col-1'))).toBe(true)
    expect(hidden()).toEqual(['add-section', 'col-0', 'row-1', 'section-0-header', 'section-1', 'sidebar', 'tab-buttons', 'title'])
    expect(byId('text').hasAttribute(HIDDEN_ATTRIBUTE)).toBe(false)
  })

  it('never hides the editor’s own elements', () => {
    isolate(byId('root'), byId('col-1'))
    expect(byId('host').hasAttribute(HIDDEN_ATTRIBUTE)).toBe(false)
  })

  it('moves to another row by showing what is no longer in the way', () => {
    isolate(byId('root'), byId('col-1'))
    isolate(byId('root'), byId('section-1'))
    expect(hidden()).toEqual(['add-section', 'section-0', 'sidebar', 'tab-buttons', 'title'])
  })

  it('shows everything again for no target', () => {
    isolate(byId('root'), byId('col-1'))
    expect(isolate(byId('root'), null)).toBe(false)
    expect(hidden()).toEqual([])
  })

  it('writes nothing when applied again unchanged', () => {
    isolate(byId('root'), byId('col-1'))
    const writes: string[] = []
    const observer = new MutationObserver((records) => writes.push(...records.map((record) => record.attributeName ?? '')))
    observer.observe(document.body, { attributes: true, subtree: true })
    isolate(byId('root'), byId('col-1'))
    return new Promise<void>((resolve) =>
      setTimeout(() => {
        observer.disconnect()
        expect(writes).toEqual([])
        resolve()
      }),
    )
  })

  it('hides what the form adds next to the row later, once applied again', () => {
    isolate(byId('root'), byId('col-1'))
    const added = document.createElement('div')
    added.id = 'col-2'
    byId('row-0').append(added)
    isolate(byId('root'), byId('col-1'))
    expect(hidden()).toContain('col-2')
  })

  it('does nothing for a target outside the root', () => {
    const outside = document.createElement('div')
    document.body.append(outside)
    expect(isolate(byId('root'), outside)).toBe(false)
    expect(hidden()).toEqual([])
  })
})

describe('isolate, flattening the rows around', () => {
  beforeEach(() => {
    document.body.innerHTML = FORM
  })

  it('marks the way from the outermost row down, and nothing above it', () => {
    isolate(byId('root'), byId('col-1'), byId('section-0'))
    const around = Array.from(document.querySelectorAll(`[${AROUND_ATTRIBUTE}]`), (el) => el.id).sort()
    expect(around).toEqual(['row-0', 'section-0', 'section-0-rows'])
  })

  it('lets go of them with the target', () => {
    isolate(byId('root'), byId('col-1'), byId('section-0'))
    isolate(byId('root'), null)
    expect(document.querySelectorAll(`[${AROUND_ATTRIBUTE}]`)).toHaveLength(0)
  })

  it('takes the vertical space out of everything above the outermost row, and marks the column', () => {
    isolate(byId('root'), byId('col-1'), byId('section-0'))
    const above = Array.from(document.querySelectorAll(`[${ABOVE_ATTRIBUTE}]`), (el) => el.id).sort()
    expect(above).toEqual(['fields', 'sections', 'tab-content', 'tabs'])
    expect(byId('root').hasAttribute(FOCUSING_ATTRIBUTE)).toBe(true)
    isolate(byId('root'), null)
    expect(document.querySelectorAll(`[${ABOVE_ATTRIBUTE}]`)).toHaveLength(0)
    expect(byId('root').hasAttribute(FOCUSING_ATTRIBUTE)).toBe(false)
  })

  it('flattens nothing for an outermost row that is the target itself', () => {
    isolate(byId('root'), byId('section-1'), byId('section-1'))
    expect(document.querySelectorAll(`[${AROUND_ATTRIBUTE}]`)).toHaveLength(0)
  })
})
