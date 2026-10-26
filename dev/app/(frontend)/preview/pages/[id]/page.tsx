import config from '@payload-config'
import { getPayload } from 'payload'

import { PagePreviewClient } from './PagePreviewClient.js'

type Args = {
  params: Promise<{
    id: string
  }>
}

const Page = async ({ params }: Args) => {
  const { id } = await params
  const payload = await getPayload({ config })

  // Dev-only shortcut, like the posts preview: no auth check on drafts.
  const doc = await payload.findByID({ id, collection: 'pages', draft: true }).catch(() => null)

  if (!doc) {
    return <p>Not found</p>
  }

  // Documents the page does not hold but shows - what a "latest posts" block
  // queries by itself.
  const { docs: posts } = await payload.find({ collection: 'posts', depth: 0, draft: true, limit: 3, sort: 'createdAt' })

  return <PagePreviewClient initialData={doc} posts={posts} />
}

export default Page
