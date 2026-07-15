# Changelog

## 1.3.0

Two automatic tagging layers on top of explicit `pathOf()` tagging, a fix for the server/client component boundary caveat, and a bundle-size fix that splits the package into purpose-specific entry points.

### ⚠️ Action required when upgrading

- The admin listener moved from the `/client` barrel to its own `/listener` subpath, and the plugin now registers it under that path. **Regenerate your import map** after upgrading (`payload generate:importmap`; happens automatically on `next dev` in most setups), or the admin panel won't find the listener component.
- Change your `inspectable`/`pathOf`/`stegaClean` imports from `/client` to the new **`/path`** subpath everywhere except the file that mounts `LivePreviewInspectorClient`. `/client` still re-exports them, but importing them from `/client` inside any client component drags the entire inspector component into a shared chunk that **every page loads for every visitor** (measured: ~250 KB+ of plugin-attributable JS on unrelated public pages — bundlers treat `'use client'` barrels as indivisible units). `/path` contains no components and cannot leak anything.
- If you imported `LivePreviewInspectorListener` from `/client` directly (you shouldn't need to), import it from `/listener` now — it is no longer exported from `/client`, so its `@payloadcms/ui` dependency can never reach a frontend bundle again.

### Bundle hygiene

- New `/path` entry point: `inspectable`, `pathOf`, `stegaClean`, `InspectableOptions`, `LIVE_PREVIEW_PATH_ATTRIBUTE`, `LIVE_PREVIEW_AUTO_ATTRIBUTE`, `LIVE_PREVIEW_HOVER_CLASS_NAME`, `SERIALIZED_PATH_KEY` — pure data helpers with zero component code in the module graph.
- New `/listener` entry point: the admin-side component, isolated together with its `@payloadcms/ui` dependency.
- `/client` now contains only `LivePreviewInspectorClient` plus convenience re-exports of the pure helpers.

### Automatic tagging

Explicit tags always win; each layer only fills in what the previous one didn't cover. **Nothing new reaches public pages**: all data-side output (stega characters, serialized markers, path attributes) sits behind `inspectable()`'s existing `enabled` switch, and all client-side scanning only runs inside the Live Preview iframe.

- **Stega mode** (`inspectable(data, { stega: true })`): every string field's path is encoded into its value as invisible zero-width characters; `LivePreviewInspectorClient` decodes them from the rendered DOM (text nodes plus `alt`/`title`/`aria-label`/`placeholder`) and tags the containing elements — no `pathOf()` needed for text content, and the path survives any component or serialization boundary. Values that are compared or parsed programmatically are skipped by key (`id`, `blockType`, `blockName`, `slug`) and by shape (URLs, emails, ISO dates, numeric strings, hex colors, uuids); strings read out of arrays (`hasMany`) stay raw. New `stegaClean()` export strips the encoding wherever the raw value is needed (string or deep tree; emoji joiners are preserved).
- **Value matching** (zero-config, on by default): the client asks the admin listener for the document's current string field values (addressed by stable row ids) and tags any element whose whole text equals exactly one field's value — no frontend data changes needed at all. Conservative: ambiguous values (shared by several fields), values under 3 characters, and partial matches are never tagged. Disable with `valueMatching={false}`.
- **Block-container inference**: auto-tagged leaves sharing an Array/Blocks row path prefix vote for their common DOM ancestor as the row's container, so clicking a block's padding jumps to the whole row — skipped when the row is already tagged manually, when markup interleaves rows, or when the only candidate is `<body>`.
- **`serializable: true`** on `inspectable()`: embeds each object node's path as an enumerable `__payloadLivePreviewPath` property that survives JSON/RSC serialization, so `pathOf()` keeps working on nodes passed from Server to Client Components (the previously documented caveat).
- Auto-tagged elements carry `data-payload-live-preview-auto="stega" | "match" | "container"` for debuggability; auto-tagging never overwrites an existing path attribute.
- New exports (from `/path`, re-exported from `/client`): `stegaClean`, `LIVE_PREVIEW_AUTO_ATTRIBUTE`, `SERIALIZED_PATH_KEY`.

## 1.2.1

- Simplified `scrollToElement`'s correction logic from 1.2.0: instead of re-measuring every animation frame and tracking stall/retarget counters, it now waits for the `scrollend` event (as before 1.2.0) and, if the field is still short of `offset`, re-measures and issues up to 2 further corrections. Same fix for the "requires 2-3 clicks" issue, much less code to reason about.
- Fixed: those corrections now use the same `behavior` as the initial scroll (smooth, unless reduced motion is preferred) instead of always snapping instantly, so a correction never looks like an abrupt jump after a smooth animation.

## 1.2.0

- Fixed: on long pages, scrolling to a field could land short of it, requiring 2-3 clicks to converge. The target position was measured once up front, so content loading in above the field (rich-text editors hydrating, image previews) while the smooth scroll was in flight moved the field out from under the animation. `scrollToElement` now re-measures every animation frame and, whenever the scroll comes to rest short of the target, seamlessly re-aims at the field's current position until it converges and holds still. A user scroll (wheel/touch) or a newer click cancels the pending scroll, and flash/focus only fire when the field was actually reached.
- Changed: after expanding a collapsed accordion, the listener no longer waits a fixed `accordionAnimationMs` before scrolling - it now waits until the field actually has a layout box (collapsed content is `display: none` until React re-renders), which is both faster (typically 1-2 frames instead of 350ms) and correct regardless of the animation's real duration. `accordionAnimationMs` is now the maximum wait for that.
- Fixed: the reveal no longer depends on the `scrollend` event, which older Safari versions don't fire - there, every scroll used to sit out a 1s fallback timeout before flashing.
- Scrolls now respect `prefers-reduced-motion: reduce` by jumping instantly instead of animating.

## 1.1.0

- `disableLinks` (default `true`) on `LivePreviewInspectorClient`: blocks link navigation inside the iframe, including client-side router links (Next.js' `<Link>`, etc.), via a capture-phase click interceptor. If your preview page has links you rely on working as normal navigation, pass `disableLinks={false}`.
- Admin-side listener: flash/focus now wait for the scroll to actually finish (via the `scrollend` event, with a timeout fallback) instead of firing while the page is still moving. Fields already visible in the viewport still flash immediately, even if not pixel-perfect at `scrollOffset`.

## 1.0.0

Initial release.

- `payloadLivePreviewInspector()` plugin: registers the click-to-scroll listener on configured collections and globals.
- `LivePreviewInspectorClient` for the frontend: hover highlight + click-to-message inside the Live Preview iframe, with optional `hoverColor` and `targetOrigin` props.
- `inspectable()` / `pathOf()` helpers: path-tracking proxy with reorder-safe row-id addressing for Array/Blocks fields, with an `enabled` option to switch off attribute emission on public pages.
- Admin-side listener: resolves row ids against live form state, expands collapsed accordions, scrolls to, flashes, and focuses the matching field.
