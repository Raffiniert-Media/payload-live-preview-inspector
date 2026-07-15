/**
 * Pure data helpers - no `'use client'` file anywhere in this module graph.
 *
 * Import `inspectable`/`pathOf`/`stegaClean` from here (not from `/client`)
 * in your page and block components: bundlers treat `'use client'` barrels as
 * indivisible units, so importing these helpers from `/client` inside any
 * client component would pull the whole inspector component bundle onto
 * every page for every visitor. This subpath cannot - it contains no
 * components at all.
 */
export { LIVE_PREVIEW_HOVER_CLASS_NAME } from '../utilities/hoverClassName.js'
export {
  inspectable,
  type InspectableOptions,
  pathOf,
  SERIALIZED_PATH_KEY,
  type StegaOptions,
} from '../utilities/inspectable.js'
export { LIVE_PREVIEW_AUTO_ATTRIBUTE, LIVE_PREVIEW_PATH_ATTRIBUTE } from '../utilities/pathAttribute.js'
export { stegaClean } from '../utilities/stega.js'
