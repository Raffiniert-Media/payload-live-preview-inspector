'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
// The component comes from /client; the data helpers from the pure /path
// subpath, so importing them elsewhere never drags component code into a
// page bundle.
import { LivePreviewInspectorClient } from '@raffiniert-media-ag/payload-live-preview-inspector/client'
import { inspectable, pathOf } from '@raffiniert-media-ag/payload-live-preview-inspector/path'

import type { Post } from '../../../../../payload-types.js'

type Props = {
  initialData: Post
}

/** Dev-only caption marking which tagging layer a demo area exercises. */
const Layer = ({ children }: { children: string }) => (
  <small
    style={{
      background: '#f0f0f0',
      borderRadius: 3,
      color: '#666',
      display: 'inline-block',
      fontSize: 11,
      marginBottom: 4,
      padding: '1px 6px',
    }}
  >
    {children}
  </small>
)

export const PreviewClient = ({ initialData }: Props) => {
  const { data } = useLivePreview<Post>({
    initialData,
    serverURL: 'http://localhost:3000',
  })

  // stega: strings read from `page` carry their field path as invisible
  // characters - elements rendering them are tagged automatically, without
  // pathOf() (exercised by the content block below).
  const page = inspectable(data, { stega: true })

  return (
    <main style={{ fontFamily: 'sans-serif', margin: '0 auto', maxWidth: 640, padding: '2rem' }}>
      <LivePreviewInspectorClient />
      <aside
        style={{
          background: '#fafafa',
          border: '1px solid #e0e0e0',
          borderRadius: 6,
          color: '#555',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: '2rem',
          padding: '0.75rem 1rem',
        }}
      >
        Each area below is tagged by a different layer — hover it to see the highlight, click it to
        jump to its field, and inspect <code>data-payload-live-preview-auto</code> in devtools to see
        which layer did the tagging (absent = explicit <code>pathOf()</code>).
      </aside>

      <Layer>manual: pathOf(page, 'title')</Layer>
      <h1 {...pathOf(page, 'title')} style={{ marginTop: 0 }}>
        {page.title}
      </h1>
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
            <div key={block.id ?? index} style={{ margin: '2rem 0' }}>
              <Layer>manual: pathOf(block) / pathOf(block, …)</Layer>
              <section {...pathOf(block)}>
                <h2 {...pathOf(block, 'heading')}>{block.heading}</h2>
                <p {...pathOf(block, 'subheading')}>{block.subheading}</p>
              </section>
            </div>
          )
        }

        if (block.blockType === 'contentBlock') {
          // Deliberately NOT tagged with pathOf(): the <p>'s text carries a
          // stega-encoded path (auto-tagged by the scanner), and the <section>
          // is then inferred as the block's container from that leaf. The
          // absolutely-positioned overlay link (the full-card-link pattern)
          // swallows every pointer event - hover/click must resolve the
          // tagged <p> beneath it via elementsFromPoint.
          return (
            <div key={block.id ?? index} style={{ margin: '2rem 0' }}>
              <Layer>auto: stega text + inferred container — no pathOf(), behind an overlay link</Layer>
              <section data-testid="content-section" style={{ position: 'relative' }}>
                <a
                  aria-label="Mehr erfahren"
                  data-testid="card-overlay-link"
                  href="/should-not-navigate-either"
                  style={{ inset: 0, position: 'absolute', zIndex: 1 }}
                />
                <p data-testid="stega-text">{block.text}</p>
              </section>
            </div>
          )
        }

        return null
      })}
      {/* The metaNote field lives in the admin form's "Meta" tab - clicking
          this exercises the listener's tab sweep (Payload unmounts inactive
          tab panels, so the field isn't in the DOM until its tab is active). */}
      <div style={{ marginTop: '4rem' }}>
        <Layer>manual, but its field is in the admin's Meta tab</Layer>
        <p data-testid="meta-note" {...pathOf(page, 'metaNote')}>
          {page.metaNote ?? 'Meta note'}
        </p>
      </div>
      {/* Rendered from the RAW (unproxied) data - no pathOf, no stega. Value
          matching asks the admin panel for the field values and tags this
          element because its whole text equals the `title` field's value. */}
      <div style={{ marginTop: '2rem' }}>
        <Layer>auto: value matching — raw data, no proxy, no pathOf()</Layer>
        <footer data-testid="match-title" style={{ color: '#888' }}>
          {data.title}
        </footer>
      </div>
    </main>
  )
}
