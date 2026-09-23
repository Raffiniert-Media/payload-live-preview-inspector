// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCamera } from './camera.js'

/**
 * happy-dom never scrolls - simulate a page whose smooth scroll, like the
 * browser's, heads for the last position it was given and covers part of
 * the way on every frame.
 */
const simulatePage = ({ maxY = 100_000 } = {}) => {
  let y = 0
  let goal = 0
  const scrollTo = vi.fn(({ behavior, top }: ScrollToOptions) => {
    goal = Math.max(0, Math.min(maxY, top ?? 0))
    if (behavior === 'instant') {
      y = goal
    }
  })
  vi.stubGlobal('scrollTo', scrollTo)
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => maxY + window.innerHeight,
  })

  let frame = 0
  const step = () => {
    const left = goal - y
    y = Math.abs(left) < 1 ? goal : y + left * 0.4
    frame = requestAnimationFrame(step)
  }
  frame = requestAnimationFrame(step)

  const element = (docTop: () => number) => {
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({ top: docTop() - y }) as DOMRect)
    return el
  }

  return { element, restore: () => cancelAnimationFrame(frame), scrollTo, y: () => y }
}

let page: ReturnType<typeof simulatePage>

beforeEach(() => {
  page = simulatePage()
})

afterEach(() => {
  page.restore()
  vi.unstubAllGlobals()
})

const camera = (signal = new AbortController().signal) => createCamera({ behavior: 'smooth', offset: 100, signal })

describe('createCamera', () => {
  it('brings the aim to the offset with the browser’s own smooth scroll', async () => {
    const cam = camera()
    cam.aim(page.element(() => 2100))

    await cam.arrived()

    expect(page.y()).toBeCloseTo(2000, 0)
    expect(page.scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 2000 })
  })

  it('bends the motion under way onto a new aim, without waiting for it to end', async () => {
    const cam = camera()
    cam.aim(page.element(() => 2100))
    await cam.near(1500)
    expect(page.y()).toBeGreaterThan(0)

    cam.aim(page.element(() => 5100))
    await cam.arrived()

    expect(page.y()).toBeCloseTo(5000, 0)
  })

  it('follows an aim that moves while the page heads for it', async () => {
    let top = 2100
    const cam = camera()
    cam.aim(page.element(() => top))
    await cam.near(1500)
    top = 3100

    await cam.arrived()

    expect(page.y()).toBeCloseTo(3000, 0)
  })

  it('says when the aim is near, before it has arrived', async () => {
    const cam = camera()
    cam.aim(page.element(() => 4100))

    await cam.near(200)

    expect(page.y()).toBeGreaterThanOrEqual(3800)
    expect(page.y()).toBeLessThan(4000)
  })

  it('stops following on hold - the motion runs out, nothing new is set', async () => {
    let top = 2100
    const cam = camera()
    cam.aim(page.element(() => top))
    await cam.near(1000)
    cam.hold()
    const calls = page.scrollTo.mock.calls.length
    top = 9100

    await cam.arrived()

    expect(page.scrollTo.mock.calls.length).toBe(calls)
    expect(page.y()).toBeCloseTo(2000, 0)
  })

  it('lets go the moment the editor scrolls for themselves', async () => {
    const cam = camera()
    cam.aim(page.element(() => 8100))
    await cam.near(7000)
    const calls = page.scrollTo.mock.calls.length

    window.dispatchEvent(new Event('wheel'))
    await cam.arrived()

    expect(page.scrollTo.mock.calls.length).toBe(calls)
  })

  it('never aims past the end of the page', async () => {
    page.restore()
    page = simulatePage({ maxY: 1500 })
    const cam = camera()
    cam.aim(page.element(() => 4100))

    await cam.arrived()

    expect(page.y()).toBeCloseTo(1500, 0)
    expect(page.scrollTo).toHaveBeenLastCalledWith({ behavior: 'smooth', top: 1500 })
  })

  it('stops when the reveal it belongs to is aborted', async () => {
    const controller = new AbortController()
    const cam = camera(controller.signal)
    cam.aim(page.element(() => 8100))
    const arrived = cam.arrived()

    controller.abort()

    await expect(arrived).resolves.toBeUndefined()
  })

  it('moves at once, without animating, when motion is to be reduced', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const cam = camera()
    cam.aim(page.element(() => 2100))

    await cam.arrived()

    expect(page.scrollTo).toHaveBeenCalledWith({ behavior: 'instant', top: 2000 })
  })
})
