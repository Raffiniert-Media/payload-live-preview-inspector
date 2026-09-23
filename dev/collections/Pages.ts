import type { CollectionConfig } from 'payload'

/**
 * The "complex page" fixture: every structure that used to cost a reveal
 * extra clicks or seconds, in one document - an unnamed root tabs field with
 * a named tab, forty sections that all start collapsed, tabs nested inside a
 * block row (unnamed and named), arrays inside collapsed rows inside
 * collapsed rows, and an array inside a collapsible field in the last tab.
 * The e2e suite holds reveals on it to one click and a time budget.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    useAsTitle: 'title',
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          fields: [
            { name: 'title', type: 'text' },
            { name: 'intro', type: 'textarea' },
          ],
          label: 'Content',
        },
        {
          fields: [
            {
              name: 'sections',
              type: 'blocks',
              admin: { initCollapsed: true },
              blocks: [
                {
                  slug: 'feature',
                  fields: [
                    // Labelled, to show the preview names fields the way the admin does.
                    { name: 'heading', type: 'text', label: 'Überschrift' },
                    { name: 'text', type: 'textarea' },
                  ],
                },
                {
                  slug: 'tabbed',
                  fields: [
                    {
                      type: 'tabs',
                      tabs: [
                        {
                          fields: [{ name: 'heading', type: 'text' }],
                          label: 'Copy',
                        },
                        {
                          name: 'extra',
                          fields: [{ name: 'caption', type: 'text' }],
                          label: 'Extra',
                        },
                      ],
                    },
                  ],
                },
                {
                  // A grid builder, the shape real sites use: rows of
                  // columns of blocks, every level collapsed.
                  slug: 'grid',
                  fields: [
                    {
                      name: 'rows',
                      type: 'array',
                      admin: { initCollapsed: true },
                      fields: [
                        {
                          name: 'layout',
                          type: 'select',
                          defaultValue: 'one',
                          options: [
                            { label: 'Eine Spalte', value: 'one' },
                            { label: 'Zwei Spalten', value: 'two' },
                          ],
                        },
                        {
                          name: 'columns',
                          type: 'array',
                          admin: { initCollapsed: true },
                          fields: [
                            {
                              name: 'content',
                              type: 'blocks',
                              admin: { initCollapsed: true },
                              blocks: [
                                {
                                  slug: 'textBlock',
                                  fields: [
                                    { name: 'headline', type: 'text' },
                                    { name: 'copy', type: 'textarea' },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  slug: 'cards',
                  fields: [
                    { name: 'heading', type: 'text' },
                    {
                      name: 'cards',
                      type: 'array',
                      admin: { initCollapsed: true },
                      fields: [
                        { name: 'title', type: 'text' },
                        {
                          name: 'points',
                          type: 'array',
                          admin: { initCollapsed: true },
                          fields: [{ name: 'label', type: 'text' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          label: 'Sections',
        },
        {
          name: 'seo',
          fields: [
            { name: 'metaTitle', type: 'text' },
            { name: 'metaDescription', type: 'textarea' },
          ],
          label: 'SEO',
        },
        {
          fields: [
            {
              type: 'collapsible',
              admin: { initCollapsed: true },
              fields: [
                {
                  name: 'faq',
                  type: 'array',
                  admin: { initCollapsed: true },
                  fields: [
                    { name: 'question', type: 'text' },
                    { name: 'answer', type: 'textarea' },
                  ],
                },
              ],
              label: 'Frequently asked',
            },
          ],
          label: 'Settings',
        },
      ],
    },
  ],
}

/** Forty sections cycling through the three block types, every text unique so value matching can't collide. */
export const seedPage = () => ({
  faq: Array.from({ length: 6 }, (_, i) => ({
    answer: `The answer to frequently asked question number ${i + 1}.`,
    question: `Frequently asked question number ${i + 1}?`,
  })),
  intro: 'An introduction to the complex page, rendered at the very top of the preview.',
  sections: [
    ...Array.from({ length: 40 }, (_, i) => sectionAt(i)),
    {
      blockType: 'grid' as const,
      rows: Array.from({ length: 3 }, (_, r) => ({
        columns: Array.from({ length: r === 0 ? 1 : 2 }, (_, c) => ({
          content: [
            {
              blockType: 'textBlock' as const,
              copy: `Copy of column ${c + 1} in grid row ${r + 1}, a sentence long.`,
              headline: `Grid row ${r + 1} column ${c + 1} headline`,
            },
          ],
        })),
        layout: r === 0 ? ('one' as const) : ('two' as const),
      })),
    },
  ],
  seo: {
    metaDescription: 'The meta description of the complex page, behind the named SEO tab.',
    metaTitle: 'Complex page meta title',
  },
  title: 'A complex page',
})

const sectionAt = (i: number) => {
  const n = i + 1
  switch (i % 3) {
    case 0:
      return {
        blockType: 'feature' as const,
        heading: `Feature section ${n}`,
        text: `Feature section ${n} explains itself in a sentence.`,
      }
    case 1:
      return {
        blockType: 'tabbed' as const,
        extra: { caption: `Caption behind the named tab of section ${n}` },
        heading: `Tabbed section ${n}`,
      }
    default:
      return {
        blockType: 'cards' as const,
        cards: Array.from({ length: 3 }, (_, c) => ({
          points: Array.from({ length: 2 }, (_, p) => ({
            label: `Point ${p + 1} of card ${c + 1} in section ${n}`,
          })),
          title: `Card ${c + 1} of section ${n}`,
        })),
        heading: `Cards section ${n}`,
      }
  }
}
