// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { editMainEl, missingLandmarks } from './payloadAdmin.js'

/** Payload's edit view with the inline live preview open, as far as the editor cares. */
const editView = `
  <div class="collection-edit collection-edit--is-live-previewing">
    <div class="doc-controls"></div>
    <div class="collection-edit__main-wrapper">
      <div class="collection-edit__main"></div>
      <div class="live-preview-window">
        <div class="live-preview-toolbar"><div class="live-preview-toolbar-controls"></div></div>
        <div class="live-preview-window__main"></div>
      </div>
    </div>
  </div>`

describe('missingLandmarks', () => {
  beforeEach(() => {
    document.body.innerHTML = editView
  })

  it('is empty on the edit view the plugin knows', () => {
    expect(missingLandmarks({ livePreview: true })).toEqual([])
  })

  it('names what a renamed class took away', () => {
    document.querySelector('.live-preview-toolbar')!.className = 'live-preview-bar'
    expect(missingLandmarks({ livePreview: true })).toEqual(['live-preview-toolbar'])
  })

  it('does not ask for the preview while it is closed', () => {
    document.querySelector('.live-preview-window')!.remove()
    expect(missingLandmarks({ livePreview: false })).toEqual([])
    expect(missingLandmarks({ livePreview: true })).toEqual([
      'live-preview-window',
      'live-preview-window__main',
      'live-preview-toolbar',
      'live-preview-toolbar-controls',
    ])
  })
})

describe('landmark lookups', () => {
  beforeEach(() => {
    document.body.innerHTML = editView
  })

  it('keep the element while it is on the page, and look again once it is not', () => {
    const first = editMainEl()
    expect(first).toBe(document.querySelector('.collection-edit__main'))

    // Payload remounts the form: a new element, the old one gone.
    const replacement = document.createElement('div')
    replacement.className = 'collection-edit__main'
    first!.replaceWith(replacement)
    expect(editMainEl()).toBe(replacement)

    // A class Payload takes away is a landmark gone.
    replacement.className = 'something-else'
    expect(editMainEl()).toBeNull()
  })

  /*
   * With Next's `cacheComponents` the edit view navigated away from stays in
   * the document, hidden by React's `<Activity>`, beside the one on screen.
   * Red with the 2.1.2 lookup: the form column kept from before (and, first
   * in the document, the one a query finds) was the hidden one.
   */
  it('pass over an edit view a route keeps for the way back', () => {
    const left = editMainEl()!
    const leftView = document.querySelector<HTMLElement>('.collection-edit')!
    leftView.style.setProperty('display', 'none', 'important')
    document.body.insertAdjacentHTML('beforeend', editView)
    const onScreen = document.querySelectorAll('.collection-edit__main')[1]
    expect(onScreen).not.toBe(left)
    expect(editMainEl()).toBe(onScreen)

    // Kept before the one on screen in the document, too.
    document.body.prepend(leftView)
    expect(document.querySelector('.collection-edit__main')).toBe(left)
    expect(editMainEl()).toBe(onScreen)

    // Back to it: the one on screen again.
    leftView.style.removeProperty('display')
    onScreen.closest<HTMLElement>('.collection-edit')!.style.setProperty('display', 'none', 'important')
    expect(editMainEl()).toBe(left)
  })

  it('keep a form column hidden any other way - page mode folds it away on a narrow screen', () => {
    const main = editMainEl()!
    main.style.display = 'none'
    expect(editMainEl()).toBe(main)
  })
})
