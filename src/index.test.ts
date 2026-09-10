import { describe, expect, it } from 'vitest'

import { payloadLivePreviewInspector } from './index.js'

const LISTENER_PATH =
  '@raffiniert-media-ag/payload-live-preview-inspector/listener#LivePreviewInspectorListener'

/** The minimum a `Config` needs for the plugin to find anything in it. */
const configWith = (collections: { slug: string }[], globals: { slug: string }[] = []) =>
  ({ collections, globals }) as never

const controlsOf = (collection: Record<string, never>): unknown[] =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading into a config we just built
  (collection as any).admin?.components?.edit?.beforeDocumentControls ?? []

const globalControlsOf = (global: Record<string, never>): unknown[] =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading into a config we just built
  (global as any).admin?.components?.elements?.beforeDocumentControls ?? []

describe('payloadLivePreviewInspector', () => {
  it('registers the listener on the named collection and global', () => {
    const pages = { slug: 'pages' }
    const settings = { slug: 'siteSettings' }

    payloadLivePreviewInspector({
      collections: { pages: true },
      globals: { siteSettings: true },
    })(configWith([pages], [settings]))

    expect(controlsOf(pages as never)).toHaveLength(1)
    expect(globalControlsOf(settings as never)).toHaveLength(1)
  })

  it('leaves collections it was not asked about alone', () => {
    const pages = { slug: 'pages' }
    const media = { slug: 'media' }

    payloadLivePreviewInspector({ collections: { pages: true } })(configWith([pages, media]))

    expect(controlsOf(media as never)).toHaveLength(0)
  })

  /**
   * Two configs in one process, over the same collection object.
   *
   * This is not a contrived case: a theme exports one shared `plugins` array
   * and one shared collection object, and a repository can build a second
   * config from both — a localized variant for its test suite, a reference
   * config, a script that imports one config while the app has the other. The
   * plugin mutates the collection it is handed rather than copying it, which is
   * what Payload's own plugins do too, so a second pass appended a second
   * listener to the *first* config's collection.
   *
   * Two listeners are two message handlers on the same window: one click
   * reveals twice, and the hint renders twice in the document controls.
   */
  it('registers once when two configs share a collection object', () => {
    const pages = { slug: 'pages' }
    const plugin = payloadLivePreviewInspector({ collections: { pages: true } })

    plugin(configWith([pages]))
    plugin(configWith([pages]))

    expect(controlsOf(pages as never)).toHaveLength(1)
  })

  it('registers once when the same global is passed twice', () => {
    const settings = { slug: 'siteSettings' }
    const plugin = payloadLivePreviewInspector({ globals: { siteSettings: true } })

    plugin(configWith([], [settings]))
    plugin(configWith([], [settings]))

    expect(globalControlsOf(settings as never)).toHaveLength(1)
  })

  /**
   * A control somebody else put there stays, and so does a string entry — the
   * check has to recognise *its own* registration, not "anything is already
   * here", or a collection with a custom control would never get the listener.
   */
  it('adds itself beside controls that are already there', () => {
    const pages = {
      slug: 'pages',
      admin: {
        components: {
          edit: { beforeDocumentControls: ['/components/SomethingElse'] },
        },
      },
    }

    payloadLivePreviewInspector({ collections: { pages: true } })(configWith([pages as never]))

    const controls = controlsOf(pages as never)
    expect(controls).toHaveLength(2)
    expect(controls[0]).toBe('/components/SomethingElse')
    expect((controls[1] as { path: string }).path).toBe(LISTENER_PATH)
  })

  it('does nothing at all when disabled', () => {
    const pages = { slug: 'pages' }

    payloadLivePreviewInspector({ collections: { pages: true }, disabled: true })(
      configWith([pages]),
    )

    expect(controlsOf(pages as never)).toHaveLength(0)
  })
})
