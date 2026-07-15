import type { CollectionSlug, Config, GlobalSlug } from 'payload'

export type PayloadLivePreviewInspectorConfig = {
  /**
   * Maximum wait (ms) for a just-expanded accordion to render its content before scrolling.
   * @default 350
   */
  accordionAnimationMs?: number
  /**
   * List of collections to enable click-to-scroll live preview inspection on
   */
  collections?: Partial<Record<CollectionSlug, true>>
  disabled?: boolean
  /**
   * Flash outline/background color shown when scrolling to a field.
   * @default '#3fb950'
   */
  flashColor?: string
  /**
   * Flash animation duration in ms.
   * @default 1200
   */
  flashDurationMs?: number
  /**
   * List of globals to enable click-to-scroll live preview inspection on
   */
  globals?: Partial<Record<GlobalSlug, true>>
  /**
   * Distance (px) to keep between the scrolled-to field and the viewport top.
   * @default 100
   */
  scrollOffset?: number
  /**
   * Maximum wait (ms), per candidate tab, for a just-activated tab's fields
   * to render before assuming the target isn't in that tab. Increase this if
   * a heavier tab (a rich-text editor, deeply nested blocks) needs more time
   * to mount than the default allows - too short a value here is what makes
   * the tab switch look like it does nothing: it gives up on the correct tab
   * before its content appears, tries the rest, then reverts.
   * @default 1500
   */
  tabSwitchWaitMs?: number
}

export const payloadLivePreviewInspector =
  (pluginOptions: PayloadLivePreviewInspectorConfig) =>
  (config: Config): Config => {
    if (pluginOptions.disabled) {
      return config
    }

    const createComponentConfig = () => ({
      clientProps: {
        accordionAnimationMs: pluginOptions.accordionAnimationMs,
        flashColor: pluginOptions.flashColor,
        flashDurationMs: pluginOptions.flashDurationMs,
        scrollOffset: pluginOptions.scrollOffset,
        tabSwitchWaitMs: pluginOptions.tabSwitchWaitMs,
      },
      // Own subpath (not /client): the listener imports @payloadcms/ui, which
      // must never be reachable from the frontend-facing /client barrel.
      path: '@raffiniert-media-ag/payload-live-preview-inspector/listener#LivePreviewInspectorListener' as const,
    })

    if (pluginOptions.collections && config.collections) {
      for (const collectionSlug in pluginOptions.collections) {
        const collection = config.collections.find((collection) => collection.slug === collectionSlug)

        if (!collection) {
          continue
        }

        collection.admin ??= {}
        collection.admin.components ??= {}
        collection.admin.components.edit ??= {}
        collection.admin.components.edit.beforeDocumentControls ??= []
        collection.admin.components.edit.beforeDocumentControls.push(createComponentConfig())
      }
    }

    if (pluginOptions.globals && config.globals) {
      for (const globalSlug in pluginOptions.globals) {
        const global = config.globals.find((global) => global.slug === globalSlug)

        if (!global) {
          continue
        }

        global.admin ??= {}
        global.admin.components ??= {}
        global.admin.components.elements ??= {}
        global.admin.components.elements.beforeDocumentControls ??= []
        global.admin.components.elements.beforeDocumentControls.push(createComponentConfig())
      }
    }

    return config
  }
