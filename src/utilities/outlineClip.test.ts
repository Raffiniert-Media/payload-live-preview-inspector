// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { outlineIsClipped } from './outlineClip.js'

/** happy-dom lays nothing out: each element says where it is. */
const at = (el: Element, left: number, top: number, width: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({ bottom: top + height, height, left, right: left + width, top, width, x: left, y: top }) as DOMRect
}

beforeEach(() => {
  document.body.innerHTML = '<div id="outer"><div id="frame"><img id="picture"></div></div>'
  for (const id of ['outer', 'frame', 'picture']) at(document.getElementById(id)!, 0, 0, 2000, 2000)
})

const picture = () => document.getElementById('picture')!
const frame = () => document.getElementById('frame')!

describe('outlineIsClipped', () => {
  it('finds the picture in a rounded box of its own size - the before/after card on the first customer site', () => {
    frame().style.overflow = 'hidden'
    at(frame(), 41, 286, 153, 204)
    at(picture(), 41, 286, 153, 204)

    expect(outlineIsClipped(picture(), 4)).toBe(true)
  })

  it('leaves an outline alone that fits inside the box that clips', () => {
    frame().style.overflow = 'hidden'
    at(frame(), 0, 0, 300, 300)
    at(picture(), 41, 40, 153, 204)

    expect(outlineIsClipped(picture(), 4)).toBe(false)
  })

  it('ignores a box of the same size that does not clip', () => {
    at(frame(), 41, 286, 153, 204)
    at(picture(), 41, 286, 153, 204)

    expect(outlineIsClipped(picture(), 4)).toBe(false)
  })

  it('looks past the nearest box: a slide at the edge of its carousel', () => {
    const outer = document.getElementById('outer')!
    outer.style.overflow = 'hidden'
    at(outer, 0, 0, 1000, 600)
    at(frame(), 0, 100, 310, 238)
    at(picture(), 0, 100, 310, 238)

    expect(outlineIsClipped(picture(), 4)).toBe(true)
  })

  it('counts only the axis that clips', () => {
    frame().style.overflowX = 'hidden'
    at(frame(), 0, 100, 1000, 200)
    at(picture(), 41, 100, 153, 200)

    expect(outlineIsClipped(picture(), 4)).toBe(false)
  })
})
