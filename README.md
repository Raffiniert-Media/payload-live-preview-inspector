# payload-live-preview-inspector

A [Payload CMS](https://payloadcms.com) plugin that brings Storyblok-style click-to-scroll to Payload's built-in [Live Preview](https://payloadcms.com/docs/live-preview/overview): hover a component in the Live Preview iframe to highlight it, click it to smooth-scroll the admin edit form to (and briefly flash) the matching field — expanding any collapsed Array/Blocks accordions and focusing the field along the way.

This plugin does **not** set up Live Preview itself. It adds the click-to-scroll behavior on top of an already-working `admin.livePreview` configuration.

## How it works

- **In the iframe (your frontend):** `LivePreviewInspectorClient` tracks the pointer and highlights the tagged element under it; click posts a message to the parent window with that element's path. Targeting is point-based (`elementsFromPoint`), so tagged text stays hoverable/clickable even beneath a full-card overlay link (`<a class="absolute inset-0">`) that swallows every pointer event. It also blocks link navigation by default (see [Link interception](#link-interception) below).
- **In the admin panel:** `LivePreviewInspectorListener` is auto-registered by the plugin into the Edit view of every collection/global you enable it for. It listens for that message, resolves the field path (translating any Array/Blocks row ids to their current index via the live form state), switches to the tab containing the field if needed (Payload unmounts inactive tab panels), expands any collapsed accordions in the way, scrolls to the field, and - once the scroll actually finishes moving - flashes and focuses it. It also shows a small hint next to the document controls while you're on the Live Preview tab.

Elements get their path attribute through three layers, from most to least precise — explicit tagging always wins, and each layer only fills in what the previous one didn't cover (see [Tagging: three layers](#tagging-three-layers)):

1. **`pathOf()` (explicit)** — you tag an element yourself; exact, works for anything.
2. **Stega (automatic, opt-in)** — `inspectable(data, { stega: true })` encodes each string field's path into its value as invisible characters; the client decodes them from the rendered DOM and tags the containing elements. Text content needs no `pathOf()` at all.
3. **Value matching (automatic, zero-config)** — the client asks the admin panel for the document's current field values and tags any element whose whole text equals exactly one field's value. No frontend data changes needed whatsoever.

From auto-tagged leaf elements, the client additionally **infers block containers**: elements whose decoded paths share an Array/Blocks row prefix vote for their common ancestor as that row's container, so clicking a block's padding jumps to the whole row.

Outside of an iframe (i.e. your frontend rendered directly, not inside Live Preview), `LivePreviewInspectorClient` is a no-op — it doesn't attach any listeners, doesn't scan anything, and doesn't touch the DOM.

## Installation

```sh
pnpm add @raffiniert-media-ag/payload-live-preview-inspector
```

Requires `payload` and `@payloadcms/ui` in the Payload project (peer dependencies), and `react`/`react-dom` 19 wherever the components are used. `@payloadcms/ui` and `payload` are optional peers — a frontend-only project that only imports from the `/client` and `/path` subpaths doesn't need either installed.

The package has four entry points, split so that nothing heavy can leak into your frontend bundles:

| Subpath     | Contains                                                          | Import it from                                                                          |
| ----------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `.`         | `payloadLivePreviewInspector()` plugin                            | `payload.config.ts`                                                                      |
| `/client`   | `LivePreviewInspectorClient` (a `'use client'` component)         | only the file that mounts the component                                                  |
| `/path`     | `inspectable`, `pathOf`, `stegaClean`, constants — pure, no components | everywhere else: pages, blocks, Server Components, shared code                       |
| `/listener` | `LivePreviewInspectorListener` (admin panel, imports `@payloadcms/ui`) | nowhere — the plugin wires it into the import map for you                            |

**Why this matters:** bundlers treat `'use client'` barrels as indivisible units. If a client component imports `pathOf` from `/client`, the entire inspector component lands in a shared chunk that every page loads for every visitor. Importing the helpers from `/path` instead keeps your public bundles completely free of plugin code. (`/client` still re-exports the helpers for convenience/backwards compatibility — use that only in the file that mounts the component anyway.)

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
  accordionAnimationMs: 400,    // default 350 - max wait for a just-expanded accordion to render, before scrolling
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

Then tag every element that should be clickable. The recommended way is `inspectable()` + `pathOf()`: wrap your document data once, and every nested object/array element you access knows its own field path — array/blocks rows are automatically addressed by their stable `id`, so the mapping survives reordering, inserting, or removing rows. You never have to think about paths, indexes, or row ids. Import the helpers from the pure `/path` subpath (see [Installation](#installation) for why):

```tsx
import { inspectable, pathOf } from '@raffiniert-media-ag/payload-live-preview-inspector/path'

const page = inspectable(data)

<h1 {...pathOf(page, 'title')}>{page.title}</h1>

{page.layout?.map((block) => (
  <section key={block.id} {...pathOf(block)}>
    <h2 {...pathOf(block, 'heading')}>{block.heading}</h2>
  </section>
))}
```

`pathOf(node)` addresses the node itself (e.g. a whole block); `pathOf(node, 'fieldName')` addresses a field on it. This is plain JavaScript — no hooks, no context — so it works in Server Components too.

You don't have to tag everything by hand — see the next section for the two automatic layers.

## Tagging: three layers

The client resolves clicks against `data-payload-live-preview-path` attributes, and there are three ways those attributes get onto elements. They compose: an attribute set explicitly via `pathOf()` is never overwritten by an automatic layer, and stega runs before value matching. Elements tagged automatically also carry `data-payload-live-preview-auto="stega" | "match" | "container"` so you can tell the layers apart in devtools.

### 1. `pathOf()` — explicit, most precise

What the [Setup](#2-frontend) section shows. Works for anything (images, numbers, whole blocks, elements without text) and is the only layer that doesn't rely on any heuristic. Use it wherever the automatic layers don't reach.

### 2. Stega — automatic tagging for text content

Pass `stega: true` to `inspectable()`:

```tsx
const page = inspectable(data, { stega: true })

<h1>{page.title}</h1>               {/* auto-tagged - no pathOf() needed */}
{page.layout?.map((block) => (
  <section key={block.id}>          {/* inferred as the block's container */}
    <h2>{block.heading}</h2>        {/* auto-tagged */}
  </section>
))}
```

Every encoded string read from the proxy carries its field path as a run of invisible (zero-width) characters. Wherever that string ends up in the rendered DOM — however many components, props, or even server-to-client boundaries it passed through — the client's scanner decodes the path and tags the containing element. A few text-bearing attributes (`alt`, `title`, `aria-label`, `placeholder`) are scanned too.

**What gets encoded — and the select/enum hazard.** Only prose-shaped values are encoded: **a string must contain at least two whitespace-separated words**. This is the load-bearing safety rule, not an optimization. Single-token values — `'default'`, `'topRight'`, `'primary-dark'` — are exactly what consuming code uses as object keys, `switch` discriminants, CSS-class-map lookups, and strict-comparison targets; encoding one of them makes `iconColorStates[block.iconColorState]` silently return `undefined` and crash in production. Payload **select/radio values, enum-like fields, and variant tokens practically never contain whitespace, so they are safe by construction** — you don't have to enumerate or audit them. The flip side: single-word *display* text (a `'Kontakt'` heading) isn't stega-tagged either; that's intentional — a missing tag is harmless (the value-matching layer or `pathOf()` covers it), a corrupted enum is not.

Also always skipped: the keys `id`, `blockType`, `blockName`, `slug`; values shaped like URLs, relative paths, emails, ISO dates, numbers, hex colors, or uuids; and strings read out of arrays (`hasMany` values are compared with `includes()`).

For the cases the defaults can't know about, pass an options object instead of `true`:

```ts
const page = inspectable(data, {
  stega: {
    // never encode these fields, even if their values look like prose
    // (e.g. a field storing a space-separated CSS class list):
    skipKeys: ['cssClasses'],
    // the final say per string - receives the default decision:
    filter: ({ defaultEncode, key, path, value }) =>
      key === 'buttonLabel' ? true : defaultEncode, // force-encode a known-rendered single-word field
  },
})
```

For any encoded value you need raw — comparisons, `new Date()`, sending data to an API — use `stegaClean()`:

```ts
import { stegaClean } from '@raffiniert-media-ag/payload-live-preview-inspector/path'

stegaClean(page.title)      // the raw string
stegaClean(page)            // deep-cleans a whole plain-object tree
```

Trade-off to know about: encoded strings contain extra characters. `===` against literals fails, `.length` is inflated, and truncating with `slice()` can cut a block in half (the tag is then simply lost — never wrong). The two-word rule keeps this away from programmatic values, but prose you compare or parse still needs `stegaClean()` (or a `skipKeys` entry). All of it only exists in preview mode (see [Production](#production--performance)).

### 3. Value matching — zero-config

On by default in `LivePreviewInspectorClient` — nothing to integrate beyond mounting the component. The client asks the admin panel (via the plugin's listener) for the document's current string field values, then tags any element whose entire text content equals exactly one field's value. When you edit a field, the preview re-renders and the mapping refreshes automatically.

It is deliberately conservative: values shared by several fields are never matched (ambiguous), values shorter than 3 characters are ignored, and only whole-element matches count — transformed text (formatted dates, truncated teasers, rich text) simply doesn't match. Wrong tags are avoided at the cost of missing tags; the other two layers fill the gaps. Set `valueMatching={false}` to turn it off.

### Container inference

After the leaf layers run, elements whose paths share an Array/Blocks row prefix (`layout.$abc.…`) vote for their closest common DOM ancestor as that row's container — it gets tagged with the row path (`layout.$abc`), so clicking anywhere in the block jumps to the whole row in the admin. This is skipped when the row is already tagged (e.g. a manual `pathOf(block)`), and never tags `<body>` or an ancestor that also contains a *different* row's elements (interleaved markup). Explicit `pathOf(block)` remains more reliable for blocks that render little or no text.

An element no layer reaches is simply not clickable, silently.

## Link interception

By default, `LivePreviewInspectorClient` prevents any `<a href>` inside the Live Preview iframe from navigating - Live Preview is normally used to inspect fields, not to browse away from the page you're editing. This also blocks client-side router links (Next.js' `<Link>`, React Router's `<Link>`, etc.), which navigate via `history.pushState` in their own click handler regardless of `preventDefault()` - the click is intercepted in the capture phase, before it ever reaches the link's own handler.

Set `disableLinks={false}` to restore normal link navigation:

```tsx
<LivePreviewInspectorClient disableLinks={false} />
```

## Server/client component boundaries

The proxy's path metadata does not survive serialization: pass a wrapped node as a prop from a Server Component into a Client Component and `pathOf()` on the other side comes up empty. Three ways around it, in order of preference:

1. **Stega** (`stega: true`) — encoded strings survive any boundary because the path travels inside the value itself. For text content this makes the problem disappear entirely.
2. **`serializable: true`** — embeds each object node's path as an enumerable `__payloadLivePreviewPath` property that survives JSON, so `pathOf()` keeps working on the other side. Caveats: the key shows up in `Object.keys()`/spreads of wrapped nodes, and array nodes can't carry it across the boundary (their object children still do).
3. **Pass `pathOf()` results as props** — `pathOf()` returns a plain `{ 'data-payload-live-preview-path': '…' }` object, which serializes fine.

```tsx
const page = inspectable(data, { serializable: true, stega: true })
```

## Production / performance

Nothing here reaches real visitors, but it's worth understanding what runs where:

- `LivePreviewInspectorClient` is a guaranteed no-op outside an iframe — for normal visitors it attaches **no** event listeners, runs **no** scanner, and renders nothing. Its only cost is a few kB in the bundle. The auto-tagging layers (stega decoding, value matching, container inference) only ever execute inside the Live Preview iframe.
- `inspectable()`'s proxy overhead is negligible (~0.02 ms per render for a 100-block document).
- The visible effects — `pathOf()` attributes (roughly 40–60 bytes per tagged element), stega characters inside string values, `serializable` marker keys — all exist only while the tree is enabled. They reveal your field structure and are unnecessary on public pages.

The cleanest setup is a **dedicated preview route** (like this repo's `dev/app/(frontend)/preview/...`): the public route never imports any of this, so the cost for real visitors is exactly zero. Value matching pairs especially well with this — it needs no data changes at all, so the preview route can be a plain copy of the public one plus the mounted client component.

If instead you share the same components between public and preview rendering, pass your preview signal to `inspectable()` once — `enabled: false` is the single kill switch for **all** output layers (path attributes, stega characters, serialized markers), and everything downstream switches off cleanly and silently:

```tsx
import { draftMode } from 'next/headers'

const { isEnabled } = await draftMode()
const page = inspectable(data, { enabled: isEnabled, stega: true })
// enabled: false → no path attributes, no stega characters, no markers -
// nothing of this ends up in the HTML served to real visitors.
```

No conditionals needed anywhere else — your components stay identical for both cases.

## API reference

Exported from `@raffiniert-media-ag/payload-live-preview-inspector` (admin/config side):

- `payloadLivePreviewInspector(options)` — the plugin.
  - `options.collections: Partial<Record<CollectionSlug, true>>` / `options.globals: Partial<Record<GlobalSlug, true>>` — which collections/globals get the listener.
  - `options.disabled` — turns the plugin off entirely.
  - `options.flashColor`, `options.flashDurationMs`, `options.scrollOffset`, `options.accordionAnimationMs` — see above.

Exported from `@raffiniert-media-ag/payload-live-preview-inspector/path` (pure data helpers — safe to import anywhere, zero client-bundle impact; all of these are also re-exported from `/client` for convenience):

- `inspectable(data, options?)` — wraps document data in a path-tracking proxy (see above). `options.enabled: false` turns the whole tree off for public pages (see Production / performance); `options.stega: true | { skipKeys?, filter? }` encodes paths into prose-shaped string values (see [Tagging](#tagging-three-layers) for the two-word rule and the fine-tuning options); `options.serializable: true` embeds paths as serialization-surviving marker keys (see [Server/client component boundaries](#serverclient-component-boundaries)).
- `pathOf(node, subPath?)` — returns the path attribute for a node obtained through `inspectable()` (directly, or across a JSON boundary with `serializable: true`).
- `stegaClean(value)` — strips stega-encoded blocks from a string, or deeply from every string in a plain object/array tree. Use wherever you need a raw value.
- `LIVE_PREVIEW_PATH_ATTRIBUTE` — the raw attribute name, if you'd rather set it yourself.
- `LIVE_PREVIEW_AUTO_ATTRIBUTE` — marker attribute (`"stega" | "match" | "container"`) identifying auto-tagged elements.
- `SERIALIZED_PATH_KEY` — the marker key used by `serializable: true`, e.g. to strip it before forwarding data elsewhere.
- `LIVE_PREVIEW_HOVER_CLASS_NAME` — stable, unscoped class name applied to the hovered element, so you can restyle the hover highlight with your own CSS instead of the shipped styles.

Exported from `@raffiniert-media-ag/payload-live-preview-inspector/client` (import only where you mount the component):

- `LivePreviewInspectorClient({ disableLinks?, hoverColor?, stega?, targetOrigin?, valueMatching? })` — mount once in your preview page/layout. `disableLinks` (default `true`) blocks link navigation inside the iframe (see [Link interception](#link-interception)). `stega` (default `true`) decodes stega-encoded paths from the rendered DOM. `valueMatching` (default `true`) tags elements by matching their text against the document's field values. `targetOrigin` pins the `postMessage` target to your admin panel's origin (e.g. `'https://cms.example.com'`); when omitted it is auto-detected (see Known limitations).

Exported from `@raffiniert-media-ag/payload-live-preview-inspector/listener` (admin panel only):

- `LivePreviewInspectorListener` — the admin-side component (you shouldn't need to reference this directly; the plugin registers it in the import map for you, with your plugin options passed through as its props). Kept on its own subpath because it imports `@payloadcms/ui`, which must never reach a frontend bundle.

## Known limitations

- Fields that only render inside a relationship's edit drawer (not the top-level Edit view) aren't reachable — the click silently no-ops.
- The tab sweep clicks through the form's tabs to find an unmounted field, which briefly flips tabs while searching (originals are restored when nothing is found). A path that resolves to no real form field falls back to its nearest rendered ancestor, as before.
- Multi-locale setups or fields duplicated inside drawers can get suffixed DOM ids (Payload's `generateFieldID`); the plain `field-<path>` lookup may occasionally miss in those edge cases.
- The frontend's `postMessage` falls back to a `'*'` target origin if neither `window.location.ancestorOrigins` (unsupported in Firefox) nor `document.referrer` resolve an origin. The message payload is just a field-path string, so this is low-risk — but you can pin it explicitly via `<LivePreviewInspectorClient targetOrigin="https://cms.example.com" />`.
- If a tagged Array/Blocks row is deleted between when the frontend was rendered and when you click it, its row id will no longer resolve — the click silently no-ops (same as any other unresolvable path).
- `disableLinks` only intercepts normal left-clicks; a middle-click or Cmd/Ctrl-click to open a link in a new tab bypasses it (usually what you'd want anyway).
- Scroll-then-reveal timing relies on the `scrollend` event (supported in all current evergreen browsers). If a browser doesn't fire it, a 1s fallback timeout still reveals the field, just without the exact "waits for the scroll to finish" precision.
- Stega only reaches values that end up as rendered text (or in `alt`/`title`/`aria-label`/`placeholder`), and only when they contain two or more words. Images, numbers, booleans, selects rendered as icons, single-word display text — anything the two-word rule or the DOM excludes — still needs `pathOf()` or value matching. String operations in your frontend that reshape the value (`slice()`, `split()`, regexes) can destroy the encoded block; the element is then simply untagged, never mistagged.
- Stega characters live inside string values while previewing: text copied out of the preview iframe carries them, and screen-reader behavior on zero-width characters varies. Both are preview-only concerns; public pages never contain them (with `enabled` wired correctly).
- Value matching requires exact whole-element text equality with exactly one field's current value. Formatted dates, truncated teasers, values rendered inside larger sentences, and rich text don't match — by design (missing a tag beats guessing wrong).
- Container inference is a heuristic: a block that renders no taggable leaf at all gets no container, and heavily interleaved markup makes it back off. `pathOf(block)` is the reliable way to tag those.

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
