import type { MinimalFormState } from './pathResolution.js'

import { pathFromFieldElement } from './pathResolution.js'

/**
 * The slice of Payload's client field config the planner reads - structurally
 * compatible with `ClientField` from `payload`, without depending on it, so
 * this stays a pure, unit-testable module.
 */
export type SchemaField = {
  blockReferences?: (SchemaBlock | string)[]
  blocks?: SchemaBlock[]
  fields?: SchemaField[]
  label?: unknown
  labels?: { singular?: unknown }
  name?: string
  tabs?: SchemaTab[]
  type: string
}

export type SchemaTab = { fields: SchemaField[]; label?: unknown; name?: string }

export type SchemaBlock = { fields: SchemaField[]; labels?: { singular?: unknown }; slug: string }

export type BlocksMap = Record<string, SchemaBlock | undefined>

/**
 * One thing that has to be true in the admin form before a field is on screen.
 *
 * - `tab`: the tabs field `tabs` (identified by its config object *and* the
 *   data path it lives at, because one tabs config renders once per block row
 *   that uses it) must show tab `index`.
 * - `row`: row `index` of the Array/Blocks field at `path` must be expanded.
 * - `collapsible`: the collapsible field rendered with DOM id `id` must be
 *   open. Its state lives in the component, not the form, so it can only be
 *   toggled - and it has to be: Payload keeps a closed collapsible's content
 *   at `display: none`, where the viewport check that mounts fields never
 *   fires, so nothing inside it exists in the DOM until it opens.
 */
export type RevealStep =
  | { id: string; kind: 'collapsible' }
  | { index: number; kind: 'row'; path: string }
  | { index: number; kind: 'tab'; parentPath: string; tabs: SchemaField }

const join = (prefix: string, segment: string): string => (prefix ? `${prefix}.${segment}` : segment)

type Located = { field: SchemaField; steps: RevealStep[] }

/**
 * Payload's index path for an unnamed field at `index` - the same scheme as
 * `getFieldPaths` in `payload`: positions joined by `-`, accumulating through
 * unnamed containers and starting over below every named one.
 */
const childIndexPath = (parentIndexPath: string, index: number): string =>
  parentIndexPath ? `${parentIndexPath}-${index}` : String(index)

/**
 * Finds the field that owns the data key `name` among `fields`, looking
 * through the containers that add no path segment of their own (rows,
 * collapsibles, unnamed groups, unnamed tabs) - and records every tab that
 * has to be active and every collapsible that has to be open on the way.
 */
const locate = (
  fields: SchemaField[],
  name: string,
  parentPath: string,
  parentIndexPath: string = '',
): Located | null => {
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
    const field = fields[fieldIndex]
    const indexPath = childIndexPath(parentIndexPath, fieldIndex)

    if (field.type === 'tabs') {
      const tabs = field.tabs ?? []

      for (let index = 0; index < tabs.length; index++) {
        const tab = tabs[index]
        const step: RevealStep = { index, kind: 'tab', parentPath, tabs: field }

        if (tab.name) {
          if (tab.name === name) {
            return {
              field: { name: tab.name, type: 'group', fields: tab.fields, label: tab.label },
              steps: [step],
            }
          }
          continue
        }

        const inner = locate(tab.fields, name, parentPath, childIndexPath(indexPath, index))
        if (inner) {
          return { field: inner.field, steps: [step, ...inner.steps] }
        }
      }
      continue
    }

    if (!field.name) {
      if (field.fields) {
        const inner = locate(field.fields, name, parentPath, indexPath)
        if (inner) {
          if (field.type !== 'collapsible') {
            return inner
          }
          // The id Payload's collapsible field renders: its unnamed path,
          // dots doubled into underscores.
          const path = join(parentPath, `_index-${indexPath}`)
          return {
            field: inner.field,
            steps: [{ id: `field-collapsible-${path.replace(/\./g, '__')}`, kind: 'collapsible' }, ...inner.steps],
          }
        }
      }
      continue
    }

    if (field.name === name) {
      return { field, steps: [] }
    }
  }

  return null
}

const findBlock = (field: SchemaField, blockType: unknown, blocksMap: BlocksMap): null | SchemaBlock => {
  if (typeof blockType !== 'string') {
    return null
  }

  for (const block of [...(field.blocks ?? []), ...(field.blockReferences ?? [])]) {
    const resolved = typeof block === 'string' ? blocksMap[block] : block
    if (resolved?.slug === blockType) {
      return resolved
    }
  }

  return null
}

export type RevealPlan = {
  /**
   * Whether the schema accounted for the whole path - down to a leaf field
   * (deeper segments pointing into its value) or to the end. `false` when a
   * segment matched no field, e.g. one rendered by a custom component: the
   * steps are then only a prefix and the caller should keep its DOM search.
   */
  complete: boolean
  steps: RevealStep[]
}

/**
 * Everything that has to happen in the admin form before the field at `path`
 * (numeric row indices, as `resolveRowIDs` returns it) can be on screen, in
 * order from the outermost container inward.
 *
 * Read off the collection's field config and the live form state instead of
 * discovered by clicking around the DOM: the config knows which tab holds a
 * field, the form state knows which rows are collapsed and which block type a
 * row has. What the DOM can't tell without trying - is the field in *this*
 * tab? - the schema answers before anything moves.
 *
 * Stops quietly at the first segment the schema can't account for (a path
 * into a rich-text value, a field added by a custom component); the steps up
 * to there are still right, and the caller's DOM-based fallback covers the
 * rest.
 */
export const planReveal = (
  fields: SchemaField[],
  path: string,
  formState: MinimalFormState,
  blocksMap: BlocksMap = {},
): RevealPlan => {
  const { complete, steps } = walk(fields, path, formState, blocksMap)
  return { complete, steps }
}

/**
 * What the path ends at, as the schema has it: the field, and - when the
 * path addresses a whole Array/Blocks row rather than a field in it - that
 * row's index and the block config it uses.
 */
export type RevealTarget = {
  field: SchemaField
  row?: { block?: SchemaBlock; index: number }
}

export const describeTarget = (
  fields: SchemaField[],
  path: string,
  formState: MinimalFormState,
  blocksMap: BlocksMap = {},
): null | RevealTarget => walk(fields, path, formState, blocksMap).target

type Walk = { target: null | RevealTarget } & RevealPlan

const walk = (fields: SchemaField[], path: string, formState: MinimalFormState, blocksMap: BlocksMap): Walk => {
  const segments = path.split('.')
  const steps: RevealStep[] = []
  let currentFields = fields
  let prefix = ''
  let i = 0
  let target: null | RevealTarget = null

  while (i < segments.length) {
    const located = locate(currentFields, segments[i], prefix)
    if (!located) {
      return { complete: false, steps, target }
    }

    steps.push(...located.steps)
    const { field } = located
    target = { field }
    const fieldPath = join(prefix, segments[i])
    i++

    if (field.type === 'array' || field.type === 'blocks') {
      const segment = segments[i]
      if (segment === undefined) {
        break
      }
      if (!/^\d+$/.test(segment)) {
        return { complete: false, steps, target }
      }

      const index = Number(segment)
      steps.push({ index, kind: 'row', path: fieldPath })
      prefix = join(fieldPath, segment)
      i++

      if (field.type === 'array') {
        target = { field, row: { index } }
        currentFields = field.fields ?? []
        continue
      }

      const row = formState[fieldPath]?.rows?.[index]
      const block = findBlock(field, row?.blockType ?? formState[`${prefix}.blockType`]?.value, blocksMap)
      if (!block) {
        return { complete: false, steps, target }
      }
      target = { field, row: { block, index } }
      currentFields = block.fields
      continue
    }

    if (field.type === 'group' && field.fields) {
      currentFields = field.fields
      prefix = fieldPath
      continue
    }

    // A leaf: any further segments point into its value, not into the form.
    break
  }

  return { complete: true, steps, target }
}

/** `metaDescription` → `Meta Description`, the way Payload labels an unlabelled field. */
const humanize = (name: string): string =>
  name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (first) => first.toUpperCase())

/** A config label in the admin's language: a string, or a record of translations. */
const translate = (label: unknown, language: string): string | undefined => {
  if (typeof label === 'string') {
    return label || undefined
  }
  if (label && typeof label === 'object') {
    const translations = label as Record<string, unknown>
    const text = translations[language] ?? translations.en ?? Object.values(translations)[0]
    return typeof text === 'string' ? text : undefined
  }
  return undefined
}

/**
 * The name an editor knows the target by - the label the admin itself shows
 * for it, in the admin's language. A whole row is named the way Payload's own
 * row headers fall back: its block's (or array's) singular label and number.
 */
export const labelOfTarget = (target: RevealTarget, language: string): string => {
  const { field, row } = target
  const fieldLabel = translate(field.label, language) ?? humanize(field.name ?? '')

  if (!row) {
    return fieldLabel
  }

  const rowLabel =
    translate(row.block?.labels?.singular, language) ??
    (row.block ? humanize(row.block.slug) : undefined) ??
    translate(field.labels?.singular, language) ??
    fieldLabel
  return `${rowLabel} ${String(row.index + 1).padStart(2, '0')}`
}

/** Payload's tabs field (see `@payloadcms/ui`'s Tabs field). */
const TABS_FIELD_SELECTOR = '.tabs-field'
export const TAB_BUTTON_CLASS = 'tabs-field__tab-button'
export const TAB_BUTTON_ACTIVE_CLASS = 'tabs-field__tab-button--active'

/** How many fields inside a tabs field to try before giving up on identifying it. */
const MAX_IDENTIFYING_FIELDS = 8

/**
 * The rendered tabs field a `tab` step refers to, or `null` when it isn't in
 * the DOM (yet) or can't be identified.
 *
 * Payload renders tabs fields with no id and no path - nothing on the element
 * says which config it came from. What does say it is the fields rendered in
 * its active tab: they carry their paths, and a field's plan lists the tabs
 * fields around it from the outside in, exactly as its tabs-field ancestors
 * nest in the DOM. So the n-th tabs field around a field (counting outward)
 * is the n-th last tab step of that field's plan.
 *
 * Matching by position rather than by "the plan mentions this tabs field"
 * matters for nesting: an outer tabs field contains the inner one's fields
 * too, and would otherwise pass for it.
 */
export const findTabsElement = (
  step: Extract<RevealStep, { kind: 'tab' }>,
  fields: SchemaField[],
  formState: MinimalFormState,
  blocksMap: BlocksMap = {},
  root: Document | HTMLElement = document,
): HTMLElement | null => {
  for (const tabsEl of Array.from(root.querySelectorAll<HTMLElement>(TABS_FIELD_SELECTOR))) {
    const content = tabsEl.querySelector(':scope > .tabs-field__content-wrap')
    if (!content) {
      continue
    }

    const fieldEls = Array.from(content.querySelectorAll<HTMLElement>('[id^="field-"], [data-field-path]')).slice(
      0,
      MAX_IDENTIFYING_FIELDS,
    )

    for (const fieldEl of fieldEls) {
      const fieldPath = pathFromFieldElement(fieldEl)
      if (!fieldPath) {
        continue
      }

      const tabsAround: Element[] = []
      for (
        let tabs = fieldEl.parentElement?.closest(TABS_FIELD_SELECTOR);
        tabs;
        tabs = tabs.parentElement?.closest(TABS_FIELD_SELECTOR)
      ) {
        tabsAround.push(tabs)
      }

      const tabSteps = planReveal(fields, fieldPath, formState, blocksMap).steps.filter(
        (candidate) => candidate.kind === 'tab',
      )
      // Only a field whose surroundings the schema fully explains can vouch
      // for a tabs field - a custom component rendering tabs of its own
      // would shift every position by one.
      if (tabSteps.length !== tabsAround.length) {
        continue
      }

      const candidate = tabSteps[tabSteps.length - 1 - tabsAround.indexOf(tabsEl)]
      if (candidate.tabs === step.tabs && candidate.parentPath === step.parentPath) {
        return tabsEl
      }
    }
  }

  return null
}

/** The buttons of a rendered tabs field, in config order (hidden tabs included, as Payload renders them). */
export const tabButtonsOf = (tabsEl: HTMLElement): HTMLButtonElement[] =>
  Array.from(
    tabsEl.querySelectorAll<HTMLButtonElement>(
      `:scope > .tabs-field__tabs-wrap > .tabs-field__tabs > .${TAB_BUTTON_CLASS}`,
    ),
  )
