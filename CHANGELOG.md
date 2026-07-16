# Changelog

## 1.6.0

- **Reworked the reveal into two phases: reach the subtree, then scroll and settle.** Payload mounts tab panels in stages - rich-text editors load lazily, below-viewport fields render deferred - so after a tab switch the block row exists a moment before the field inside it, and 1.5.2 settled on the row: it flashed and focused the *parent* instead of the clicked field. Scrolling toward the deepest resolved element is itself what mounts the deferred fields, so after each scroll settles the reveal now waits for the exact target (or a deeper ancestor) to mount and continues to it - expanding and re-scrolling as needed. Already-exact targets skip the wait entirely, so the common case stays as fast as before.
- **Fixed: the scroll could stop short of the target when the admin form kept shifting.** Corrections were measured immediately after the scroll settled - exactly when Payload mounts its deferred fields, so the measurement was stale a frame later and the small correction budget (2) ran out chasing a moving target. Corrections now wait for the target's position to hold still across a few frames before measuring, the budget is 6, and a correction that produces no actual movement (the target physically can't reach the offset, e.g. near the document bottom) stops immediately instead of retrying against the scrollend fallback.

## 1.5.2

- **Fixed: a field behind a collapsed row inside another tab was never found** (`Could not resolve path … to a field`). The tab sweep only accepted the *exact* target element, but a collapsed row's fields stay unmounted even in the correct tab - so the sweep reached the right tab, saw nothing, and reverted. The reveal now runs as a step-by-step loop where each step (a tab switch, an accordion expansion) also counts a **deeper prefix resolving** as progress: the row wrapper appearing in a just-activated tab locks the sweep onto that tab, subsequent steps expand the collapsed rows (nested ones too), and the exact field is resolved once it mounts.
- **New: value matching explains itself in development.** When a value is skipped because several fields share it (by design - a match would be ambiguous), the preview's console now logs which fields collide and what to do about it (`pathOf()` or the stega proxy), once per value. Previously the element just silently stayed untagged - e.g. a hero H1 whose text also sits in the document's `title` and the SEO `meta.title`.
- The dev demo's contentBlock now nests a rich-text field inside the (collapsible) block row, and the Meta tab gained a `metaSections` array - with e2e coverage asserting a field behind a collapsed row in the Meta tab is revealed via switch-then-expand.

## 1.5.1

- **Fixed: clicking rich text still swept the tab bar even though the correct tab was already active.** Two remaining causes of 1.5.0's symptom, both hit on real sites:
  - After expanding a collapsed accordion, the listener waited only `accordionAnimationMs` (350ms) for the target field to appear - a Lexical editor mounting inside a just-expanded block row comfortably outlives that, so the timeout was misread as "must be another tab" and triggered a visible sweep. The post-expand wait now uses the `tabSwitchWaitMs` budget (1500ms default), which exists for exactly this kind of mount.
  - The sweep ignored that a rendered ancestor of the target (its block row, its array field) already pins the target to the active tab - every DOM ancestor of a field lives in the same tab panel. When prefix fallback resolves such an ancestor, the sweep is now scoped to tab buttons *inside* it (nested tabs only) - which in the common case means no tab is touched at all. This also covers Payload versions whose Lexical field renders no `data-field-path` attribute, where the exact-element check can never succeed and every rich-text click used to sweep the whole bar before settling on the ancestor it already had.
- The dev demo's contentBlock now nests a rich-text field inside the (collapsible) block row, with e2e coverage asserting a rich-text click in the active tab never activates any tab.

## 1.5.0

Rich-text matching fixes and a tab-switch fix, all reported from real consuming sites.

### Rich text

- **Fixed: clicking rich-text content did nothing.** Payload's Lexical field renders no `field-<path>` id at all - only a `data-field-path` attribute - so even a correctly resolved path (e.g. `body`) found no DOM element: the click warned "could not resolve" and, worse, first triggered a pointless tab sweep because the "is the field rendered?" check failed too. Field resolution now falls back to `[data-field-path="…"]` after the id lookups, so rich-text fields scroll/flash/focus like any other field.
- **Fixed: stega paths into rich-text values containing id-bearing nodes resolved to nothing.** A stega path pointing inside a Lexical tree whose nodes carry their own `id`s (blocks, uploads) produced `$rowId` segments that aren't rows of any real Array/Blocks field - `resolveRowIDs` returned `null` and the click was dropped entirely. Such paths are now truncated at the first non-row `$rowId` segment, so the owning rich-text field still resolves via the usual prefix fallback. Genuinely deleted rows of real array fields still return `null`.
- **New: value matching now covers rich text.** The admin's leaf collection previously skipped every non-string field value, so text rendered from a rich-text field could never be value-matched. Object-shaped field values now contribute the string values under their `text` keys (where Lexical and Slate keep their text runs - structural strings like `type: 'paragraph'` are never collected), each addressed by the owning field's path. This also covers what stega's two-word prose rule skips inside rich text (single bolded words, short runs) - those now match back to their editor too.
- The dev demo page renders a rich-text `body` field through the stega proxy, exercising both layers (deep Lexical stega paths + value-matched single-word runs), with e2e coverage.

### Admin

- **Fixed: the tab sweep ran (visibly switching tabs) even though the correct tab was already active**, whenever the target field sat inside a closed accordion (Collapsible field or Array/Blocks row) that was collapsed from the initial render - Payload never mounts such a row's fields, so the "is the field in the DOM?" check misread the situation as "must be another tab". The listener now expands collapsed ancestors resolved via prefix fallback *first*, waits for the row's fields to mount, and only sweeps tabs if the target is still missing - so a click on a field behind a closed accordion in the active tab never touches the tab bar at all.

## 1.4.2

- Fixed: 1.4.1's overlay-targeting fix picked the smallest tagged element at a point, but broke ties (equal-sized boxes - e.g. a wrapper that tightly hugs its only child, so parent and child share the same rect) by stack order, which doesn't reliably track specificity for *siblings* (an overlay `<a>` and the content `<p>` it covers are siblings, not ancestor/descendant). In practice this could still resolve a click to a same-sized container instead of the more specific field beneath a card-covering overlay. Ties now go to the element with the **deeper path** instead - a leaf field's path is always at least as long as its containing row's, so the more specific target wins regardless of paint/DOM order.
- Fixed: with several tabs, the tab sweep from 1.4.0 could intermittently "flip through tabs and revert" without ever landing on the field - it gave up on each candidate tab after only 250ms, too little time for a heavier tab (a rich-text editor, deeply nested blocks) to finish rendering its fields, so it moved on and eventually reverted having found nothing. The per-tab wait is now 1500ms by default, and configurable via the new `tabSwitchWaitMs` plugin option (also on `LivePreviewInspectorListener`) for tabs that need even more headroom.

## 1.4.1

- Fixed: single-word image alt texts ("Acme") were never stega-encoded because of 1.3.1's two-word prose rule, so logo/image elements whose only taggable string is their `alt` stayed unclickable - while multi-word alts ("Acme Industries") worked. Attribute-only display text is now **force-encoded** regardless of word count: the built-in keys are `alt`, `ariaLabel`, and `placeholder` - values that only ever land in HTML attributes, which the value-matching layer (text nodes only) can't reach, and which consuming code practically never compares (shape-based skips - URLs, dates, etc. - still apply).
- New: `stega.encodeKeys` - declare your own always-encode display-text fields (e.g. a button's `label`), symmetric to `skipKeys` (which wins on conflict).
- Fixed: on cards with a full-card overlay link, hover/click always resolved to the link label ("read more") or the card container instead of the heading/text under the pointer. Cause: the overlay `<a>` itself gets stega-tagged through its `aria-label`, spans the whole card, and 1.4.0's point resolution picked the *topmost* tagged element - the overlay won everywhere. Point resolution now picks the **smallest** tagged element at the point (the visually most specific target); ties - the card-sized overlay vs. the equally-sized card container - go to the element lower in the stack, so padding clicks land on the container, not the cover. A tagged overlay still wins where nothing more specific is beneath it.

## 1.4.0

Three targeting fixes, all reported from real consuming sites:

- **Admin: tab switching.** Payload unmounts inactive tab panels, so clicking an element whose field lives in another tab used to scroll to the nearest rendered ancestor (the "scrolls to the parent instead of the field" symptom). The listener now checks whether the target's actual form field is in the DOM and, if not, sweeps through the form's tab buttons until it appears (nested tabs included), then scrolls/flashes as usual. When no tab contains it, the originally active tabs are restored and the old prefix fallback applies.
- **Admin: precise field anchoring via form state.** Before resolving, the clicked path is checked against the live form state to find its owning field (a stega path pointing inside a rich-text value collapses to the rich-text field itself). This prevents needless tab sweeps and makes the "is the real field rendered?" check exact.
- **Client: targeting through overlay links.** The full-card-link pattern (`<a class="absolute inset-0">` covering a card) swallowed every pointer event, so the tagged heading/text beneath it was neither hoverable nor clickable. Hover and click now resolve the topmost *tagged* element at the pointer position via `elementsFromPoint`, looking through untagged overlays; hover tracking moved from `mouseover`/`mouseout` to a frame-throttled `mousemove` so the highlight follows the pointer beneath an overlay (where the event target never changes).

## 1.3.1

Fixes a production-breaking flaw in stega mode: programmatic string values — Payload select/radio values, CSS-class-map keys, enum discriminants (e.g. `iconColorState: 'default'`) — were stega-encoded, so object-key lookups and strict comparisons in consuming code silently failed (`iconColorStates[value]` → `undefined` → TypeError). The hardcoded 4-key skip-list and shape heuristics couldn't catch plain words like `'default'`.

- **Changed default:** stega now only encodes prose-shaped strings — **two or more whitespace-separated words**. Single-token values are never encoded; they are exactly what consuming code compares against, and select/enum values practically never contain whitespace, so they're safe by construction instead of by audit. The trade-off: single-word *display* text (a `'Kontakt'` heading) is no longer stega-tagged — the value-matching layer or `pathOf()` covers those, and a missing tag is harmless while a corrupted enum is not.
- **New:** `stega` accepts an options object: `{ skipKeys: [...] }` excludes additional field names (e.g. a field storing a space-separated CSS class list), and `{ filter: ({ defaultEncode, key, path, value }) => boolean }` gets the final say per string — force-encode a known-rendered single-word field, or exclude more. `StegaOptions` is exported.
- README's stega section now documents the select/enum hazard explicitly, including how to opt fields in/out.

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
