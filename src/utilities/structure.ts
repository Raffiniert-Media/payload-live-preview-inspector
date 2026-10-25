import type { MinimalFormState } from './pathResolution.js'
import type { BlocksMap, SchemaField } from './revealPlan.js'

import { humanize, translateLabel } from './i18n.js'
import { rowIDSegment } from './pathAttribute.js'
import { findBlock } from './revealPlan.js'

/**
 * The document as an editor thinks of it: sections, the rows in them, the
 * columns in those, the components in the columns - every Array and Blocks row,
 * nested the way the form nests them, named the way the form names them.
 *
 * Read off the field config and the live form state, like the reveal plan, so
 * it does not depend on which rows Payload happens to have rendered: a row
 * three levels down inside closed sections is in the outline as soon as it is
 * in the document.
 *
 * Pure, so the outline panel, the path bar and the preview's block toolbar all
 * describe the same tree, and the tests can hold it without a browser.
 */

/** What may be done to a row from outside the form - the preview's toolbar, the outline. */
export type RowAbilities = {
  duplicate: boolean
  insert: boolean
  move: boolean
  remove: boolean
}

export type OutlineNode = {
  abilities: RowAbilities
  /** The block's slug, for a Blocks row. */
  blockType?: string
  children: OutlineNode[]
  /** Rows in the Array/Blocks field this row belongs to. */
  count: number
  /** Nesting level, 0 for a row of a top-level field. */
  depth: number
  /** The Array/Blocks field holding the row, by index path (`layout.2.rows`). */
  fieldPath: string
  /** Some field inside the row fails validation. */
  hasErrors: boolean
  index: number
  /** What kind of row it is: the block's or the array's singular label (`Abschnitt`). */
  kind: string
  /** `Abschnitt 3` - its kind and number, as Payload's own row headers fall back to. */
  label: string
  parent: null | OutlineNode
  /** Index path (`layout.2.rows.0`) - what the form state and the DOM use today. */
  path: string
  /** The same row by row ids (`layout.$a1.rows.$b2`) - what survives moving it. */
  rowIDPath: string
  /** Words from inside the row to recognise it by: its block name, or the first text it holds. */
  summary?: string
}

export type OutlineGroup = {
  /** Index path of the top-level Array/Blocks field. */
  fieldPath: string
  /** The field's label (`Abschnitte`). */
  label: string
  nodes: OutlineNode[]
}

export type Outline = {
  byPath: Map<string, OutlineNode>
  byRowIDPath: Map<string, OutlineNode>
  groups: OutlineGroup[]
}

export type OutlineOptions = {
  blocksMap?: BlocksMap
  /** The admin's language, for labels configured per language. */
  language?: string
  /**
   * Payload's field permissions for the document (`docPermissions.fields`):
   * rows of a field the user may not update offer nothing. Left out, every
   * field counts as allowed - Payload checks on save either way.
   */
  permissions?: FieldPermissions
  /** The whole form is read-only: nothing may be moved, added or removed. */
  readOnly?: boolean
}

/**
 * Payload's sanitized field permissions, as far as the outline reads them:
 * `true` allows everything below it, a field missing from an object is not
 * allowed at all.
 */
export type FieldPermissions = { [name: string]: FieldPermission } | true
type FieldPermission =
  | {
      blocks?: { [slug: string]: { fields?: FieldPermissions } | true } | true
      create?: boolean
      fields?: FieldPermissions
      read?: boolean
      update?: boolean
    }
  | true

/** No permissions given: everything allowed, as before permissions were read. */
const permissionOf = (permissions: FieldPermissions | undefined, name: string): FieldPermission | undefined =>
  permissions === undefined || permissions === true ? true : permissions[name]

const mayUpdate = (permission: FieldPermission | undefined): boolean =>
  permission === true || permission?.update === true

/**
 * What the fields inside a field - a group's, an array row's, the rows of a
 * block - may do. Lenient where Payload leaves a part out of an allowed field.
 */
const permissionsWithin = (permission: FieldPermission | undefined, blockSlug?: string): FieldPermissions => {
  if (permission === true) {
    return true
  }
  if (blockSlug !== undefined && permission?.blocks !== undefined) {
    const block = permission.blocks === true ? true : permission.blocks[blockSlug]
    return block === true ? true : (block?.fields ?? {})
  }
  return permission?.fields ?? (permission?.update === true ? true : {})
}

/** Longest summary, in characters. */
const SUMMARY_MAX = 60

/** Field types whose value is text an editor wrote. */
const TEXT_TYPES = new Set(['email', 'richText', 'text', 'textarea'])

/** Names of text fields that hold something technical rather than content. */
const TECHNICAL_NAMES = new Set(['anchor', 'class', 'className', 'href', 'id', 'key', 'slug', 'url'])

const join = (prefix: string, segment: string): string => (prefix ? `${prefix}.${segment}` : segment)

const isVisible = (field: SchemaField): boolean => !field.admin?.hidden && !field.admin?.disabled

/** The text of a Lexical editor state, as far as it goes up to `max` characters. */
export const textOfRichText = (value: unknown, max = SUMMARY_MAX * 2): string => {
  const parts: string[] = []
  let length = 0
  const visit = (node: unknown) => {
    if (length >= max || !node || typeof node !== 'object') {
      return
    }
    const { children, text } = node as { children?: unknown[]; text?: unknown }
    if (typeof text === 'string' && text.trim()) {
      parts.push(text)
      length += text.length
    }
    if (Array.isArray(children)) {
      for (const child of children) {
        visit(child)
      }
    }
  }
  visit((value as { root?: unknown } | null | undefined)?.root ?? value)
  return parts.join(' ')
}

/** Whitespace collapsed, shortened at a word to `SUMMARY_MAX`. */
export const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= SUMMARY_MAX) {
    return flat
  }
  const cut = flat.slice(0, SUMMARY_MAX)
  const atWord = cut.lastIndexOf(' ')
  return `${(atWord > SUMMARY_MAX * 0.6 ? cut.slice(0, atWord) : cut).trimEnd()}…`
}

/** A value that is an address rather than words. */
const looksTechnical = (text: string): boolean => /^(?:https?:|mailto:|tel:|\/|#|www\.)/i.test(text.trim())

type Ctx = {
  blocksMap: BlocksMap
  formState: MinimalFormState
  invalid: string[]
  language: string
  /** `undefined` when the caller passed none: everything allowed. */
  permissions: FieldPermissions | undefined
  readOnly: boolean
}

/** The fields a row of `field` has: its block's for a Blocks row, its own for an Array row. */
const rowFieldsOf = (field: SchemaField, path: string, index: number, ctx: Ctx) => {
  if (field.type === 'array') {
    return { block: null, fields: field.fields ?? [] }
  }
  const row = ctx.formState[path]?.rows?.[index]
  const block = findBlock(field, row?.blockType ?? ctx.formState[`${path}.${index}.blockType`]?.value, ctx.blocksMap)
  return { block, fields: block?.fields ?? [] }
}

/**
 * The first words an editor wrote inside `fields`, in the order the form shows
 * them. Rows are only looked into when `intoRows` - a section's own heading is
 * a better name for it than the first paragraph three levels down, but that
 * paragraph is better than nothing.
 */
const firstText = (fields: SchemaField[], path: string, ctx: Ctx, intoRows: boolean, depth = 0): string | undefined => {
  for (const field of fields) {
    if (!isVisible(field)) {
      continue
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) {
        const found = firstText(tab.fields, tab.name ? join(path, tab.name) : path, ctx, intoRows, depth)
        if (found) {
          return found
        }
      }
      continue
    }
    if (!field.name) {
      const found = field.fields ? firstText(field.fields, path, ctx, intoRows, depth) : undefined
      if (found) {
        return found
      }
      continue
    }

    const fieldPath = join(path, field.name)
    if (ctx.formState[fieldPath]?.passesCondition === false) {
      continue
    }

    if (field.type === 'group' && field.fields) {
      const found = firstText(field.fields, fieldPath, ctx, intoRows, depth)
      if (found) {
        return found
      }
      continue
    }

    if ((field.type === 'array' || field.type === 'blocks') && intoRows && depth < 6) {
      const rows = ctx.formState[fieldPath]?.rows ?? []
      for (let index = 0; index < rows.length; index++) {
        const { fields: rowFields } = rowFieldsOf(field, fieldPath, index, ctx)
        const found = firstText(rowFields, `${fieldPath}.${index}`, ctx, true, depth + 1)
        if (found) {
          return found
        }
      }
      continue
    }

    if (!TEXT_TYPES.has(field.type) || TECHNICAL_NAMES.has(field.name)) {
      continue
    }
    const value = ctx.formState[fieldPath]?.value
    const text = field.type === 'richText' ? textOfRichText(value) : typeof value === 'string' ? value : ''
    if (text.trim() && !looksTechnical(text)) {
      return shorten(text)
    }
  }
  return undefined
}

const kindOf = (field: SchemaField, block: ReturnType<typeof rowFieldsOf>['block'], blockType: unknown, ctx: Ctx) => {
  if (field.type === 'blocks') {
    return (
      translateLabel(block?.labels?.singular, ctx.language) ??
      humanize(block?.slug ?? (typeof blockType === 'string' ? blockType : 'Block'))
    )
  }
  return (
    translateLabel(field.labels?.singular, ctx.language) ??
    translateLabel(field.label, ctx.language) ??
    humanize(field.name ?? 'Row')
  )
}

/**
 * Read-only reaches everything inside, the way Payload renders it: a field in
 * a read-only group, collapsible, row or array is read-only too, whatever its
 * own config says.
 */
const lockedCtx = (ctx: Ctx): Ctx => (ctx.readOnly ? ctx : { ...ctx, readOnly: true })
const within = (field: SchemaField, ctx: Ctx): Ctx => (field.admin?.readOnly === true ? lockedCtx(ctx) : ctx)

const rowsOf = (
  field: SchemaField,
  fieldPath: string,
  fieldIDPath: string,
  ctx: Ctx,
  parent: null | OutlineNode,
  depth: number,
  outline: Outline,
  permission: FieldPermission | undefined,
): OutlineNode[] => {
  const rows = ctx.formState[fieldPath]?.rows ?? []
  const locked = ctx.readOnly || field.admin?.readOnly === true || !mayUpdate(permission)
  const count = rows.length

  return rows.map((row, index) => {
    const path = `${fieldPath}.${index}`
    const rowIDPath = `${fieldIDPath}.${rowIDSegment(row.id)}`
    const { block, fields } = rowFieldsOf(field, fieldPath, index, ctx)
    const blockType = field.type === 'blocks' ? (row.blockType ?? block?.slug) : undefined
    const kind = kindOf(field, block, blockType, ctx)
    const blockName = ctx.formState[`${path}.blockName`]?.value

    const node: OutlineNode = {
      abilities: {
        duplicate: !locked && (field.maxRows === undefined || count < field.maxRows),
        insert: !locked && (field.maxRows === undefined || count < field.maxRows),
        move: !locked && field.admin?.isSortable !== false && count > 1,
        remove: !locked && count > (field.minRows ?? 0),
      },
      blockType,
      children: [],
      count,
      depth,
      fieldPath,
      hasErrors: ctx.invalid.some((invalid) => invalid === path || invalid.startsWith(`${path}.`)),
      index,
      kind,
      label: `${kind} ${index + 1}`,
      parent,
      path,
      rowIDPath,
    }

    outline.byPath.set(path, node)
    outline.byRowIDPath.set(rowIDPath, node)
    const inside = { ...ctx, permissions: ctx.permissions && permissionsWithin(permission, block?.slug) }
    collect(fields, path, rowIDPath, locked ? lockedCtx(inside) : inside, node, depth + 1, outline)

    node.summary =
      (typeof blockName === 'string' && blockName.trim() ? shorten(blockName) : undefined) ??
      firstText(fields, path, ctx, false) ??
      firstText(fields, path, ctx, true)
    return node
  })
}

/**
 * Walks `fields` for Array and Blocks fields, through every container that has
 * no row of its own - tabs, collapsibles, rows, groups - and hangs their rows
 * under `parent`, or, at the top, starts a group per field.
 */
const collect = (
  fields: SchemaField[],
  path: string,
  idPath: string,
  ctx: Ctx,
  parent: null | OutlineNode,
  depth: number,
  outline: Outline,
): void => {
  for (const field of fields) {
    if (!isVisible(field)) {
      continue
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) {
        collect(
          tab.fields,
          tab.name ? join(path, tab.name) : path,
          tab.name ? join(idPath, tab.name) : idPath,
          tab.name && ctx.permissions ? { ...ctx, permissions: permissionsWithin(permissionOf(ctx.permissions, tab.name)) } : ctx,
          parent,
          depth,
          outline,
        )
      }
      continue
    }
    if (!field.name) {
      if (field.fields) {
        collect(field.fields, path, idPath, within(field, ctx), parent, depth, outline)
      }
      continue
    }

    const fieldPath = join(path, field.name)
    const fieldIDPath = join(idPath, field.name)
    if (ctx.formState[fieldPath]?.passesCondition === false) {
      continue
    }

    const permission = permissionOf(ctx.permissions, field.name)
    if (field.type === 'group' && field.fields) {
      const inside = ctx.permissions ? { ...ctx, permissions: permissionsWithin(permission) } : ctx
      collect(field.fields, fieldPath, fieldIDPath, within(field, inside), parent, depth, outline)
      continue
    }
    if (field.type !== 'array' && field.type !== 'blocks') {
      continue
    }

    const nodes = rowsOf(field, fieldPath, fieldIDPath, ctx, parent, depth, outline, permission)
    if (parent) {
      parent.children.push(...nodes)
    } else {
      outline.groups.push({
        fieldPath,
        label:
          translateLabel(field.label, ctx.language) ??
          translateLabel(field.labels?.plural, ctx.language) ??
          humanize(field.name),
        nodes,
      })
    }
  }
}

export const buildOutline = (
  fields: SchemaField[],
  formState: MinimalFormState,
  { blocksMap = {}, language = 'en', permissions, readOnly = false }: OutlineOptions = {},
): Outline => {
  const outline: Outline = { byPath: new Map(), byRowIDPath: new Map(), groups: [] }
  const invalid = Object.entries(formState).flatMap(([path, entry]) => (entry?.valid === false ? [path] : []))
  collect(fields, '', '', { blocksMap, formState, invalid, language, permissions, readOnly }, null, 0, outline)
  return outline
}

/** The rows from the outermost down to `node`. */
export const chainOf = (node: null | OutlineNode | undefined): OutlineNode[] => {
  const chain: OutlineNode[] = []
  for (let current = node; current; current = current.parent) {
    chain.unshift(current)
  }
  return chain
}

/**
 * The row a field path lies in - the deepest prefix that is an Array/Blocks row
 * - or `null` for a field outside every row. Index paths only: a numeric
 * segment counts when the form state has rows at the prefix before it, which
 * is what keeps `richText.root.children.0` from passing for one.
 */
export const rowPathOf = (path: string, formState: MinimalFormState): null | string => {
  const segments = path.split('.')
  for (let end = segments.length; end > 1; end--) {
    if (/^\d+$/.test(segments[end - 1]) && formState[segments.slice(0, end - 1).join('.')]?.rows) {
      return segments.slice(0, end).join('.')
    }
  }
  return null
}

/** The same for a path addressed by row ids, as the preview tags elements - see `pathAttribute.ts`. */
export { rowIDPathOf } from './pathAttribute.js'

/** One row as the preview's toolbar needs it - plain data, for `postMessage`. */
export type PreviewRow = {
  abilities: RowAbilities
  count: number
  index: number
  label: string
  parent: null | string
  path: string
  summary?: string
}

export const previewRowsOf = (outline: Outline): PreviewRow[] =>
  Array.from(outline.byRowIDPath.values(), (node) => ({
    abilities: node.abilities,
    count: node.count,
    index: node.index,
    label: node.label,
    parent: node.parent?.rowIDPath ?? null,
    path: node.rowIDPath,
    summary: node.summary,
  }))

/** Every node, depth first, in the order the form shows them. */
export const flattenOutline = (outline: Outline): OutlineNode[] => {
  const all: OutlineNode[] = []
  const visit = (nodes: OutlineNode[]) => {
    for (const node of nodes) {
      all.push(node)
      visit(node.children)
    }
  }
  for (const group of outline.groups) {
    visit(group.nodes)
  }
  return all
}

/**
 * A short fingerprint of what the outline shows, to tell whether a form change
 * changed it at all - most keystrokes do not.
 */
export const outlineSignature = (outline: Outline): string =>
  flattenOutline(outline)
    .map(
      (node) =>
        `${node.rowIDPath}|${node.label}|${node.summary ?? ''}|${node.hasErrors ? 1 : 0}|${node.count}|${Object.values(node.abilities).join('')}`,
    )
    .join('\n')
