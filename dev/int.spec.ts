import type { Payload } from 'payload'

import config from '@payload-config'
import { getPayload } from 'payload'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let payload: Payload

afterAll(async () => {
  await payload.destroy()
})

beforeAll(async () => {
  payload = await getPayload({ config })
})

describe('Plugin integration tests', () => {
  test('registers LivePreviewInspectorListener on configured collections', () => {
    const beforeDocumentControls = payload.collections.posts.config.admin?.components?.edit?.beforeDocumentControls

    expect(beforeDocumentControls).toContainEqual(
      expect.objectContaining({
        path: '@raffiniert-media-ag/payload-live-preview-inspector/listener#LivePreviewInspectorListener',
      }),
    )
  })

  test('does not register LivePreviewInspectorListener on unconfigured collections', () => {
    const beforeDocumentControls = payload.collections.media.config.admin?.components?.edit?.beforeDocumentControls

    expect(beforeDocumentControls ?? []).not.toContainEqual(
      expect.objectContaining({
        path: '@raffiniert-media-ag/payload-live-preview-inspector/listener#LivePreviewInspectorListener',
      }),
    )
  })

  test('registers LivePreviewInspectorListener on configured globals', () => {
    const siteSettings = payload.globals.config.find((global) => global.slug === 'siteSettings')
    const beforeDocumentControls = siteSettings?.admin?.components?.elements?.beforeDocumentControls

    expect(beforeDocumentControls).toContainEqual(
      expect.objectContaining({
        path: '@raffiniert-media-ag/payload-live-preview-inspector/listener#LivePreviewInspectorListener',
      }),
    )
  })
})
