import { describe, expect, it } from 'vitest'

import type { MinimalFormState } from '../../utilities/pathResolution.js'
import type { RowFormAPI } from './rowActions.js'

import { duplicateRow, insertRowBelow, isRowAction, moveRow, removeRow, splitRowPath } from './rowActions.js'

/**
 * A stand-in for Payload's form with the row semantics the actions rely on:
 * rows are a list of ids, every action replaces the state rather than editing
 * it, and `replaceState` puts back whatever it is given.
 */
const fakeForm = (ids: string[]) => {
  let state: MinimalFormState = { layout: { rows: ids.map((id) => ({ id })) } }
  let modified = false
  let counter = 0
  const rows = () => [...(state.layout?.rows ?? [])]
  const set = (next: { id: string }[]) => {
    state = { ...state, layout: { rows: next } }
  }
  const form: RowFormAPI = {
    addFieldRow: ({ rowIndex = rows().length }) => {
      const next = rows()
      next.splice(rowIndex, 0, { id: `new${++counter}` })
      set(next)
      modified = true
    },
    dispatchFields: ({ rowIndex }) => {
      const next = rows()
      next.splice(rowIndex + 1, 0, { id: `${next[rowIndex].id}-copy` })
      set(next)
    },
    getFields: () => state,
    moveFieldRow: ({ moveFromIndex, moveToIndex }) => {
      const next = rows()
      const [moved] = next.splice(moveFromIndex, 1)
      next.splice(moveToIndex, 0, moved)
      set(next)
      modified = true
    },
    removeFieldRow: ({ rowIndex }) => {
      const next = rows()
      next.splice(rowIndex, 1)
      set(next)
      modified = true
    },
    replaceState: (next) => {
      state = next as MinimalFormState
      modified = false
    },
    setModified: (value) => {
      modified = value
    },
  }
  return { form, ids: () => rows().map((row) => row.id), modified: () => modified }
}

describe('splitRowPath', () => {
  it('splits a row path into its field and index', () => {
    expect(splitRowPath('layout.2.rows.10')).toEqual({ fieldPath: 'layout.2.rows', index: 10 })
    expect(splitRowPath('title')).toBeNull()
  })
})

describe('row actions', () => {
  it('moves a row and moves it back', () => {
    const { form, ids, modified } = fakeForm(['a', 'b', 'c'])
    const moved = moveRow(form, 'layout.0', 1)
    expect(ids()).toEqual(['b', 'a', 'c'])
    expect(moved?.path).toBe('layout.1')
    expect(modified()).toBe(true)
    moved?.undo()
    expect(ids()).toEqual(['a', 'b', 'c'])
  })

  it('does not move a row past either end', () => {
    const { form, ids } = fakeForm(['a', 'b'])
    expect(moveRow(form, 'layout.0', -1)).toBeNull()
    expect(moveRow(form, 'layout.1', 1)).toBeNull()
    expect(ids()).toEqual(['a', 'b'])
  })

  it('duplicates a row below itself and takes the copy away again', () => {
    const { form, ids, modified } = fakeForm(['a', 'b'])
    const copy = duplicateRow(form, 'layout.0')
    expect(ids()).toEqual(['a', 'a-copy', 'b'])
    expect(copy?.path).toBe('layout.1')
    expect(modified()).toBe(true)
    copy?.undo()
    expect(ids()).toEqual(['a', 'b'])
  })

  it('removes a row and restores the form exactly, still marked changed', () => {
    const { form, ids, modified } = fakeForm(['a', 'b', 'c'])
    const removed = removeRow(form, 'layout.1')
    expect(ids()).toEqual(['a', 'c'])
    removed?.undo()
    expect(ids()).toEqual(['a', 'b', 'c'])
    // Restored is still different from what was saved - the form must offer saving it.
    expect(modified()).toBe(true)
  })

  it('adds a row below and removes it again', () => {
    const { form, ids } = fakeForm(['a', 'b'])
    const added = insertRowBelow(form, 'layout.0', 'text')
    expect(ids()).toEqual(['a', 'new1', 'b'])
    expect(added?.path).toBe('layout.1')
    added?.undo()
    expect(ids()).toEqual(['a', 'b'])
  })
})

describe('isRowAction', () => {
  it('accepts the toolbar’s actions and nothing else', () => {
    expect(isRowAction('duplicate')).toBe(true)
    expect(isRowAction('drop table')).toBe(false)
    expect(isRowAction(undefined)).toBe(false)
  })
})
