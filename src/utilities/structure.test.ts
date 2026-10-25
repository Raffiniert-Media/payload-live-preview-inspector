import { describe, expect, it } from 'vitest'

import type { MinimalFormState } from './pathResolution.js'
import type { BlocksMap, SchemaField } from './revealPlan.js'
import type { FieldPermissions } from './structure.js'

import {
  buildOutline,
  chainOf,
  flattenOutline,
  outlineSignature,
  previewRowsOf,
  rowIDPathOf,
  rowPathOf,
  shorten,
  textOfRichText,
} from './structure.js'

/**
 * The shape the theme's pages have - sections of rows of columns of
 * components, inside a tab - plus the edges: a referenced block, an array with
 * row limits, a hidden field, a field whose condition fails.
 */
const text: SchemaField = { name: 'text', type: 'textarea' }
const fields: SchemaField[] = [
  { name: 'title', type: 'text' },
  {
    type: 'tabs',
    tabs: [
      {
        fields: [
          {
            name: 'layout',
            type: 'blocks',
            blocks: [
              {
                slug: 'section',
                fields: [
                  { name: 'anchor', type: 'text' },
                  {
                    name: 'rows',
                    type: 'array',
                    fields: [
                      {
                        name: 'columns',
                        type: 'array',
                        fields: [
                          {
                            name: 'blocks',
                            type: 'blocks',
                            blockReferences: ['richTextBlock'],
                            blocks: [{ slug: 'quote', fields: [text], labels: { singular: 'Quote' } }],
                          },
                        ],
                        labels: { singular: { de: 'Spalte', en: 'Column' } },
                      },
                    ],
                    labels: { singular: { de: 'Zeile', en: 'Row' } },
                    minRows: 1,
                  },
                ],
                labels: { singular: { de: 'Abschnitt', en: 'Section' } },
              },
            ],
            label: { de: 'Inhalt', en: 'Content' },
          },
        ],
        label: 'Content',
      },
      {
        name: 'meta',
        fields: [
          {
            name: 'links',
            type: 'array',
            admin: { isSortable: false },
            fields: [{ name: 'url', type: 'text' }, { name: 'label', type: 'text' }],
            labels: { plural: 'Links', singular: 'Link' },
            maxRows: 2,
          },
          { name: 'secret', type: 'array', admin: { hidden: true }, fields: [] },
          { name: 'conditional', type: 'array', fields: [] },
        ],
        label: 'Meta',
      },
    ],
  },
]

const blocksMap: BlocksMap = {
  richTextBlock: {
    slug: 'richTextBlock',
    fields: [{ name: 'body', type: 'richText' }],
    labels: { singular: { de: 'Text', en: 'Text' } },
  },
}

const lexical = (...paragraphs: string[]) => ({
  root: { children: paragraphs.map((words) => ({ type: 'paragraph', children: [{ type: 'text', text: words }] })) },
})

const formState: MinimalFormState = {
  layout: { rows: [{ id: 's1', blockType: 'section' }, { id: 's2', blockType: 'section' }] },
  'layout.0.anchor': { value: 'top' },
  'layout.0.blockType': { value: 'section' },
  'layout.0.rows': { rows: [{ id: 'r1' }] },
  'layout.0.rows.0.columns': { rows: [{ id: 'c1' }, { id: 'c2' }] },
  'layout.0.rows.0.columns.0.blocks': { rows: [{ id: 'b1', blockType: 'richTextBlock' }] },
  'layout.0.rows.0.columns.0.blocks.0.body': { value: lexical('Willkommen bei uns', 'Zweiter Absatz') },
  'layout.0.rows.0.columns.1.blocks': { rows: [{ id: 'b2', blockType: 'quote' }] },
  'layout.0.rows.0.columns.1.blocks.0.text': { valid: false, value: '' },
  'layout.1.blockName': { value: 'Kontakt' },
  'layout.1.blockType': { value: 'section' },
  'layout.1.rows': { rows: [] },
  'meta.conditional': { passesCondition: false, rows: [{ id: 'y' }] },
  'meta.links': { rows: [{ id: 'l1' }, { id: 'l2' }] },
  'meta.links.0.label': { value: 'Mehr erfahren' },
  'meta.links.0.url': { value: 'https://example.com' },
  'meta.secret': { rows: [{ id: 'x' }] },
  title: { value: 'Home' },
}

const outline = buildOutline(fields, formState, { blocksMap, language: 'de' })

describe('buildOutline', () => {
  it('starts a group per top-level Array/Blocks field, named the way the form names it', () => {
    expect(outline.groups.map((group) => [group.fieldPath, group.label])).toEqual([
      ['layout', 'Inhalt'],
      ['meta.links', 'Links'],
    ])
  })

  it('leaves out what the form does not show - a hidden field, one whose condition fails', () => {
    expect(outline.byPath.has('meta.secret.0')).toBe(false)
    expect(outline.byPath.has('meta.conditional.0')).toBe(false)
  })

  it('nests rows the way the form does, each named by its kind and number', () => {
    const [section] = outline.groups[0].nodes
    expect(section.label).toBe('Abschnitt 1')
    expect(section.children.map((row) => row.label)).toEqual(['Zeile 1'])
    expect(section.children[0].children.map((column) => column.label)).toEqual(['Spalte 1', 'Spalte 2'])
    // A referenced block is named from the blocks map, an inline one from its own config.
    expect(section.children[0].children[0].children[0].label).toBe('Text 1')
    expect(section.children[0].children[1].children[0].label).toBe('Quote 1')
  })

  it('addresses every row by index and by row id', () => {
    const block = outline.byPath.get('layout.0.rows.0.columns.1.blocks.0')
    expect(block?.rowIDPath).toBe('layout.$s1.rows.$r1.columns.$c2.blocks.$b2')
    expect(outline.byRowIDPath.get('layout.$s1.rows.$r1.columns.$c2.blocks.$b2')).toBe(block)
    // A named tab is a path segment for both.
    expect(outline.byPath.get('meta.links.1')?.rowIDPath).toBe('meta.links.$l2')
  })

  it('recognises a row by its block name first, then by the first words inside it', () => {
    expect(outline.byPath.get('layout.1')?.summary).toBe('Kontakt')
    // The section's own text field is an anchor - technical, not words - so the
    // first text inside its rows names it.
    expect(outline.byPath.get('layout.0')?.summary).toBe('Willkommen bei uns Zweiter Absatz')
    // An address is not a name; the label next to it is.
    expect(outline.byPath.get('meta.links.0')?.summary).toBe('Mehr erfahren')
    expect(outline.byPath.get('layout.0.rows.0.columns.1')?.summary).toBeUndefined()
  })

  it('marks every row an invalid field sits in, and no other', () => {
    const marked = flattenOutline(outline)
      .filter((node) => node.hasErrors)
      .map((node) => node.path)
    expect(marked).toEqual(['layout.0', 'layout.0.rows.0', 'layout.0.rows.0.columns.1', 'layout.0.rows.0.columns.1.blocks.0'])
  })

  it('allows what the field config allows', () => {
    // minRows 1 with one row: the last row of a section cannot go.
    expect(outline.byPath.get('layout.0.rows.0')?.abilities).toEqual({
      duplicate: true,
      insert: true,
      move: false,
      remove: false,
    })
    // maxRows 2 with two rows, and not sortable.
    expect(outline.byPath.get('meta.links.0')?.abilities).toEqual({
      duplicate: false,
      insert: false,
      move: false,
      remove: true,
    })
    expect(outline.byPath.get('layout.0')?.abilities.move).toBe(true)
  })

  it('allows nothing inside a read-only field, whatever the rows inside say', () => {
    const locked: SchemaField[] = [
      {
        type: 'collapsible',
        admin: { readOnly: true },
        fields: [{ name: 'links', type: 'array', fields: [{ name: 'url', type: 'text' }] }],
      },
      {
        name: 'sections',
        type: 'array',
        admin: { readOnly: true },
        fields: [{ name: 'items', type: 'array', fields: [{ name: 'text', type: 'text' }] }],
      },
    ]
    const state: MinimalFormState = {
      links: { rows: [{ id: 'l1' }, { id: 'l2' }] },
      sections: { rows: [{ id: 's1' }] },
      'sections.0.items': { rows: [{ id: 'i1' }, { id: 'i2' }] },
    }
    const nodes = flattenOutline(buildOutline(locked, state, {}))
    expect(nodes.map((node) => node.path)).toEqual(['links.0', 'links.1', 'sections.0', 'sections.0.items.0', 'sections.0.items.1'])
    expect(nodes.every((node) => Object.values(node.abilities).every((allowed) => !allowed))).toBe(true)
  })

  it('allows only what the field permissions allow', () => {
    const permitted = (permissions: FieldPermissions) => (path: string) =>
      buildOutline(fields, formState, { blocksMap, permissions }).byPath.get(path)?.abilities

    // Everything, said once.
    expect(permitted(true)('layout.0')?.duplicate).toBe(true)
    // Layout may change, the section's rows inside it may not.
    const noRows: FieldPermissions = {
      layout: {
        blocks: { section: { fields: { anchor: true, rows: { read: true } } } },
        update: true,
      },
      meta: true,
      title: true,
    }
    expect(permitted(noRows)('layout.0')?.duplicate).toBe(true)
    expect(permitted(noRows)('layout.0.rows.0')).toEqual({ duplicate: false, insert: false, move: false, remove: false })
    // A field the user has no permission for at all is not there for them.
    expect(permitted({ layout: true, title: true })('meta.links.0')?.remove).toBe(false)
    // A named tab is a level of its own.
    expect(permitted({ layout: true, meta: { fields: { links: true } }, title: true })('meta.links.0')?.remove).toBe(true)
  })

  it('allows nothing on a read-only form', () => {
    const readOnly = buildOutline(fields, formState, { blocksMap, readOnly: true })
    expect(
      flattenOutline(readOnly).every((node) => Object.values(node.abilities).every((allowed) => !allowed)),
    ).toBe(true)
  })

  it('falls back to English for a language the config has no label in', () => {
    const english = buildOutline(fields, formState, { blocksMap, language: 'fr' })
    expect(english.byPath.get('layout.0.rows.0.columns.0')?.label).toBe('Column 1')
  })

  it('changes its signature when a row moves, and not when a field that names nothing changes', () => {
    const before = outlineSignature(outline)
    const moved = buildOutline(
      fields,
      { ...formState, layout: { rows: [{ id: 's2', blockType: 'section' }, { id: 's1', blockType: 'section' }] } },
      { blocksMap, language: 'de' },
    )
    expect(outlineSignature(moved)).not.toBe(before)
    const retitled = buildOutline(fields, { ...formState, title: { value: 'Start' } }, { blocksMap, language: 'de' })
    expect(outlineSignature(retitled)).toBe(before)
  })
})

describe('chainOf', () => {
  it('lists the rows from the outermost down', () => {
    expect(chainOf(outline.byPath.get('layout.0.rows.0.columns.1.blocks.0')).map((node) => node.label)).toEqual([
      'Abschnitt 1',
      'Zeile 1',
      'Spalte 2',
      'Quote 1',
    ])
  })
})

describe('rowPathOf', () => {
  it('finds the row a field lies in', () => {
    expect(rowPathOf('layout.0.rows.0.columns.1.blocks.0.text', formState)).toBe('layout.0.rows.0.columns.1.blocks.0')
  })

  it('does not take an index inside a rich-text value for a row', () => {
    expect(rowPathOf('layout.0.rows.0.columns.0.blocks.0.body.root.children.1.text', formState)).toBe(
      'layout.0.rows.0.columns.0.blocks.0',
    )
  })

  it('is null outside every row', () => {
    expect(rowPathOf('title', formState)).toBeNull()
  })

  it('is the row itself for a row', () => {
    expect(rowPathOf('layout.1', formState)).toBe('layout.1')
  })
})

describe('rowIDPathOf', () => {
  it('cuts a tagged path back to its deepest row', () => {
    expect(rowIDPathOf('layout.$s1.rows.$r1.columns.$c1.blocks.$b1.body.root.children.0')).toBe(
      'layout.$s1.rows.$r1.columns.$c1.blocks.$b1',
    )
    expect(rowIDPathOf('title')).toBeNull()
  })
})

describe('previewRowsOf', () => {
  it('gives the preview every row with its parent, by row id', () => {
    const rows = previewRowsOf(outline)
    const quote = rows.find((row) => row.path.endsWith('$b2'))
    expect(quote).toMatchObject({ count: 1, index: 0, label: 'Quote 1', parent: 'layout.$s1.rows.$r1.columns.$c2' })
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows)
  })
})

describe('summary text', () => {
  it('reads a Lexical tree in order', () => {
    expect(textOfRichText(lexical('one two', 'three'))).toBe('one two three')
    expect(textOfRichText(null)).toBe('')
  })

  it('shortens at a word', () => {
    const long = 'Wir begleiten dich auf dem Weg zu deinem Ziel, Schritt für Schritt und mit Plan'
    expect(shorten(long)).toBe('Wir begleiten dich auf dem Weg zu deinem Ziel, Schritt für…')
    expect(shorten('  kurz  und\n gut ')).toBe('kurz und gut')
  })
})
