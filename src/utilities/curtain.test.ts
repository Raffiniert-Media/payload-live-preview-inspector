// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { drawCurtain, openingAreaOf, tabContentOf, visibleRowsAfter } from './curtain.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('drawCurtain', () => {
  it('hides an area until it is lifted, then leaves no trace', () => {
    const el = document.createElement('div')
    const curtain = drawCurtain(el)
    expect(el.style.opacity).toBe('0')

    curtain.lift()
    curtain.lift()

    expect(el.style.opacity).toBe('')
  })

  it('is harmless on nothing', () => {
    expect(() => drawCurtain(null).lift()).not.toThrow()
  })
})

describe('where curtains go', () => {
  it('finds a row’s opening box and a tabs field’s content', () => {
    document.body.innerHTML = `
      <div class="collapsible"><div class="collapsible__toggle-wrap"></div><div id="box" class="rah-static"></div></div>
      <div class="tabs-field"><div class="tabs-field__tabs-wrap"></div><div id="content" class="tabs-field__content-wrap"></div></div>`

    expect(openingAreaOf(document.querySelector('.collapsible'))?.id).toBe('box')
    expect(tabContentOf(document.querySelector('.tabs-field'))?.id).toBe('content')
  })

  it('takes the closed rows after a row that are on screen - never an open one, nor any below the fold', () => {
    const row = (id: string, collapsed: boolean) =>
      `<div id="${id}"><div class="collapsible${collapsed ? ' collapsible--collapsed' : ''}"></div></div>`
    document.body.innerHTML = row('r0', true) + row('r1', true) + row('r2', false) + row('r3', true) + row('r4', true)
    const tops: Record<string, number> = { r0: 100, r1: 300, r2: 400, r3: 600, r4: 5000 }
    for (const el of Array.from(document.body.children)) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: tops[el.id] } as DOMRect)
    }

    expect(visibleRowsAfter(document.getElementById('r0')).map((el) => el.id)).toEqual(['r1', 'r3'])
  })
})
