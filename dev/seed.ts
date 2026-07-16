import type { Payload } from 'payload'

import { devUser } from './helpers/credentials.js'

const text = (value: string, format = 0) => ({
  type: 'text',
  detail: 0,
  format,
  mode: 'normal',
  style: '',
  text: value,
  version: 1,
})

const paragraph = (children: ReturnType<typeof text>[]) => ({
  type: 'paragraph',
  children,
  direction: 'ltr' as const,
  format: '' as const,
  indent: 0,
  textFormat: 0,
  version: 1,
})

/**
 * Two paragraphs exercising both rich-text tagging layers: multi-word runs
 * get stega-encoded (deep Lexical paths that must collapse to the `body`
 * field), while the single bolded word is skipped by stega's prose rule and
 * must be picked up by value matching of the tree's text runs instead.
 */
const seedBody = {
  root: {
    type: 'root',
    children: [
      paragraph([text('Rich text paragraphs are matched to their field automatically.')]),
      paragraph([
        text('Even a lone '),
        text('bolded', 1),
        text(' word inside rich text finds its way back to the editor.'),
      ]),
    ],
    direction: 'ltr' as const,
    format: '' as const,
    indent: 0,
    version: 1,
  },
}

/** Rich text living inside the contentBlock row - a Lexical editor that has
 * to mount when the (possibly collapsed) row is expanded. */
const seedBlockBody = {
  root: {
    type: 'root',
    children: [paragraph([text('Rich text nested inside a block row of the layout.')])],
    direction: 'ltr' as const,
    format: '' as const,
    indent: 0,
    version: 1,
  },
}

export const seed = async (payload: Payload) => {
  const { totalDocs } = await payload.count({
    collection: 'users',
    where: {
      email: {
        equals: devUser.email,
      },
    },
  })

  if (!totalDocs) {
    await payload.create({
      collection: 'users',
      data: devUser,
    })
  }

  const { docs: posts } = await payload.find({
    collection: 'posts',
    limit: 1,
  })

  if (posts.length === 0) {
    await payload.create({
      collection: 'posts',
      data: {
        body: seedBody,
        layout: [
          {
            blockType: 'heroBlock',
            heading: 'Welcome',
            subheading: 'Hover and click me in the live preview',
          },
          {
            blockType: 'contentBlock',
            body: seedBlockBody,
            text: 'This block can also be clicked to scroll the admin form to it.',
          },
        ],
        metaNote: 'A note living in the Meta tab',
        metaSections: [{ title: 'A section title behind the Meta tab' }],
        title: 'Hello Live Preview',
      },
    })
  } else {
    // Backfill for a dev database created before the rich-text demos existed.
    const post = posts[0]
    const blockBodyMissing = post.layout?.some((block) => block.blockType === 'contentBlock' && !block.body)

    if (!post.body || blockBodyMissing || !post.metaSections?.length) {
      await payload.update({
        id: post.id,
        collection: 'posts',
        data: {
          body: post.body ?? seedBody,
          layout: post.layout?.map((block) =>
            block.blockType === 'contentBlock' ? { ...block, body: block.body ?? seedBlockBody } : block,
          ),
          metaSections: post.metaSections?.length
            ? post.metaSections
            : [{ title: 'A section title behind the Meta tab' }],
        },
      })
    }
  }
}
