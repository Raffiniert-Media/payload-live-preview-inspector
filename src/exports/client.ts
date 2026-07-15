/**
 * The frontend component. Everything else exported here is a convenience
 * re-export of the pure helpers - but note that importing them from this
 * barrel inside a client component drags `LivePreviewInspectorClient` into
 * that page's bundle (bundlers treat `'use client'` barrels as indivisible).
 * Prefer the `/path` subpath for `inspectable`/`pathOf`/`stegaClean` in your
 * page and block components; import from `/client` only where you actually
 * mount the component.
 */
export { LivePreviewInspectorClient } from '../components/LivePreviewInspectorClient.js'
export { LIVE_PREVIEW_HOVER_CLASS_NAME } from '../utilities/hoverClassName.js'
export { inspectable, type InspectableOptions, pathOf, SERIALIZED_PATH_KEY } from '../utilities/inspectable.js'
export { LIVE_PREVIEW_AUTO_ATTRIBUTE, LIVE_PREVIEW_PATH_ATTRIBUTE } from '../utilities/pathAttribute.js'
export { stegaClean } from '../utilities/stega.js'
