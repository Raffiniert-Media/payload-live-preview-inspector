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

    // Own subpath (not /client): the listener imports @payloadcms/ui, which
    // must never be reachable from the frontend-facing /client barrel.
    const LISTENER_PATH =
      '@raffiniert-media-ag/payload-live-preview-inspector/listener#LivePreviewInspectorListener'

    const createComponentConfig = () => ({
      clientProps: {
        accordionAnimationMs: pluginOptions.accordionAnimationMs,
        flashColor: pluginOptions.flashColor,
        flashDurationMs: pluginOptions.flashDurationMs,
        scrollOffset: pluginOptions.scrollOffset,
        tabSwitchWaitMs: pluginOptions.tabSwitchWaitMs,
      },
      path: LISTENER_PATH,
    })

    /**
     * Whether this listener is already registered in `controls`.
     *
     * A Payload plugin receives the config and edits the collection objects in
     * it, which is what Payload's own plugins do - but those objects can be
     * *shared*. A theme exports one collection config and one `plugins` array,
     * and a repository can build a second config from both: a localized variant
     * for its test suite, a reference config, a script importing one config
     * while the app holds the other. Then this function runs twice over the
     * same object and, without this check, appended a second listener to the
     * first config's collection.
     *
     * Two listeners are two message handlers on one window: a single click
     * reveals twice, and the hint renders twice in the document controls.
     *
     * Matched on *this* path rather than on "something is already here", so a
     * collection that already has a custom control still gets the listener
     * beside it. String entries (`'/components/Thing'`) pass through the
     * `typeof` guard as never matching, which is correct - a path string cannot
     * be this component, which needs `clientProps`.
     */
    const alreadyRegistered = (controls: unknown[]): boolean =>
      controls.some(
        (control) =>
          typeof control === 'object' &&
          control !== null &&
          (control as { path?: unknown }).path === LISTENER_PATH,
      )

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

        if (alreadyRegistered(collection.admin.components.edit.beforeDocumentControls)) {
          continue
        }

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

        if (alreadyRegistered(global.admin.components.elements.beforeDocumentControls)) {
          continue
        }

        global.admin.components.elements.beforeDocumentControls.push(createComponentConfig())
      }
    }

    return config
  }
