import type { MinimalFormState } from '../../utilities/pathResolution.js'

/** What the preview's block toolbar can ask the admin to do with a row. */
export type RowAction = 'down' | 'duplicate' | 'edit' | 'insert' | 'remove' | 'select' | 'up'

export const ROW_ACTIONS: readonly RowAction[] = ['duplicate', 'down', 'edit', 'insert', 'remove', 'select', 'up']

export const isRowAction = (value: unknown): value is RowAction =>
  typeof value === 'string' && (ROW_ACTIONS as readonly string[]).includes(value)

/** A row by index path, split into the field holding it and its place there: `layout.2` → `layout`, 2. */
export const splitRowPath = (path: string): { fieldPath: string; index: number } | null => {
  const match = /^(.+)\.(\d+)$/.exec(path)
  return match ? { fieldPath: match[1], index: Number(match[2]) } : null
}

/** The part of Payload's form API a row action uses - `useForm()` has all of it. */
export type RowFormAPI = {
  addFieldRow: (args: { blockType?: string; path: string; rowIndex?: number; schemaPath: string }) => void
  dispatchFields: (action: { path: string; rowIndex: number; type: 'DUPLICATE_ROW' }) => void
  getFields: () => MinimalFormState
  moveFieldRow: (args: { moveFromIndex: number; moveToIndex: number; path: string }) => void
  removeFieldRow: (args: { path: string; rowIndex: number }) => void
  replaceState: (state: never) => void
  setModified: (modified: boolean) => void
}

/** How to take a row action back. */
export type Undo = () => void

/**
 * Moves a row one place up or down - what Payload's own row menu does, through
 * the same form API, so the form is marked changed and saved like any edit.
 * `null` when the row is already at that end.
 */
export const moveRow = (form: RowFormAPI, path: string, direction: -1 | 1): { path: string; undo: Undo } | null => {
  const row = splitRowPath(path)
  const count = row ? (form.getFields()[row.fieldPath]?.rows?.length ?? 0) : 0
  if (!row || row.index + direction < 0 || row.index + direction >= count) {
    return null
  }
  const to = row.index + direction
  form.moveFieldRow({ moveFromIndex: row.index, moveToIndex: to, path: row.fieldPath })
  return {
    path: `${row.fieldPath}.${to}`,
    undo: () => form.moveFieldRow({ moveFromIndex: to, moveToIndex: row.index, path: row.fieldPath }),
  }
}

/** Duplicates a row right below itself, as Payload's "Duplicate" does. */
export const duplicateRow = (form: RowFormAPI, path: string): { path: string; undo: Undo } | null => {
  const row = splitRowPath(path)
  if (!row) {
    return null
  }
  form.dispatchFields({ type: 'DUPLICATE_ROW', path: row.fieldPath, rowIndex: row.index })
  form.setModified(true)
  const copy = row.index + 1
  return {
    path: `${row.fieldPath}.${copy}`,
    undo: () => form.removeFieldRow({ path: row.fieldPath, rowIndex: copy }),
  }
}

/**
 * Removes a row. Taken back by restoring the whole form as it was, the way
 * Payload's own paste replaces it: a removed row's fields, nested rows and
 * their state are gone from the form, and rebuilding them piece by piece is
 * what that restore already does in one step.
 */
export const removeRow = (form: RowFormAPI, path: string): { undo: Undo } | null => {
  const row = splitRowPath(path)
  if (!row) {
    return null
  }
  const before = form.getFields()
  form.removeFieldRow({ path: row.fieldPath, rowIndex: row.index })
  return {
    undo: () => {
      form.replaceState(before as never)
      form.setModified(true)
    },
  }
}

/** Adds a row below `path` - of `blockType` in a Blocks field, an empty one in an Array. */
export const insertRowBelow = (
  form: RowFormAPI,
  path: string,
  blockType?: string,
): { path: string; undo: Undo } | null => {
  const row = splitRowPath(path)
  if (!row) {
    return null
  }
  const at = row.index + 1
  // `schemaPath` is part of the signature and unused by the form itself; the
  // server fills the new row's fields on the next form-state round.
  form.addFieldRow({ blockType, path: row.fieldPath, rowIndex: at, schemaPath: row.fieldPath.replace(/\.\d+/g, '') })
  return {
    path: `${row.fieldPath}.${at}`,
    undo: () => form.removeFieldRow({ path: row.fieldPath, rowIndex: at }),
  }
}
