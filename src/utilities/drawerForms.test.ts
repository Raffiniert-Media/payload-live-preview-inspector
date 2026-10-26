import { describe, expect, it } from 'vitest'

import { drawerForm, registerDrawerForm } from './drawerForms.js'

const form = () => ({ dispatchFields: () => {}, getFields: () => ({}), isModified: () => false })

describe('drawer forms', () => {
  it('holds a drawer’s form while it is registered', () => {
    const first = form()
    const release = registerDrawerForm('drawer-a', first)
    expect(drawerForm('drawer-a')).toBe(first)
    release()
    expect(drawerForm('drawer-a')).toBeUndefined()
  })

  it('lets a later registration stand when an earlier one is taken back - a drawer remounting', () => {
    const before = form()
    const after = form()
    const releaseBefore = registerDrawerForm('drawer-b', before)
    const releaseAfter = registerDrawerForm('drawer-b', after)
    releaseBefore()
    expect(drawerForm('drawer-b')).toBe(after)
    releaseAfter()
    expect(drawerForm('drawer-b')).toBeUndefined()
  })
})
