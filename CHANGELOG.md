# Changelog

## 1.10.0

### A click in the preview does one thing

A click that resolves to a field now **only** reveals that field: the page's own
handler no longer runs, so a card does not open its dialog, a popup trigger does
not open its popup and a carousel arrow does not advance. Reported from a real
site — reaching for a field put a modal over the page being edited, because the
click did both.

**Hold ⌥/Alt to operate the page instead.** The click is then an ordinary click
and reveals nothing, which is how an editor opens a dialog, steps a carousel or
expands an accordion to look at what is inside it — and the only way to reach
that content in order to click into *it*. `interactionModifier` picks the key
(`'alt' | 'ctrl' | 'meta' | 'shift' | 'none'`), `disableInteractions={false}`
restores the previous behaviour entirely.

Two things this deliberately does not do:

- **A click that resolves to no field is never taken.** A header, a cookie
  banner, anything outside the edited document keeps working exactly as it does
  for a visitor. The inspector only claims a click it can answer with a field,
  and `dev/e2e.spec.ts` asserts that half too — without it, the preview would
  stop being usable as a page at all.
- **The modifier does not release a link.** `disableLinks` still wins, because
  every browser gives alt-, meta- and shift-click on a link its own meaning
  (download, new tab, new window) — passing one on would not mean "navigate",
  and leaving the preview is never what the click was for.

The hint in the document controls now names the configured key. It has to be
asked for rather than assumed: the admin half of this plugin is configured
through `clientProps` and the iframe half by whoever renders
`LivePreviewInspectorClient`, so the iframe reports its setting over a new
`SETTINGS_MESSAGE_TYPE` message. A listener that mounts too late to hear it
keeps the shorter sentence, which is the right way for this to fail — what is
left is still true.

Also corrected in the README: it claimed Cmd/Ctrl-clicks bypassed the link
interception. They never did — `preventDefault` on a click stops the new-tab
open as surely as it stops navigation.

## 1.9.0

- **A reveal is about four times faster, and nothing about it changed except what it stops waiting for.** Measured against a twelve-section page in the theme playground, five reveals of increasing depth: 3078/1266/3100/3353/3519 ms before, 1025/134/721/722/724 ms after. Three separate things were being paid for:
  - **A timeout that always expired.** Every reveal ends by asking "did anything deeper mount after that scroll?" - and when the answer is no, it used to keep asking once per frame until the full `tabSwitchWaitMs` ran out. In five reveals out of five, the last thing before the flash was 1200-1440 ms of that: 45% of the whole reveal, spent re-evaluating a pure function of a DOM that had stopped changing. `waitForElement` can now give up on inactivity, so that wait ends ~140 ms after the page goes quiet instead of at its 1500 ms ceiling.
    - Opt-in per call site, and that is the whole point. A caller that just *clicked* a tab button is waiting for a reaction, and Payload really does mount a tab's fields a few hundred silent milliseconds later - reading silence as "nothing is coming" there is the regression 1.5.2 shipped. Only the one wait that triggered nothing at all uses it.
    - "Inactivity" covers finished resource loads as well as DOM mutations, so a field whose chunk is still downloading - placeholder rendered, then quiet for as long as the network takes - is not cut off mid-flight.
  - **Animated scroll corrections.** A correction compensates for layout that shifted *during* the scroll, so the element is already on screen and the delta is small; animating it added another few hundred ms of waiting on `scrollend` for motion nobody was following. Corrections are now instant even when the journey was smooth.
  - **The scroll animation itself, now optional.** It was the largest remaining cost - 0.9-1.3 s of a ~1.8 s reveal, because the flash and the caret only land once the page stops moving. New `scrollBehavior: 'instant' | 'smooth'` option (default `'smooth'`, unchanged). `'instant'` took the same five reveals to 134-1025 ms; the flash is what orients an editor either way. A reduced-motion preference still wins over both.
- **The auto-tag scan no longer reads script and style contents.** A Next.js page carries its RSC flight payload in inline `<script>` tags - measured at 452 KB on one twelve-section page, over 99% of all text in the document - and value matching was normalizing every one of those characters (a regex pass plus two string allocations) on every render batch of a live preview, several times a second, to throw the result away. Nothing was ever tagged there: `isTaggable` already refuses those elements. Same outcome, none of the work.

## 1.8.0

- **Registering is idempotent.** A plugin edits the collection objects in the config it is handed, and those objects can be *shared*: a theme exports one collection config and one `plugins` array, and a repository can build a second config from both — a localized variant for its test suite, a reference config, a script importing one config while the app holds the other. This function then ran twice over the same object and appended a second listener to the first config's collection. Two listeners are two message handlers on one window: a single click reveals twice, and the hint renders twice in the document controls. It now recognises *its own* registration by path and skips it, so a collection that already carries a custom control still gets the listener beside it.
- **`isInspectable(node)`, exported from `/path`** — the silent counterpart to `pathOf()`. `pathOf()` warns in development when handed data that never went through `inspectable()`, which is the right answer for a component that expected a wrapped node and got a raw one. It is the wrong answer for a *shared* renderer called with both: a theme's block renderer tags the page's layout, and the same function renders a block list read by a separate query, a global, and a public page that wraps nothing at all. There the warning fires on every block of every render, forever, about nothing — and the only way to avoid it was to reach into the internal path symbol.
  - A tree wrapped with `{ enabled: false }` reports `true`. The guard exists to separate "nobody wrapped this" from "wrapped and switched off", and only the first is a mistake worth reporting — the second is what a public page looks like by design.
  - Recognises a node that crossed a serialization boundary with `serializable: true`, on the same fallback `pathOf()` uses.

## 1.7.2

- **The preview now follows the caret, not just the field.** Every run of a rich-text field is tagged with a path *under* that field, so a focused editor - which only ever knew its own path - always pointed the preview at the first of them: editing paragraph twelve scrolled the preview to paragraph one. The focus message now carries where in the value the cursor sits, and the preview scrolls to the element rendering exactly that text.
  - It travels as the same *collapsed text* window the click direction already uses (stega characters removed, whitespace runs reduced to one space), built by the same code on both sides - so it survives the preview splitting a paragraph across its own inline markup, and works no matter which tagging layer covered the run. The preview prefers the outermost element containing the window, and where the caret's paragraph is wider than anything tagged in it (stega only encodes the runs it can), the widest tagged run inside the window. With no match - a stale preview, a value edited since - it falls back to the previous behavior.
  - Clicks are now a trigger of their own, not just focus. A pointer places the caret only *after* moving focus, so a hint read during `focusin` would still describe the field being left; and moving the caret *within* an already-focused editor fires no focus event at all, which is exactly the case of clicking from one paragraph to another. Pointer-driven focus is therefore reported from the click that completes the same interaction - one message per interaction either way, and keyboard focus (tabbing into a field) is unaffected.
- Single-input fields are deliberately left alone: their whole value is one tagged element in the preview, so the field's path already points at exactly the right one.
- Matching a caret against a field's tagged runs compares collapsed *text* only, so it no longer builds the per-character DOM index the caret placement needs - that index costs one object per character, and for a book-length rich text they were all thrown away again.

## 1.7.1

- **Fixed: clicking in the preview made the preview scroll away again.** Revealing a field ends by focusing it, and that focus fires `focusin` in the admin exactly like a real one - which 1.7.0's new reverse direction then sent straight back to the preview. On a long rich-text field the effect was clearly wrong: the admin scrolled to the clicked paragraph, and the preview immediately scrolled back to the field's first one, because a `focusin` only ever carries the field's own path. A reveal's own focus is no longer treated as user focus, so each direction now moves only the *other* side.

## 1.7.0

- **New: the reveal now works the other way round too.** Focusing a field in the admin form scrolls to and flashes the matching element in the Live Preview - the reverse of clicking a component to reveal its field. No new prop: `LivePreviewInspectorListener` already listens on the admin document, and `LivePreviewInspectorClient` already knows how to find a tagged element by path.
  - The admin side needs no new tagging either - every field Payload renders already carries its own path, either as its `id` (`field-<path>`, with dots doubled up as underscores - the same scheme this plugin's own `resolveFieldElement` already reads) or, for Lexical rich text, a `data-field-path` attribute. Focusing anywhere inside a field walks up to whichever of those is closest and reads the path straight off it, then converts numeric row indexes to the same stable `$rowId` form a click already resolves to, so reordering rows doesn't break the mapping mid-session.
  - A rich-text field's own path never tags a single element in the preview - only stega paths deep inside its Lexical JSON tree (one per rendered paragraph) or, for a run stega skips, an exact match from value matching. Landing on the first real paragraph is more useful than an arbitrary value-matched word, so the preview looks for a deeper path first and only falls back to an exact match, then a tagged ancestor, when nothing deeper exists.
- **New: the caret lands where you clicked, not at the top of the field.** Revealing a field ended in a plain `focus()`, which in a Lexical editor always puts the cursor at the very beginning - so on a long rich-text field the editor still had to find the clicked spot by hand. The click now carries the text position with it, and the listener places a real caret there; `text`/`textarea` inputs get their selection set the same way. When the position can't be resolved (a stale preview, a value edited since the click, a field that isn't editable text), focusing falls back to the previous behavior.
  - The two sides never share the same markup - the preview splits text across its own inline tags and template whitespace and, with stega tagging on, hides path characters inside it, while the admin renders Lexical's element tree - so a raw DOM offset means nothing across the boundary. The position travels as *collapsed text* (stega blocks removed, whitespace runs reduced to one space) plus an offset into it, built by the same code on both sides, with every collapsed character keeping the DOM position it came from. That makes it independent of which tagging layer (`pathOf`, stega, value matching) resolved the click.
  - The caret is set through the native selection rather than Lexical's API, so no editor instance is needed and nested Lexical block editors (which own their own contenteditable) are focused correctly.
  - The browser's caret-from-point answers for whatever paints on top, which under a full-card overlay link (`<a class="absolute inset-0">`) is an element with no text at all - the position is then measured from the tagged element's own character rects instead, mirroring how targeting already resolves clicks *through* such overlays. That fallback also covers clicks on a block's padding (nearest character wins) and browsers without a caret-from-point API.
- **New: the reveal scrolls the caret into view.** Scrolling positions the *field* at `scrollOffset`, which in a long rich text can leave the clicked position far below the fold. The caret is now scrolled into view afterwards - but only when it actually is off screen, so short fields don't get scrolled twice.

## 1.6.1

- README: added a link back to [raffiniert.biz](https://raffiniert.biz) and our blog post about the plugin. No code changes.

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
