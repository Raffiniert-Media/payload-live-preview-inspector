import type { Payload } from 'payload'

import { devUser } from './helpers/credentials.js'

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

  const { totalDocs: postCount } = await payload.count({
    collection: 'posts',
  })

  if (!postCount) {
    await payload.create({
      collection: 'posts',
      data: {
        layout: [
          {
            blockType: 'heroBlock',
            heading: 'Welcome',
            subheading: 'Hover and click me in the live preview',
          },
          {
            blockType: 'contentBlock',
            text: 'This block can also be clicked to scroll the admin form to it.',
          },
        ],
        title: 'Hello Live Preview',
      },
    })
  }
}
