/**
 * Admin-panel side only. Kept out of the `/client` barrel on purpose: the
 * listener imports `@payloadcms/ui`, which must never end up in a frontend
 * bundle. The plugin references this subpath in the import map for you - you
 * shouldn't need to import it yourself.
 */
export { LivePreviewInspectorListener } from '../components/LivePreviewInspectorListener.js'
