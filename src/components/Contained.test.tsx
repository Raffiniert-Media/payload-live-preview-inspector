// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { Contained } from './Contained.js'

const Broken: React.FC = () => {
  throw new Error('Payload renamed a class')
}

let container: HTMLElement

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  container.remove()
  vi.restoreAllMocks()
})

it('drops a part of the plugin that throws, and leaves the page around it standing', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const root = createRoot(container)

  act(() => {
    root.render(
      <main>
        <p>Payload’s form</p>
        <Contained name="The editor">
          <Broken />
        </Contained>
      </main>,
    )
  })

  expect(container.textContent).toBe('Payload’s form')
  expect(errors).toHaveBeenCalledWith(
    expect.stringContaining('The editor stopped after an error'),
    expect.objectContaining({ message: 'Payload renamed a class' }),
  )
  act(() => root.unmount())
})

it('renders the part as it is when nothing goes wrong', () => {
  const root = createRoot(container)
  act(() => {
    root.render(
      <Contained name="The editor">
        <p>the editor</p>
      </Contained>,
    )
  })
  expect(container.textContent).toBe('the editor')
  act(() => root.unmount())
})
