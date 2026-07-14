import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { payloadLivePreviewInspector } from '@raffiniert-media/payload-live-preview-inspector'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { testEmailAdapter } from './helpers/testEmailAdapter.js'
import { seed } from './seed.js'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

if (!process.env.ROOT_DIR) {
  process.env.ROOT_DIR = dirname
}

const databaseURI =
  process.env.NODE_ENV === 'test'
    ? 'file::memory:'
    : process.env.DATABASE_URI || `file:${path.resolve(dirname, 'dev.db')}`

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
    livePreview: {
      breakpoints: [
        { name: 'mobile', height: 667, label: 'Mobile', width: 375 },
        { name: 'desktop', height: 900, label: 'Desktop', width: 1440 },
      ],
      collections: ['posts'],
      url: ({ data }) => `http://localhost:3000/preview/posts/${data.id}`,
    },
  },
  collections: [
    {
      slug: 'posts',
      fields: [
        {
          name: 'title',
          type: 'text',
        },
        {
          name: 'layout',
          type: 'blocks',
          blocks: [
            {
              slug: 'heroBlock',
              fields: [
                {
                  name: 'heading',
                  type: 'text',
                },
                {
                  name: 'subheading',
                  type: 'text',
                },
              ],
            },
            {
              slug: 'contentBlock',
              fields: [
                {
                  name: 'text',
                  type: 'textarea',
                },
              ],
            },
          ],
        },
      ],
    },
    {
      slug: 'media',
      fields: [],
      upload: {
        staticDir: path.resolve(dirname, 'media'),
      },
    },
  ],
  db: sqliteAdapter({
    client: {
      url: databaseURI,
    },
  }),
  editor: lexicalEditor(),
  email: testEmailAdapter,
  globals: [
    {
      slug: 'siteSettings',
      fields: [
        {
          name: 'siteName',
          type: 'text',
        },
      ],
    },
  ],
  onInit: async (payload) => {
    await seed(payload)
  },
  plugins: [
    payloadLivePreviewInspector({
      collections: {
        posts: true,
      },
      globals: {
        siteSettings: true,
      },
    }),
  ],
  secret: process.env.PAYLOAD_SECRET || 'test-secret_key',
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
})
