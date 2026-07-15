# Changelog

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
