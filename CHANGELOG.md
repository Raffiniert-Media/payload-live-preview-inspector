# Changelog

## 1.0.0 (unreleased)

Initial release.

- `payloadLivePreviewInspector()` plugin: registers the click-to-scroll listener on configured collections and globals.
- `LivePreviewInspectorClient` for the frontend: hover highlight + click-to-message inside the Live Preview iframe, with optional `hoverColor` and `targetOrigin` props.
- `disableLinks` (default `true`) on `LivePreviewInspectorClient`: blocks link navigation inside the iframe, including client-side router links (Next.js' `<Link>`, etc.), via a capture-phase click interceptor.
- `inspectable()` / `pathOf()` helpers: path-tracking proxy with reorder-safe row-id addressing for Array/Blocks fields, with an `enabled` option to switch off attribute emission on public pages.
- Admin-side listener: resolves row ids against live form state, expands collapsed accordions, waits for the scroll to actually finish, then flashes and focuses the matching field.
