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

  return <PagePreviewClient initialData={doc} />
}

export default Page
