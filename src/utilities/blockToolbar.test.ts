// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreviewStrings } from './i18n.js'
import type { PreviewRow } from './structure.js'

import { BLOCK_TOOLBAR_ATTRIBUTE, createBlockToolbar, rowRectOf, toolbarPosition } from './blockToolbar.js'
import { LIVE_PREVIEW_PATH_ATTRIBUTE } from './pathAttribute.js'

const classes = {
  frame: 'frame',
  hoverFrame: 'hover',
  label: 'label',
  layer: 'layer',
  toolbar: 'toolbar',
  toolbarButton: 'button',
  toolbarSeparator: 'separator',
}

const strings: PreviewStrings = {
  addBelow: 'Add below',
  duplicate: 'Duplicate',
  editHere: 'Edit',
  moveDown: 'Move down',
  moveUp: 'Move up',
  notInForm: 'Not in this form',
  remove: 'Remove',
  selectParent: 'Select parent',
}

const row = (path: string, overrides: Partial<PreviewRow> = {}): PreviewRow => ({
  abilities: { duplicate: true, insert: true, move: true, remove: true },
  count: 3,
  index: 1,
  label: 'Text 2',
  parent: null,
  path,
  ...overrides,
})

const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

describe('toolbarPosition', () => {
  const size = { height: 34, width: 200 }
  const viewport = { height: 800, width: 1000 }

  it('sits above the row’s top-left corner when there is room', () => {
    expect(toolbarPosition({ bottom: 500, left: 100, top: 300 }, size, viewport)).toEqual({ left: 100, top: 260 })
  })

  it('moves inside the row when the row starts at the top', () => {
    expect(toolbarPosition({ bottom: 500, left: 100, top: 10 }, size, viewport).top).toBe(16)
  })

  it('stays below the page’s sticky header, also for a row scrolled half past it', () => {
    // Header 0-90; the row starts under it.
    expect(toolbarPosition({ bottom: 700, left: 100, top: 60 }, size, viewport, 90).top).toBe(96)
  })

  it('goes below a short row it would otherwise cover, when there is no room above', () => {
    // A heading 60 high right under a 90-high sticky header.
    expect(toolbarPosition({ bottom: 160, left: 100, top: 100 }, size, viewport, 90).top).toBe(166)
    // A tall row keeps it inside its top.
    expect(toolbarPosition({ bottom: 600, left: 100, top: 100 }, size, viewport, 90).top).toBe(106)
  })

  it('never leaves the screen sideways', () => {
    expect(toolbarPosition({ bottom: 500, left: 950, top: 300 }, size, viewport).left).toBe(794)
    expect(toolbarPosition({ bottom: 500, left: -40, top: 300 }, size, viewport).left).toBe(6)
  })
})

describe('rowRectOf', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a"></section>
      <h2 ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$b.heading"></h2>
      <p ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$b.text"></p>
    `
  })

  it('uses the element tagged with the row’s own path', () => {
    const section = document.querySelector('section') as HTMLElement
    section.getBoundingClientRect = () => new DOMRect(10, 20, 300, 400)
    expect(rowRectOf(document, 'layout.$a')).toMatchObject({ height: 400, left: 10, top: 20, width: 300 })
  })

  it('takes the box around what is tagged inside a row that has no element of its own', () => {
    ;(document.querySelector('h2') as HTMLElement).getBoundingClientRect = () => new DOMRect(10, 100, 200, 40)
    ;(document.querySelector('p') as HTMLElement).getBoundingClientRect = () => new DOMRect(30, 150, 300, 60)
    expect(rowRectOf(document, 'layout.$b')).toMatchObject({ height: 110, left: 10, top: 100, width: 320 })
  })

  it('is null for a row with nothing on the page', () => {
    expect(rowRectOf(document, 'layout.$c')).toBeNull()
  })
})

describe('createBlockToolbar', () => {
  let onAction: ReturnType<typeof vi.fn>
  let toolbar: ReturnType<typeof createBlockToolbar>

  beforeEach(() => {
    document.body.innerHTML = `<section ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a"></section>
      <div ${LIVE_PREVIEW_PATH_ATTRIBUTE}="layout.$a.items.$x"></div>`
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${LIVE_PREVIEW_PATH_ATTRIBUTE}]`))) {
      el.getBoundingClientRect = () => new DOMRect(10, 200, 300, 100)
    }
    onAction = vi.fn()
    toolbar = createBlockToolbar(document, classes, { onAction })
  })

  afterEach(() => toolbar.destroy())

  const buttons = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>(`[${BLOCK_TOOLBAR_ATTRIBUTE}] button`)).map(
      (button) => `${button.dataset.action}${button.disabled ? ' (off)' : ''}`,
    )

  it('shows nothing until the admin has said which rows there are', async () => {
    toolbar.select('layout.$a')
    await frames()
    expect(buttons()).toEqual([])
  })

  it('offers what the row allows, by its place among its siblings', async () => {
    toolbar.setStructure([row('layout.$a', { index: 0 }), row('layout.$a.items.$x', { parent: 'layout.$a' })], strings)
    toolbar.select('layout.$a')
    await frames()
    // The first row cannot move up and has no row around it.
    expect(buttons()).toEqual(['edit', 'up (off)', 'down', 'duplicate', 'insert', 'remove'])

    toolbar.select('layout.$a.items.$x')
    await frames()
    expect(buttons()).toEqual(['edit', 'select', 'up', 'down', 'duplicate', 'insert', 'remove'])
  })

  it('turns off what the admin does not allow', async () => {
    toolbar.setStructure(
      [row('layout.$a', { abilities: { duplicate: false, insert: false, move: false, remove: false } })],
      strings,
    )
    toolbar.select('layout.$a')
    await frames()
    expect(buttons()).toEqual(['edit', 'up (off)', 'down (off)', 'duplicate (off)', 'insert (off)', 'remove (off)'])
  })

  it('asks the admin, and steps out to the row around it itself', async () => {
    toolbar.setStructure([row('layout.$a'), row('layout.$a.items.$x', { parent: 'layout.$a' })], strings)
    toolbar.select('layout.$a.items.$x')
    await frames()
    const click = (action: string) =>
      (document.querySelector(`[${BLOCK_TOOLBAR_ATTRIBUTE}] button[data-action="${action}"]`) as HTMLButtonElement).click()

    click('down')
    expect(onAction).toHaveBeenLastCalledWith('down', 'layout.$a.items.$x')
    click('select')
    expect(onAction).toHaveBeenLastCalledWith('select', 'layout.$a')
    await frames()
    // Now on the outer row, with its own buttons.
    expect(buttons()[0]).toBe('edit')
    expect(buttons()).not.toContain('select')
  })

  it('names the row in the admin’s words', async () => {
    toolbar.setStructure([row('layout.$a', { label: 'Abschnitt 2', summary: 'Willkommen' })], strings)
    toolbar.select('layout.$a')
    await frames()
    const label = document.querySelector(`[${BLOCK_TOOLBAR_ATTRIBUTE}] button[data-action="edit"]`) as HTMLButtonElement
    expect(label.textContent).toBe('Abschnitt 2')
    expect(label.title).toBe('Abschnitt 2 · Willkommen')
  })

  it('claims its own elements, and only those', () => {
    toolbar.select('layout.$a')
    const own = document.querySelector(`[${BLOCK_TOOLBAR_ATTRIBUTE}]`)
    expect(toolbar.owns(own)).toBe(true)
    expect(toolbar.owns(document.querySelector('section'))).toBe(false)
  })

  it('leaves nothing behind', () => {
    toolbar.destroy()
    expect(document.querySelector(`[${BLOCK_TOOLBAR_ATTRIBUTE}]`)).toBeNull()
  })
})
