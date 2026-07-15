# Changelog

## 1.1.0

- `disableLinks` (default `true`) on `LivePreviewInspectorClient`: blocks link navigation inside the iframe, including client-side router links (Next.js' `<Link>`, etc.), via a capture-phase click interceptor. If your preview page has links you rely on working as normal navigation, pass `disableLinks={false}`.
- Admin-side listener: flash/focus now wait for the scroll to actually finish (via the `scrollend` event, with a timeout fallback) instead of firing while the page is still moving. Fields already visible in the viewport still flash immediately, even if not pixel-perfect at `scrollOffset`.

## 1.0.0

Initial release.

- `payloadLivePreviewInspector()` plugin: registers the click-to-scroll listener on configured collections and globals.
- `LivePreviewInspectorClient` for the frontend: hover highlight + click-to-message inside the Live Preview iframe, with optional `hoverColor` and `targetOrigin` props.
- `inspectable()` / `pathOf()` helpers: path-tracking proxy with reorder-safe row-id addressing for Array/Blocks fields, with an `enabled` option to switch off attribute emission on public pages.
- Admin-side listener: resolves row ids against live form state, expands collapsed accordions, scrolls to, flashes, and focuses the matching field.
