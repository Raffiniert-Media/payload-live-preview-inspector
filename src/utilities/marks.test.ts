// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import { MARK_HOST_ATTRIBUTE } from './markHost.js'
import { createMarks } from './marks.js'

const CLASSES = { flash: 'flash', hover: 'hover', layer: 'layer' }

const at = (el: Element, left: number, top: number, width: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({ bottom: top + height, height, left, right: left + width, top, width, x: left, y: top }) as DOMRect
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('createMarks', () => {
  it('frames the hovered element in the host, a little outside it', () => {
    document.body.innerHTML = '<div id="card"></div>'
    const card = document.getElementById('card')!
    at(card, 40, 280, 150, 200)
    const marks = createMarks(document, CLASSES)

    marks.hover(card)

    const frame = document.querySelector(`[${MARK_HOST_ATTRIBUTE}] .hover`) as HTMLElement
    expect(frame).not.toBeNull()
    expect(frame.style.display).not.toBe('none')
    expect(frame.style.transform).toBe('translate(37px, 277px)')
    expect([frame.style.width, frame.style.height]).toEqual(['156px', '206px'])
    marks.destroy()
  })

  it('takes the frame away when the pointer leaves, and the host with it on destroy', () => {
    document.body.innerHTML = '<div id="card"></div>'
    const card = document.getElementById('card')!
    at(card, 40, 280, 150, 200)
    const marks = createMarks(document, CLASSES)
    marks.hover(card)
    marks.hover(null)

    expect((document.querySelector('.hover') as HTMLElement).style.display).toBe('none')
    marks.destroy()
    expect(document.querySelector(`[${MARK_HOST_ATTRIBUTE}]`)).toBeNull()
  })

  it('draws the flash after a reveal in the host, not on the page', () => {
    document.body.innerHTML = '<p id="text"></p>'
    const text = document.getElementById('text')!
    at(text, 10, 10, 300, 40)
    const marks = createMarks(document, CLASSES)
    marks.flash(text)

    expect(document.querySelector(`[${MARK_HOST_ATTRIBUTE}] .flash`)).not.toBeNull()
    expect(text.style.outline).toBe('')
    marks.destroy()
  })
})
