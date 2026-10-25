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
})
