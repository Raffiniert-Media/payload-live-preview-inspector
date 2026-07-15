# payload-live-preview-inspector

A [Payload CMS](https://payloadcms.com) plugin that brings Storyblok-style click-to-scroll to Payload's built-in [Live Preview](https://payloadcms.com/docs/live-preview/overview): hover a component in the Live Preview iframe to highlight it, click it to smooth-scroll the admin edit form to (and briefly flash) the matching field — expanding any collapsed Array/Blocks accordions and focusing the field along the way.

This plugin does **not** set up Live Preview itself. It adds the click-to-scroll behavior on top of an already-working `admin.livePreview` configuration.

## How it works

- **In the iframe (your frontend):** `LivePreviewInspectorClient` listens for hover/click on any element carrying a `data-payload-live-preview-path` attribute. Hover highlights the element locally; click posts a message to the parent window with that path. It also blocks link navigation by default (see [Link interception](#link-interception) below).
- **In the admin panel:** `LivePreviewInspectorListener` is auto-registered by the plugin into the Edit view of every collection/global you enable it for. It listens for that message, resolves the field path (translating any Array/Blocks row ids to their current index via the live form state), expands any collapsed accordions in the way, scrolls to the field, and - once the scroll actually finishes moving - flashes and focuses it. It also shows a small hint next to the document controls while you're on the Live Preview tab.

Outside of an iframe (i.e. your frontend rendered directly, not inside Live Preview), `LivePreviewInspectorClient` is a no-op — it doesn't attach any listeners.

## Installation

```sh
pnpm add @raffiniert-media-ag/payload-live-preview-inspector
```

Requires `payload` and `@payloadcms/ui` in the Payload project (peer dependencies), and `react`/`react-dom` 19 wherever the components are used. `@payloadcms/ui` and `payload` are optional peers — a frontend-only project that only imports from `@raffiniert-media-ag/payload-live-preview-inspector/client` doesn't need either installed.

## Setup

### 1. Admin (Payload config)

Add the plugin and list the collections/globals that should get click-to-scroll. Each of these must already have Live Preview enabled (`admin.livePreview.collections`/`.globals`):

```ts
import { payloadLivePreviewInspector } from '@raffiniert-media-ag/payload-live-preview-inspector'

export default buildConfig({
  admin: {
    livePreview: {
      collections: ['posts'],
      url: ({ data }) => `https://your-frontend.example.com/preview/posts/${data.id}`,
    },
  },
  plugins: [
    payloadLivePreviewInspector({
      collections: {
        posts: true,
      },
      globals: {
        siteSettings: true,
      },
    }),
  ],
})
```

Optional styling/timing overrides (all have sensible defaults if omitted):

```ts
payloadLivePreviewInspector({
  collections: { posts: true },
  flashColor: '#ff6b00',        // default '#3fb950'
  flashDurationMs: 1500,        // default 1200
  scrollOffset: 120,            // default 100
  accordionAnimationMs: 400,    // default 350 - wait time after expanding an accordion, before scrolling
})
```

### 2. Frontend

Mount `LivePreviewInspectorClient` once, near the root of whatever page renders inside the Live Preview iframe:

```tsx
import { LivePreviewInspectorClient } from '@raffiniert-media-ag/payload-live-preview-inspector/client'

export default function PreviewPage() {
  return (
    <>
      <LivePreviewInspectorClient
        hoverColor="#ff6b00" // optional, defaults to shipped CSS
        disableLinks={false} // optional, defaults to true - see "Link interception" below
      />
      {/* ...your page... */}
    </>
  )
}
```

Then tag every element that should be clickable. The recommended way is `inspectable()` + `pathOf()`: wrap your document data once, and every nested object/array element you access knows its own field path — array/blocks rows are automatically addressed by their stable `id`, so the mapping survives reordering, inserting, or removing rows. You never have to think about paths, indexes, or row ids:

```tsx
import { inspectable, pathOf } from '@raffiniert-media-ag/payload-live-preview-inspector/client'

const page = inspectable(data)

<h1 {...pathOf(page, 'title')}>{page.title}</h1>

{page.layout?.map((block) => (
  <section key={block.id} {...pathOf(block)}>
    <h2 {...pathOf(block, 'heading')}>{block.heading}</h2>
  </section>
))}
```

`pathOf(node)` addresses the node itself (e.g. a whole block); `pathOf(node, 'fieldName')` addresses a field on it. This is plain JavaScript — no hooks, no context — so it works in Server Components too. One caveat: call `inspectable()` inside the component that renders the data; the path metadata does not survive a server-to-client component boundary.

There is no auto-discovery: an element without a path attribute is simply not clickable, silently.

## Link interception

By default, `LivePreviewInspectorClient` prevents any `<a href>` inside the Live Preview iframe from navigating - Live Preview is normally used to inspect fields, not to browse away from the page you're editing. This also blocks client-side router links (Next.js' `<Link>`, React Router's `<Link>`, etc.), which navigate via `history.pushState` in their own click handler regardless of `preventDefault()` - the click is intercepted in the capture phase, before it ever reaches the link's own handler.

Set `disableLinks={false}` to restore normal link navigation:

```tsx
<LivePreviewInspectorClient disableLinks={false} />
```

## Production / performance

Nothing here should worry you for real visitors, but it's worth understanding what runs where:

- `LivePreviewInspectorClient` is a guaranteed no-op outside an iframe — for normal visitors it attaches **no** event listeners and renders nothing. Its only cost is a few kB in the bundle.
- `inspectable()`'s proxy overhead is negligible (~0.02 ms per render for a 100-block document).
- The one visible effect: `pathOf()` bakes `data-payload-live-preview-path` attributes into the rendered HTML — roughly 40–60 bytes per tagged element, and they reveal your field structure. Harmless, but unnecessary on public pages.

The cleanest setup is a **dedicated preview route** (like this repo's `dev/app/(frontend)/preview/...`): the public route never imports any of this, so the cost for real visitors is exactly zero.

If instead you share the same components between public and preview rendering, pass your preview signal to `inspectable()` once — everything downstream (every `pathOf()` call) switches off cleanly and silently:

```tsx
import { draftMode } from 'next/headers'

const { isEnabled } = await draftMode()
const page = inspectable(data, { enabled: isEnabled })
// enabled: false → no path attributes in the HTML, pathOf() silently returns {}
```

No conditionals needed anywhere else — your components stay identical for both cases.

## API reference

Exported from `@raffiniert-media-ag/payload-live-preview-inspector` (admin/config side):

- `payloadLivePreviewInspector(options)` — the plugin.
  - `options.collections: Partial<Record<CollectionSlug, true>>` / `options.globals: Partial<Record<GlobalSlug, true>>` — which collections/globals get the listener.
  - `options.disabled` — turns the plugin off entirely.
  - `options.flashColor`, `options.flashDurationMs`, `options.scrollOffset`, `options.accordionAnimationMs` — see above.

Exported from `@raffiniert-media-ag/payload-live-preview-inspector/client` (frontend + admin components):

- `LivePreviewInspectorClient({ disableLinks?, hoverColor?, targetOrigin? })` — mount once in your preview page/layout. `disableLinks` (default `true`) blocks link navigation inside the iframe (see [Link interception](#link-interception)). `targetOrigin` pins the `postMessage` target to your admin panel's origin (e.g. `'https://cms.example.com'`); when omitted it is auto-detected (see Known limitations).
- `inspectable(data, options?)` — wraps document data in a path-tracking proxy (see above). `options.enabled: false` turns the whole tree off for public pages (see Production / performance).
- `pathOf(node, subPath?)` — returns the path attribute for a node obtained through `inspectable()`.
- `LIVE_PREVIEW_PATH_ATTRIBUTE` — the raw attribute name, if you'd rather set it yourself.
- `LIVE_PREVIEW_HOVER_CLASS_NAME` — stable, unscoped class name applied to the hovered element, so you can restyle the hover highlight with your own CSS instead of the shipped styles.
- `LivePreviewInspectorListener` — the admin-side component (you shouldn't need to reference this directly; the plugin registers it for you, with your plugin options passed through as its props).

## Known limitations

- Fields that only render inside a relationship's edit drawer (not the top-level Edit view) aren't reachable — the click silently no-ops.
- Multi-locale setups or fields duplicated inside drawers can get suffixed DOM ids (Payload's `generateFieldID`); the plain `field-<path>` lookup may occasionally miss in those edge cases.
- The frontend's `postMessage` falls back to a `'*'` target origin if neither `window.location.ancestorOrigins` (unsupported in Firefox) nor `document.referrer` resolve an origin. The message payload is just a field-path string, so this is low-risk — but you can pin it explicitly via `<LivePreviewInspectorClient targetOrigin="https://cms.example.com" />`.
- If a tagged Array/Blocks row is deleted between when the frontend was rendered and when you click it, its row id will no longer resolve — the click silently no-ops (same as any other unresolvable path).
- `disableLinks` only intercepts normal left-clicks; a middle-click or Cmd/Ctrl-click to open a link in a new tab bypasses it (usually what you'd want anyway).
- Scroll-then-reveal timing relies on the `scrollend` event (supported in all current evergreen browsers). If a browser doesn't fire it, a 1s fallback timeout still reveals the field, just without the exact "waits for the scroll to finish" precision.

## Local development

This repo's `dev/` folder is a full Payload app (SQLite, no external services needed) used to develop and manually test the plugin:

```sh
pnpm install
pnpm dev
```

Log in at `http://localhost:3000/admin` with `dev@payloadcms.com` / `test`, open the seeded "Hello Live Preview" post, and try it on its Live Preview tab.

```sh
pnpm test:int   # vitest - unit tests for path resolution (src/) + plugin config injection (dev/)
pnpm test:e2e   # playwright - full hover/click/scroll/flash flow
```
