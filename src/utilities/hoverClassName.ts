/**
 * Stable, unscoped class name applied to the currently hovered element, in
 * addition to the plugin's own shipped hover styles, so consumers can
 * restyle the highlight via their own global CSS if desired.
 *
 * Lives in its own dependency-free module so importing it (e.g. from the
 * `/path` subpath into global CSS tooling or server code) never pulls any
 * component code into a bundle.
 */
export const LIVE_PREVIEW_HOVER_CLASS_NAME = 'payload-live-preview-inspector-hovered'
