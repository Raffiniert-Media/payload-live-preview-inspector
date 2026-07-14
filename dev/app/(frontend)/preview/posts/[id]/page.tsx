import config from '@payload-config'
import { getPayload } from 'payload'

import { PreviewClient } from './PreviewClient.js'

type Args = {
  params: Promise<{
    id: string
  }>
}

const Page = async ({ params }: Args) => {
  const { id } = await params
  const payload = await getPayload({ config })

  // Dev-only shortcut: serves draft content without any auth check. In a real
  // frontend, protect your preview route (e.g. verify the Payload session or a
  // preview token) before returning drafts.
  const doc = await payload
    .findByID({
      id,
      collection: 'posts',
      draft: true,
    })
    .catch(() => null)

  if (!doc) {
    return <p>Not found</p>
  }

  return <PreviewClient initialData={doc} />
}

export default Page
