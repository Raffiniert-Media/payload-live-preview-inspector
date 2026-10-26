// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import type { SchemaField } from './revealPlan.js'

import {
  describeTarget,
  findTabsElement,
  formFieldPathOf,
  labelOfTarget,
  planReveal,
  relatedDocumentAt,
  tabButtonsOf,
} from './revealPlan.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

const text = (name: string): SchemaField => ({ name, type: 'text' })

/** Nested tabs inside a block row, inside an unnamed root tabs field - the shape a sweep handles worst. */
const sectionTabs: SchemaField = {
  type: 'tabs',
  tabs: [
    { fields: [text('heading')] },
    { name: 'style', fields: [text('variant')] },
  ],
}

const rootTabs: SchemaField = {
  type: 'tabs',
  tabs: [
    {
      fields: [
        text('title'),
        {
          name: 'layout',
          type: 'blocks',
          blocks: [
            { slug: 'hero', fields: [text('heading')] },
            { slug: 'section', fields: [sectionTabs] },
          ],
        },
      ],
    },
    {
      fields: [
        { type: 'row', fields: [text('metaNote')] },
        {
          type: 'collapsible',
          fields: [{ name: 'faq', type: 'array', fields: [{ name: 'items', type: 'array', fields: [text('q')] }] }],
        },
      ],
    },
  ],
}

const fields: SchemaField[] = [rootTabs]

const formState = {
  faq: { rows: [{ id: 'f0' }, { id: 'f1', collapsed: true }] },
  'faq.1.items': { rows: [{ id: 'i0', collapsed: true }] },
  layout: { rows: [{ id: 'a', blockType: 'hero' }, { id: 'b', blockType: 'section' }] },
}

describe('planReveal', () => {
  it('needs nothing for a field in the default tab beyond selecting it', () => {
    expect(planReveal(fields, 'title', formState)).toEqual({
      complete: true,
      steps: [{ index: 0, kind: 'tab', parentPath: '', tabs: rootTabs }],
    })
  })

  it('sees through rows and collapsibles, which add no path segment', () => {
    const plan = planReveal(fields, 'metaNote', formState)

    expect(plan.complete).toBe(true)
    expect(plan.steps).toEqual([{ index: 1, kind: 'tab', parentPath: '', tabs: rootTabs }])
  })

  it('lists every row on the way to a nested array field, outermost first', () => {
    const plan = planReveal(fields, 'faq.1.items.0.q', formState)

    expect(plan.steps).toEqual([
      { index: 1, kind: 'tab', parentPath: '', tabs: rootTabs },
      // Payload's own id for it: tabs field 0, tab 1, second field in the tab.
      { id: 'field-collapsible-_index-0-1-1', kind: 'collapsible' },
      { index: 1, kind: 'row', path: 'faq' },
      { index: 0, kind: 'row', path: 'faq.1.items' },
    ])
  })

  it('picks the block config by the row’s block type', () => {
    const plan = planReveal(fields, 'layout.1.heading', formState)

    expect(plan.complete).toBe(true)
    expect(plan.steps).toEqual([
      { index: 0, kind: 'tab', parentPath: '', tabs: rootTabs },
      { index: 1, kind: 'row', path: 'layout' },
      { index: 0, kind: 'tab', parentPath: 'layout.1', tabs: sectionTabs },
    ])
  })

  it('treats a named tab as a path segment and selects it', () => {
    const plan = planReveal(fields, 'layout.1.style.variant', formState)

    expect(plan.steps.at(-1)).toEqual({ index: 1, kind: 'tab', parentPath: 'layout.1', tabs: sectionTabs })
  })

  it('resolves block references through the blocks map', () => {
    const referencing: SchemaField[] = [{ name: 'layout', type: 'blocks', blockReferences: ['hero'] }]
    const plan = planReveal(
      referencing,
      'layout.0.heading',
      { layout: { rows: [{ id: 'a', blockType: 'hero' }] } },
      { hero: { slug: 'hero', fields: [text('heading')] } },
    )

    expect(plan).toEqual({ complete: true, steps: [{ index: 0, kind: 'row', path: 'layout' }] })
  })

  it('is complete at a leaf, whatever deeper segments point into its value', () => {
    const plan = planReveal([{ name: 'body', type: 'richText' }], 'body.root.children.0', {})

    expect(plan).toEqual({ complete: true, steps: [] })
  })

  it('says it is incomplete when a segment matches no field', () => {
    expect(planReveal(fields, 'layout.0.unknown', formState).complete).toBe(false)
    expect(planReveal(fields, 'nothing', formState).complete).toBe(false)
  })
})

describe('findTabsElement', () => {
  /** Payload's tabs markup: no id or path on the tabs field itself, only on the fields inside. */
  const tabsMarkup = (labels: string[], active: number, content: string) => `
    <div class="tabs-field">
      <div class="tabs-field__tabs-wrap"><div class="tabs-field__tabs">
        ${labels
          .map(
            (label, index) =>
              `<button class="tabs-field__tab-button${index === active ? ' tabs-field__tab-button--active' : ''}">${label}</button>`,
          )
          .join('')}
      </div></div>
      <div class="tabs-field__content-wrap">${content}</div>
    </div>`

  it('identifies a tabs field by the fields its active tab renders', () => {
    document.body.innerHTML = tabsMarkup(
      ['Content', 'Meta'],
      0,
      `<input id="field-title" />
       <div id="layout-row-1">${tabsMarkup(['Content', 'Style'], 0, '<input id="field-layout__1__heading" />')}</div>`,
    )
    const [outer, inner] = Array.from(document.querySelectorAll<HTMLElement>('.tabs-field'))

    const outerStep = planReveal(fields, 'metaNote', formState).steps[0]
    const innerStep = planReveal(fields, 'layout.1.style.variant', formState).steps.at(-1)!

    expect(outerStep.kind === 'tab' && findTabsElement(outerStep, fields, formState)).toBe(outer)
    expect(innerStep.kind === 'tab' && findTabsElement(innerStep, fields, formState)).toBe(inner)
    expect(tabButtonsOf(inner).map((b) => b.textContent)).toEqual(['Content', 'Style'])
  })

  it('tells apart the same tabs config rendered by two block rows', () => {
    const state = {
      layout: {
        rows: [
          { id: 'a', blockType: 'section' },
          { id: 'b', blockType: 'section' },
        ],
      },
    }
    document.body.innerHTML = tabsMarkup(
      ['Content', 'Meta'],
      0,
      `${tabsMarkup(['A'], 0, '<input id="field-layout__0__heading" />')}
       ${tabsMarkup(['A'], 0, '<input id="field-layout__1__heading" />')}`,
    )
    const [, , second] = Array.from(document.querySelectorAll<HTMLElement>('.tabs-field'))

    const step = planReveal(fields, 'layout.1.heading', state).steps.at(-1)!

    expect(step.kind === 'tab' && findTabsElement(step, fields, state)).toBe(second)
  })

  it('returns null when no rendered tabs field can be identified', () => {
    document.body.innerHTML = tabsMarkup(['Empty'], 0, '<p>nothing with a path</p>')
    const step = planReveal(fields, 'title', formState).steps[0]

    expect(step.kind === 'tab' && findTabsElement(step, fields, formState)).toBeNull()
  })
})

describe('labelOfTarget', () => {
  const label = (schema: SchemaField[], path: string, state = formState, language = 'de') =>
    labelOfTarget(describeTarget(schema, path, state)!, language)

  it('uses the label the admin shows, in the admin language', () => {
    const schema: SchemaField[] = [{ name: 'title', type: 'text', label: { de: 'Titel', en: 'Title' } }]

    expect(label(schema, 'title')).toBe('Titel')
    expect(label(schema, 'title', formState, 'fr')).toBe('Title')
  })

  it('falls back to the field name, the way Payload does', () => {
    expect(label([text('metaDescription')], 'metaDescription')).toBe('Meta Description')
  })

  it('names the rich-text field for a path deep inside its value', () => {
    expect(label([{ name: 'body', type: 'richText', label: 'Inhalt' }], 'body.root.children.0')).toBe('Inhalt')
  })

  it('names a whole row by its block label and number, like its row header', () => {
    const schema: SchemaField[] = [
      {
        name: 'layout',
        type: 'blocks',
        blocks: [{ slug: 'hero', fields: [text('heading')], labels: { singular: 'Hero' } }],
      },
    ]

    expect(label(schema, 'layout.2', { layout: { rows: [{ id: 'a' }, { id: 'b' }, { id: 'c', blockType: 'hero' }] } })).toBe(
      'Hero 03',
    )
  })

  it('names a field inside a row by the field, not the row', () => {
    expect(label(fields, 'layout.1.heading')).toBe('Heading')
  })
})

describe('relatedDocumentAt', () => {
  const fields: SchemaField[] = [
    text('title'),
    { name: 'author', type: 'relationship', relationTo: 'people' },
    { name: 'image', type: 'upload', relationTo: 'media' },
    {
      name: 'layout',
      type: 'blocks',
      blocks: [
        {
          slug: 'carousel',
          fields: [
            {
              name: 'query',
              type: 'group',
              fields: [{ name: 'selectedDocs', type: 'relationship', hasMany: true, relationTo: ['posts', 'pages'] }],
            },
          ],
        },
      ],
    },
    { name: 'team', type: 'relationship', hasMany: true, relationTo: 'people' },
  ]
  const formState = {
    author: { value: 7 },
    image: { value: 3 },
    layout: { rows: [{ id: 'row-1', blockType: 'carousel' }] },
    'layout.0.query.selectedDocs': {
      value: [
        { relationTo: 'posts', value: 12 },
        { relationTo: 'pages', value: 4 },
      ],
    },
    team: { value: ['p-1', 'p-2'] },
  }

  it('follows a path through a relationship into the document it points at', () => {
    expect(relatedDocumentAt(fields, 'author.name', formState)).toEqual({ id: 7, collection: 'people', path: 'name' })
  })

  it('reads a polymorphic list - the carousel’s chosen documents - by position, through `value`', () => {
    expect(relatedDocumentAt(fields, 'layout.$row-1.query.selectedDocs.1.value.meta.title', formState)).toEqual({
      id: 4,
      collection: 'pages',
      path: 'meta.title',
    })
    expect(relatedDocumentAt(fields, 'layout.0.query.selectedDocs.0.value.title', formState)?.id).toBe(12)
  })

  it('reads a row segment that names the document by id, where its ids are strings', () => {
    expect(relatedDocumentAt(fields, 'team.$p-2.name', formState)).toEqual({ id: 'p-2', collection: 'people', path: 'name' })
  })

  it('stays in this document for its own fields, an upload, and the relationship field itself', () => {
    for (const path of ['title', 'image.alt', 'author', 'layout.$row-1.query', 'layout.$row-1.query.selectedDocs', 'team.5.name', 'nothing.here']) {
      expect(relatedDocumentAt(fields, path, formState)).toBeNull()
    }
  })

  it('does not take a collection the field does not point into', () => {
    const forged = { ...formState, 'layout.0.query.selectedDocs': { value: [{ relationTo: 'users', value: 1 }] } }
    expect(relatedDocumentAt(fields, 'layout.0.query.selectedDocs.0.value.email', forged)).toBeNull()
  })
})

describe('formFieldPathOf', () => {
  it('is the field a path ends in - the rich text, not the text run inside it', () => {
    const fields: SchemaField[] = [
      { type: 'tabs', tabs: [{ fields: [{ name: 'content', type: 'richText' }] }] },
      { name: 'details', type: 'group', fields: [text('subtitle')] },
      { name: 'links', type: 'array', fields: [text('label')] },
    ]
    expect(formFieldPathOf(fields, 'content.root.children.0.children.0.text')).toBe('content')
    expect(formFieldPathOf(fields, 'details.subtitle')).toBe('details.subtitle')
    expect(formFieldPathOf(fields, 'links.1.label')).toBe('links.1.label')
    expect(formFieldPathOf(fields, 'nothing')).toBeNull()
  })

  it('does not cut a path at a block row whose type it cannot know - that would name the row', () => {
    const fields: SchemaField[] = [{ name: 'layout', type: 'blocks', blocks: [{ slug: 'content', fields: [text('text')] }] }]
    expect(formFieldPathOf(fields, 'layout.1.text')).toBeNull()
    expect(formFieldPathOf(fields, 'layout.1.text', { layout: { rows: [{ id: 'a' }, { id: 'b', blockType: 'content' }] } })).toBe(
      'layout.1.text',
    )
  })
})
