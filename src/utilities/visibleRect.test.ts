// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { visibleRectOf } from './visibleRect.js'

/** happy-dom lays nothing out: each element says where it is. */
const at = (el: Element, left: number, top: number, width: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({ bottom: top + height, height, left, right: left + width, top, width, x: left, y: top }) as DOMRect
}
const byId = (id: string) => document.getElementById(id)!

beforeEach(() => {
  document.body.innerHTML = '<div id="outer"><div id="box"><div id="el"></div></div></div>'
  for (const id of ['outer', 'box', 'el']) {at(byId(id), 0, 0, 1000, 700)}
})

describe('visibleRectOf', () => {
  it('is the whole element where nothing clips it', () => {
    at(byId('el'), 40, 280, 150, 200)
    expect(visibleRectOf(byId('el'))).toEqual({ bottom: 480, left: 40, right: 190, top: 280 })
  })

  it('is cut by every box that clips - the half of a slide outside its carousel', () => {
    byId('outer').style.overflow = 'hidden'
    at(byId('outer'), 100, 0, 600, 700)
    at(byId('el'), 40, 280, 150, 200)
    expect(visibleRectOf(byId('el'))).toEqual({ bottom: 480, left: 100, right: 190, top: 280 })
  })

  it('cuts only along the axis that clips', () => {
    byId('box').style.overflowX = 'hidden'
    at(byId('box'), 100, 300, 600, 50)
    at(byId('el'), 40, 280, 150, 200)
    expect(visibleRectOf(byId('el'))).toEqual({ bottom: 480, left: 100, right: 190, top: 280 })
  })

  it('lets an absolute box escape the static boxes it is in, not its positioned one', () => {
    byId('box').style.overflow = 'hidden'
    at(byId('box'), 100, 300, 50, 50)
    byId('outer').style.overflow = 'hidden'
    byId('outer').style.position = 'relative'
    at(byId('outer'), 0, 0, 170, 700)
    byId('el').style.position = 'absolute'
    at(byId('el'), 40, 280, 150, 200)
    expect(visibleRectOf(byId('el'))).toEqual({ bottom: 480, left: 40, right: 170, top: 280 })
  })

  it('lets a fixed box escape every box it is in', () => {
    byId('box').style.overflow = 'hidden'
    at(byId('box'), 100, 300, 50, 50)
    byId('el').style.position = 'fixed'
    at(byId('el'), 40, 280, 150, 200)
    expect(visibleRectOf(byId('el'))).toEqual({ bottom: 480, left: 40, right: 190, top: 280 })
  })

  it('is nothing when nothing of it shows', () => {
    byId('box').style.overflow = 'hidden'
    at(byId('box'), 500, 0, 100, 100)
    at(byId('el'), 40, 280, 150, 200)
    expect(visibleRectOf(byId('el'))).toBeNull()
  })
})
