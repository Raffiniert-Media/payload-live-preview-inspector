'use client'

import { useLivePreview } from '@payloadcms/live-preview-react'
import { LivePreviewInspectorClient } from '@raffiniert-media-ag/payload-live-preview-inspector/client'
import { inspectable, inspectableDocument, pathOf } from '@raffiniert-media-ag/payload-live-preview-inspector/path'
import { useEffect, useState } from 'react'

import type { Page, Post } from '../../../../../payload-types.js'

type Props = {
  initialData: Page
  posts: Post[]
}

/**
 * The complex page's preview: long, tagged the recommended way (`pathOf()`
 * plus stega), and under a sticky site header - what a real site looks like,
 * and what the reveal budgets in the e2e suite are measured against.
 */
export const PagePreviewClient = ({ initialData, posts }: Props) => {
  // For the e2e suite: set once hydrated. Effects run child-first, so the
  // inspector (a child) is listening by the time this is.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  const { data } = useLivePreview<Page>({
    // The posts in `featured` stay populated as the form changes.
    depth: 1,
    initialData,
    // Admin and preview share this dev server, whatever port it runs on.
    serverURL: typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin,
  })

  const page = inspectable(data, { stega: true })

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <LivePreviewInspectorClient />
      <header
        style={{
          background: '#111',
          color: '#fff',
          height: 64,
          lineHeight: '64px',
          padding: '0 2rem',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        Site header
      </header>
      <main data-hydrated={hydrated || undefined} style={{ margin: '0 auto', maxWidth: 720, padding: '2rem' }}>
        <h1 {...pathOf(page, 'title')}>{page.title}</h1>
        <p {...pathOf(page, 'intro')}>{page.intro}</p>

        {page.sections?.map((section) => (
          <section
            key={section.id}
            {...pathOf(section)}
            data-testid={`section-${section.id}`}
            style={{ borderTop: '1px solid #ddd', padding: '2rem 0' }}
          >
            {'heading' in section && <h2 {...pathOf(section, 'heading')}>{section.heading}</h2>}
            {section.blockType === 'feature' && <p {...pathOf(section, 'text')}>{section.text}</p>}
            {section.blockType === 'tabbed' && (
              <p {...pathOf(section, 'extra.caption')}>{section.extra?.caption}</p>
            )}
            {section.blockType === 'grid' &&
              section.rows?.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: 'grid',
                    gap: '1rem',
                    gridTemplateColumns: row.layout === 'two' ? '1fr 1fr' : '1fr',
                    marginBottom: '1rem',
                  }}
                >
                  {row.columns?.map((column) => (
                    <div key={column.id}>
                      {column.content?.map((block) => (
                        <div key={block.id} style={{ background: '#f6f6f6', padding: '1rem' }}>
                          <h3 {...pathOf(block, 'headline')}>{block.headline}</h3>
                          <p {...pathOf(block, 'copy')}>{block.copy}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            {section.blockType === 'cards' && (
              <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {section.cards?.map((card) => (
                  <article key={card.id} {...pathOf(card)} style={{ border: '1px solid #ddd', padding: '1rem' }}>
                    <h3 {...pathOf(card, 'title')}>{card.title}</h3>
                    <ul>
                      {card.points?.map((point) => (
                        <li key={point.id} {...pathOf(point, 'label')}>
                          {point.label}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            )}
          </section>
        ))}

        <section style={{ borderTop: '1px solid #ddd', padding: '2rem 0' }}>
          <h2>FAQ</h2>
          {page.faq?.map((item) => (
            <details key={item.id} open>
              <summary {...pathOf(item, 'question')}>{item.question}</summary>
              <p {...pathOf(item, 'answer')}>{item.answer}</p>
            </details>
          ))}
        </section>

        {/* The page's picture, the way the first customer site draws its
            before/after pairs: the tagged block in a rounded box of its own
            size with `overflow: hidden`, and two positioned pictures over
            it. An outline around the block was cut away by the box, one
            inside it covered by the pictures. Swatches rather than files, so
            no test waits on an image. */}
        <div style={{ borderRadius: 12, height: 90, overflow: 'hidden', width: 160 }}>
          <div
            {...pathOf(page, 'image')}
            style={{ display: 'grid', gap: 4, gridTemplateColumns: '1fr 1fr', height: 90, width: 160 }}
          >
            <div
              data-testid="picture-before"
              style={{ background: '#c33', borderRadius: 8, overflow: 'hidden', position: 'relative' }}
            />
            <div style={{ background: '#3c3', borderRadius: 8, overflow: 'hidden', position: 'relative' }} />
          </div>
        </div>

        {/* Posts the page shows but does not hold: queried by themselves, and
            chosen through a relationship. A click on one opens the post. */}
        <section data-testid="latest-posts" style={{ borderTop: '1px solid #ddd', padding: '2rem 0' }}>
          <h2>Latest posts</h2>
          {posts.map((raw) => {
            const post = inspectableDocument(page, { id: raw.id, collection: 'posts' }, raw)
            return (
              <article key={raw.id} {...pathOf(post)} data-testid="latest-post" style={{ border: '1px solid #ddd', padding: '1rem' }}>
                <h3>{post.title}</h3>
                <p data-testid="latest-post-section">{post.metaSections?.[0]?.title}</p>
                {post.layout?.map((block, index) =>
                  block.blockType === 'contentBlock' ? (
                    <p data-testid="latest-post-block" key={index}>
                      {block.text}
                    </p>
                  ) : null,
                )}
              </article>
            )
          })}
          {/* Another document of a collection this admin does not have: a
              path from a stale build, or one a script on the page made up. */}
          <p data-payload-live-preview-path="@secrets:1.title" data-testid="unknown-document">
            A document from nowhere
          </p>
          {page.featured?.map((entry, index) =>
            entry.value && typeof entry.value === 'object' ? (
              <div key={index}>
                <p data-testid="featured-post">{entry.value.title}</p>
                {/* A row of the post, named by its id through the page's own
                    data - only the drawer's form knows where it is now. */}
                <p data-testid="featured-post-section">{entry.value.metaSections?.[0]?.title}</p>
              </div>
            ) : null,
          )}
        </section>

        {/* What a preview rendered before a row was deleted in the admin: a
            path whose row no longer exists. The click must say so rather
            than do nothing. */}
        <p data-payload-live-preview-path="sections.$deleted-row.heading" data-testid="stale-row">
          A section deleted after the preview rendered
        </p>

        <footer style={{ borderTop: '1px solid #ddd', padding: '2rem 0' }}>
          <small {...pathOf(page, 'seo.metaDescription')}>{page.seo?.metaDescription}</small>
        </footer>
      </main>
    </div>
  )
}
