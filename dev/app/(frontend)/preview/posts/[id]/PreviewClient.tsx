'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import { inspectable, LivePreviewInspectorClient, pathOf } from '@raffiniert-media-ag/payload-live-preview-inspector/client'

import type { Post } from '../../../../../payload-types.js'

type Props = {
  initialData: Post
}

export const PreviewClient = ({ initialData }: Props) => {
  const { data } = useLivePreview<Post>({
    initialData,
    serverURL: 'http://localhost:3000',
  })

  const page = inspectable(data)

  return (
    <main style={{ fontFamily: 'sans-serif', margin: '0 auto', maxWidth: 640, padding: '2rem' }}>
      <LivePreviewInspectorClient />
      <h1 {...pathOf(page, 'title')}>{page.title}</h1>
      {/* Exercises `disableLinks` against a client-side-routed link (like
          Next.js' <Link>, which navigates via history.pushState in its own
          onClick regardless of preventDefault) without depending on Next's
          own types for it - see LivePreviewInspectorClient's `disableLinks`
          doc comment for why this needs the capture phase. */}
      <a
        data-testid="live-preview-test-link"
        href="/should-not-navigate"
        onClick={(event) => {
          // Marks that this handler ran, so the test can assert it never did
          // - a real router's <Link> would call `router.push()` here instead.
          event.preventDefault()
          event.currentTarget.dataset.navigated = 'true'
        }}
      >
        A link that should not navigate in Live Preview
      </a>
      {page.layout?.map((block, index) => {
        if (block.blockType === 'heroBlock') {
          return (
            <section key={block.id ?? index} {...pathOf(block)} style={{ margin: '2rem 0' }}>
              <h2 {...pathOf(block, 'heading')}>{block.heading}</h2>
              <p {...pathOf(block, 'subheading')}>{block.subheading}</p>
            </section>
          )
        }

        if (block.blockType === 'contentBlock') {
          return (
            <section key={block.id ?? index} {...pathOf(block)} style={{ margin: '2rem 0' }}>
              <p {...pathOf(block, 'text')}>{block.text}</p>
            </section>
          )
        }

        return null
      })}
    </main>
  )
}
