// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'

import { watchDom } from './dom.js'

const Original = globalThis.MutationObserver
let created = 0

afterEach(() => {
  globalThis.MutationObserver = Original
  created = 0
})

const countObservers = () => {
  globalThis.MutationObserver = class extends Original {
    constructor(callback: MutationCallback) {
      super(callback)
      created += 1
    }
  }
}

const frames = () => new Promise((resolve) => setTimeout(resolve, 50))

it('runs every watcher on a root once a frame after changes, from one observer', async () => {
  countObservers()
  const calls = { a: 0, b: 0 }
  const stopA = watchDom(document.body, () => (calls.a += 1))
  const stopB = watchDom(document.body, () => (calls.b += 1))
  expect(created).toBe(1)
  expect(calls).toEqual({ a: 1, b: 1 })

  document.body.append(document.createElement('div'), document.createElement('div'))
  document.body.append(document.createElement('div'))
  await frames()
  expect(calls).toEqual({ a: 2, b: 2 })

  // The last one out stops observing; the next watcher starts afresh.
  stopA()
  stopB()
  document.body.append(document.createElement('div'))
  await frames()
  expect(calls).toEqual({ a: 2, b: 2 })
  const stopC = watchDom(document.body, () => {})
  expect(created).toBe(2)
  stopC()
})
