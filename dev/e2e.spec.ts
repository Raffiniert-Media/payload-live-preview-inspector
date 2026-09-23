import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    __activatedTabs?: Set<string>
    /** Tag names of preview elements that got the reverse-direction flash class. */
    __focusFlashes?: string[]
    /** Set by the dev app's host-style capture listener when it sees the click. */
    __hostSawClick?: boolean
  }
}

const login = async (page: Page) => {
  await page.goto('/admin')
  await page.fill('#field-email', 'dev@payloadcms.com')
  await page.fill('#field-password', 'test')
  await page.click('.form-submit button')
  await expect(page).toHaveTitle(/Dashboard/)
  // Every test starts with Payload's defaults: no remembered tab, no rows
  // left expanded or collapsed by an earlier test.
  await resetPreferences(page)
}

const openLivePreview = async (page: Page, collection: 'pages' | 'posts' = 'posts') => {
  await page.goto(`/admin/collections/${collection}`)

  // The row link exists in the DOM before React hydration finishes, so an
  // early click can be swallowed - retry until the edit view actually loads.
  // Unlike the toggle button below, re-clicking here is always safe: it's
  // plain forward navigation, not something that flips back off.
  await expect(async () => {
    await page.click('.table tbody tr:first-child a')
    await expect(page).toHaveURL(new RegExp(`/admin/collections/${collection}/(?!create)[^/]+$`), { timeout: 3_000 })
  }).toPass({ timeout: 30_000 })

  const toggler = page.locator('#live-preview-toggler')
  const iframe = page.locator('#live-preview-iframe')

  // Payload renders live preview as an inline toggle button (eye icon) in the
  // document controls, not as a separate view tab/link. The button is in the
  // DOM before React hydration finishes, so an early click can be swallowed -
  // this retries until the iframe appears. Because it's a *toggle*, blindly
  // re-clicking on every retry is wrong: if the first click actually worked
  // and only the iframe's render is slow (e.g. a cold Turbopack compile on
  // CI), a second click would just switch it off again, oscillating forever.
  // Payload marks the active state with a `--active` class, so only click
  // when it isn't already on.
  await expect(async () => {
    const isActive = await toggler.evaluate((el) => el.classList.contains('live-preview-toggler--active'))
    if (!isActive) {
      await toggler.click()
    }
    await expect(iframe).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 60_000 })

  // Server-rendered markup is visible - and clickable - before React has
  // attached a single handler; wait for the preview to say it's hydrated.
  const frame = page.frameLocator('#live-preview-iframe')
  await expect(frame.locator('main[data-hydrated]')).toBeAttached({ timeout: 30_000 })

  return frame
}

test('should render admin panel logo', async ({ page }) => {
  await login(page)
  await expect(page.locator('.graphic-icon')).toBeVisible()
})

test('clicking a component in the live preview scrolls and highlights the matching field', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  // The h1 specifically - value matching auto-tags the footer with the same
  // "title" path (covered by its own test below).
  const title = frame.locator('h1[data-payload-live-preview-path="title"]')

  await title.hover()
  await expect(title).toHaveClass(/payload-live-preview-inspector-hovered/)

  await title.click()

  const titleField = page.locator('#field-title')
  await expect(titleField).toBeInViewport()
  await expect(titleField).toHaveClass(/flash/)
})

test('focusing a field in the admin form scrolls to and flashes the matching element in the preview', async ({
  page,
}) => {
  await login(page)

  const frame = await openLivePreview(page)
  const title = frame.locator('h1[data-payload-live-preview-path="title"]')
  // The preview's message listener is only attached once its client script has
  // mounted - waiting for its own tagging to appear is proof of that, unlike
  // the iframe merely being visible.
  await expect(title).toBeVisible()

  await page.locator('#field-title').click()

  await expect(title).toHaveClass(/focused/)
})

test('focusing a rich-text sub-editor in the admin form flashes its matching paragraph in the preview', async ({
  page,
}) => {
  await login(page)

  const frame = await openLivePreview(page)
  const paragraph = frame.locator('[data-testid="rich-text-body"] p').first()
  await expect(paragraph).toHaveAttribute('data-payload-live-preview-path', /^body\./)

  await page.locator('[data-field-path="body"] [contenteditable="true"] p').first().click()

  await expect(paragraph).toHaveClass(/focused/)
})

test('clicking a later paragraph of a rich text flashes that paragraph, not the first', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const paragraphs = frame.locator('[data-testid="rich-text-body"] p')
  // Tagged, not merely visible: the paragraphs are server-rendered, so they
  // show before the preview's client script is listening for focus.
  await expect(paragraphs.first()).toHaveAttribute('data-payload-live-preview-path', /^body\./)

  // Every run of a rich text is tagged with a path under the same field, so
  // the field path alone would always point at the first of them - only the
  // caret's own text tells the preview which paragraph is being edited.
  await page.locator('[data-field-path="body"] [contenteditable="true"] p').nth(1).click()

  await expect(paragraphs.nth(1)).toHaveClass(/focused/)
  await expect(paragraphs.first()).not.toHaveClass(/focused/)
})

test('moving the caret within an already-focused rich text follows along in the preview', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const paragraphs = frame.locator('[data-testid="rich-text-body"] p')
  // Tagged, not merely visible: the paragraphs are server-rendered, so they
  // show before the preview's client script is listening for focus.
  await expect(paragraphs.first()).toHaveAttribute('data-payload-live-preview-path', /^body\./)

  const editorParagraphs = page.locator('[data-field-path="body"] [contenteditable="true"] p')
  await editorParagraphs.nth(1).click()
  await expect(paragraphs.nth(1)).toHaveClass(/focused/)

  // The editor already has focus, so this fires no further focus event - the
  // click itself has to carry the new position.
  await editorParagraphs.first().click()

  await expect(paragraphs.first()).toHaveClass(/focused/)
})

test('clicking in the preview never scrolls the preview back (the reveal\'s own focus is not echoed)', async ({
  page,
}) => {
  await login(page)

  const frame = await openLivePreview(page)
  const paragraph = frame.locator('[data-testid="rich-text-body"] p').first()
  await expect(paragraph).toHaveAttribute('data-payload-live-preview-path', /^body\./)

  // Record every reverse-direction flash instead of sampling for the class
  // later: it clears itself after its animation, so a plain count could pass
  // simply by looking too late.
  await frame.locator('body').evaluate((body) => {
    const { defaultView: view, documentElement } = body.ownerDocument
    view!.__focusFlashes = []
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const el = mutation.target as HTMLElement
        if (/focused/.test(el.className)) {
          view!.__focusFlashes?.push(el.tagName)
        }
      }
    }).observe(documentElement, { attributeFilter: ['class'], subtree: true })
  })

  await paragraph.click()

  // The reveal has finished - which means it has focused the editor, the
  // `focusin` the reverse direction would otherwise bounce straight back here.
  const bodyField = page.locator('[data-field-path="body"]')
  await expect(bodyField).toHaveClass(/flash/)
  await page.waitForTimeout(500)

  // Nothing in the preview may be flashed: a bounced `focusin` only carries
  // the field's own path, so it would scroll back to that field's first
  // paragraph - away from whatever the user actually clicked.
  const flashes = await frame.locator('body').evaluate((body) => body.ownerDocument.defaultView!.__focusFlashes)
  expect(flashes).toEqual([])
})

test('stega: auto-tags text rendered without pathOf and scrolls to its field on click', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)

  // The content block's <p> renders `block.text` through the stega-enabled
  // proxy and carries no pathOf() attribute in the JSX - the scanner decodes
  // the invisible path and tags it.
  const text = frame.locator('[data-testid="stega-text"]')
  await expect(text).toHaveAttribute('data-payload-live-preview-path', /^layout\.\$.+\.text$/)
  await expect(text).toHaveAttribute('data-payload-live-preview-auto', 'stega')

  // The card is covered by an absolutely-positioned overlay link (the
  // full-card-link pattern) that is itself tagged (its aria-label carries
  // the same stega path as the <p>). Clicking at the <p>'s own position -
  // force: true, since the overlay is what actually receives the native
  // event - must still resolve to the smaller, more specific <p> rather
  // than the overlay or the card container (and not navigate, thanks to
  // disableLinks): our click handler resolves by pointer position via
  // elementsFromPoint, not by the event's native target.
  await text.click({ force: true })

  const textField = page.locator('#field-layout__1__text')
  await expect(textField).toBeInViewport()
  await expect(textField).toHaveClass(/flash/)
})

test('switches to the admin tab containing the clicked field', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)

  // The Content tab is active by default; metaNote's field only exists in
  // the DOM once the listener sweeps to the Meta tab.
  await expect(page.locator('#field-metaNote')).toHaveCount(0)

  await frame.locator('[data-testid="meta-note"]').click()

  const metaField = page.locator('#field-metaNote')
  await expect(metaField).toBeInViewport()
  await expect(metaField).toHaveClass(/flash/)
})

test('reveals a field behind a closed accordion without sweeping tabs', async ({ page }) => {
  await login(page)

  await openLivePreview(page)

  // A previous test may have left "Meta" as the last-active tab (persisted
  // as a preference) - make sure "Content" (where `layout` lives) is active
  // before touching its row, regardless of run order.
  await page.locator('.tabs-field__tab-button', { hasText: 'Content' }).click()
  await expect(page.locator('.tabs-field__tab-button--active')).toHaveText('Content')

  // Collapse the contentBlock row (`layout.1`), then reload so it starts
  // *already* collapsed from the persisted preference - that's the state a
  // real user hits (a row left collapsed from a previous session), and it's
  // meaningfully different from toggling it collapsed live in this same
  // session: Payload only skips ever mounting the row's fields when it's
  // collapsed from the initial render, not when it's collapsed after having
  // been open.
  await page.evaluate(() => {
    const collapsible = document.querySelector('#layout-row-1 .collapsible')
    if (!collapsible?.classList.contains('collapsible--collapsed')) {
      document
        .querySelector<HTMLButtonElement>('#layout-row-1 .collapsible__toggle-wrap .collapsible__toggle')
        ?.click()
    }
  })
  await expect(page.locator('#layout-row-1 .collapsible')).toHaveClass(/collapsible--collapsed/)

  const frame = await openLivePreview(page)
  await expect(page.locator('#layout-row-1 .collapsible')).toHaveClass(/collapsible--collapsed/)

  // Its field lives in the "Content" tab, which is already active by
  // default. A tab sweep is only needed when the target is genuinely in
  // another tab; a closed accordion in the *current* tab should never
  // trigger one.
  await expect(page.locator('#field-layout__1__text')).toHaveCount(0)

  // Record every tab button that becomes active while the click resolves -
  // the bug this guards against briefly activates "Meta" while sweeping,
  // even though "Content" (the only tab that could ever contain the target)
  // was active the whole time.
  await page.evaluate(() => {
    window.__activatedTabs = new Set<string>()
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const button = mutation.target as HTMLElement
        if (button.classList.contains('tabs-field__tab-button--active')) {
          window.__activatedTabs?.add(button.textContent ?? '')
        }
      }
    }).observe(document.body, { attributeFilter: ['class'], subtree: true })
  })

  const text = frame.locator('[data-testid="stega-text"]')
  await expect(text).toHaveAttribute('data-payload-live-preview-path', /^layout\.\$.+\.text$/)
  await text.click({ force: true })

  const textField = page.locator('#field-layout__1__text')
  await expect(textField).toBeInViewport()
  await expect(textField).toHaveClass(/flash/)

  // No tab button should ever activate - "Content" was already active, so a
  // correct resolution never touches any tab at all.
  const activatedTabs = await page.evaluate(() => Array.from(window.__activatedTabs ?? []))
  expect(activatedTabs).toEqual([])
})

test('rich text behind a closed accordion: waits for the editor to mount instead of sweeping tabs', async ({
  page,
}) => {
  await login(page)

  await openLivePreview(page)

  await page.locator('.tabs-field__tab-button', { hasText: 'Content' }).click()
  await expect(page.locator('.tabs-field__tab-button--active')).toHaveText('Content')

  // Start with the contentBlock row already collapsed from the initial
  // render (persisted preference + reload), so its Lexical editor was never
  // mounted. Unlike the plain textarea above, the editor takes well over the
  // accordion-animation budget to mount after expansion - the case that used
  // to get misread as "wrong tab" and trigger a visible sweep.
  await page.evaluate(() => {
    const collapsible = document.querySelector('#layout-row-1 .collapsible')
    if (!collapsible?.classList.contains('collapsible--collapsed')) {
      document
        .querySelector<HTMLButtonElement>('#layout-row-1 .collapsible__toggle-wrap .collapsible__toggle')
        ?.click()
    }
  })
  await expect(page.locator('#layout-row-1 .collapsible')).toHaveClass(/collapsible--collapsed/)

  const frame = await openLivePreview(page)
  await expect(page.locator('#layout-row-1 .collapsible')).toHaveClass(/collapsible--collapsed/)
  await expect(page.locator('[data-field-path="layout.1.body"]')).toHaveCount(0)

  await page.evaluate(() => {
    window.__activatedTabs = new Set<string>()
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const button = mutation.target as HTMLElement
        if (button.classList.contains('tabs-field__tab-button--active')) {
          window.__activatedTabs?.add(button.textContent ?? '')
        }
      }
    }).observe(document.body, { attributeFilter: ['class'], subtree: true })
  })

  const paragraph = frame.locator('[data-testid="block-rich-text"] p').first()
  await expect(paragraph).toHaveAttribute('data-payload-live-preview-path', /^layout\.\$.+\.body\.root\./)
  // force: the card's overlay link covers the section (see the stega test).
  await paragraph.click({ force: true })

  const bodyField = page.locator('[data-field-path="layout.1.body"]')
  await expect(bodyField).toBeInViewport()
  await expect(bodyField).toHaveClass(/flash/)

  const activatedTabs = await page.evaluate(() => Array.from(window.__activatedTabs ?? []))
  expect(activatedTabs).toEqual([])
})

test('reveals a field behind a collapsed row inside another tab (switch, then expand)', async ({ page }) => {
  await login(page)

  await openLivePreview(page)

  // Collapse the metaSections row while the Meta tab is active, then leave
  // Content as the persisted tab and reload - the row now starts collapsed
  // inside an unmounted tab panel, so its field can never appear from a tab
  // switch alone. The sweep must lock onto the Meta tab via the row wrapper
  // (progress, not the exact element) and expand it from there.
  await page.locator('.tabs-field__tab-button', { hasText: 'Meta' }).click()
  await expect(page.locator('.tabs-field__tab-button--active')).toHaveText('Meta')
  await page.evaluate(() => {
    const collapsible = document.querySelector('#metaSections-row-0 .collapsible')
    if (!collapsible?.classList.contains('collapsible--collapsed')) {
      document
        .querySelector<HTMLButtonElement>('#metaSections-row-0 .collapsible__toggle-wrap .collapsible__toggle')
        ?.click()
    }
  })
  await expect(page.locator('#metaSections-row-0 .collapsible')).toHaveClass(/collapsible--collapsed/)
  await page.locator('.tabs-field__tab-button', { hasText: 'Content' }).click()
  await expect(page.locator('.tabs-field__tab-button--active')).toHaveText('Content')

  const frame = await openLivePreview(page)
  await expect(page.locator('.tabs-field__tab-button--active')).toHaveText('Content')
  await expect(page.locator('#metaSections-row-0')).toHaveCount(0)

  const sectionTitle = frame.locator('[data-testid="meta-section-title"]').first()
  await expect(sectionTitle).toHaveAttribute('data-payload-live-preview-path', /^metaSections\.\$.+\.title$/)
  await sectionTitle.click()

  const titleField = page.locator('#field-metaSections__0__title')
  await expect(titleField).toBeInViewport()
  await expect(titleField).toHaveClass(/flash/)
})

test('container inference: tags the content block section from its stega leaf', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)

  // The <section> around the stega-tagged <p> has no pathOf() either - it is
  // inferred as the block row's container from the leaf inside it.
  const section = frame.locator('[data-testid="content-section"]')
  await expect(section).toHaveAttribute('data-payload-live-preview-path', /^layout\.\$[^.]+$/)
  await expect(section).toHaveAttribute('data-payload-live-preview-auto', 'container')
})

test('rich text: stega paths inside the Lexical tree collapse to the rich-text field', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)

  // The first paragraph's multi-word text run is rendered through the stega
  // proxy - its <p> carries a deep path into the Lexical JSON
  // (body.root.children...), which the listener must collapse to the `body`
  // form field.
  const paragraph = frame.locator('[data-testid="rich-text-body"] p').first()
  await expect(paragraph).toHaveAttribute('data-payload-live-preview-path', /^body\.root\.children\./)
  await expect(paragraph).toHaveAttribute('data-payload-live-preview-auto', 'stega')

  await paragraph.click()

  const bodyField = page.locator('[data-field-path="body"]')
  await expect(bodyField).toBeInViewport()
  await expect(bodyField).toHaveClass(/flash/)
})

test('rich text: the caret lands where the click did, not at the top of the editor', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)

  // Clicking into the *second* paragraph must put the cursor there. Focusing
  // the editor alone would always land in the first one, so the paragraph the
  // caret ends up in is what distinguishes the two behaviors.
  const paragraph = frame.locator('[data-testid="rich-text-body"] p').nth(1)
  await expect(paragraph).toHaveAttribute('data-payload-live-preview-path', /^body\.root\.children\./)

  const box = (await paragraph.boundingBox())!
  await paragraph.click({ position: { x: box.width * 0.7, y: box.height * 0.25 } })

  /** The admin's current caret, described in terms of the paragraph it sits in. */
  const readCaret = () =>
    page.evaluate(() => {
      const selection = window.getSelection()
      const node = selection?.anchorNode
      const paragraphEl = node?.parentElement?.closest('p')

      if (!selection?.isCollapsed || !paragraphEl?.closest('[data-field-path="body"]')) {
        return null
      }

      const runs = Array.from(paragraphEl.childNodes).flatMap((child) =>
        child.nodeType === Node.TEXT_NODE ? [child] : Array.from(child.childNodes),
      )

      return {
        offset: selection.anchorOffset,
        paragraph: paragraphEl.textContent ?? '',
        run: runs.indexOf(node as ChildNode),
      }
    })

  await expect
    .poll(async () => (await readCaret())?.paragraph ?? null, { timeout: 15_000 })
    .toContain('Even a lone')

  const caret = (await readCaret())!
  // Not at the paragraph's very start either: a later text run, a nonzero
  // offset, or both.
  expect(caret.offset + Math.max(caret.run, 0)).toBeGreaterThan(0)
})

test('rich text: the caret survives a click through a full-card overlay link', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)

  // The block's rich text sits under an absolutely positioned overlay link,
  // so the browser's caret-from-point answers for the overlay - which has no
  // text. The position has to be measured from the tagged paragraph itself,
  // the same way targeting already looks through the overlay.
  const paragraph = frame.locator('[data-testid="block-rich-text"] p').first()
  const box = (await paragraph.boundingBox())!
  await paragraph.click({ force: true, position: { x: 100, y: box.height / 2 } })

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const selection = window.getSelection()
          const node = selection?.anchorNode

          return node?.parentElement?.closest('[data-field-path$=".body"]')
            ? { offset: selection!.anchorOffset, text: node.textContent }
            : null
        }),
      { timeout: 20_000 },
    )
    .toMatchObject({ text: expect.stringContaining('nested inside a block row') })

  const offset = await page.evaluate(() => window.getSelection()!.anchorOffset)
  expect(offset).toBeGreaterThan(0)
})

test('rich text: value matching covers text runs stega skips (single words)', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)

  // The bolded single word is skipped by stega's two-word prose rule - the
  // admin's leaf collection now includes the rich-text value's text runs, so
  // value matching tags it with the `body` field's path.
  const bold = frame.locator('[data-testid="rich-text-body"] strong')
  await expect(bold).toHaveAttribute('data-payload-live-preview-path', 'body', { timeout: 15_000 })
  await expect(bold).toHaveAttribute('data-payload-live-preview-auto', 'match')

  await bold.click()

  const bodyField = page.locator('[data-field-path="body"]')
  await expect(bodyField).toBeInViewport()
  await expect(bodyField).toHaveClass(/flash/)
})

test('value matching: tags an element rendered from raw, unproxied data', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)

  // The footer renders the raw `data.title` - no proxy, no stega, no pathOf.
  // The scanner asks the admin panel for the field values and matches the
  // footer's text against the unique `title` value.
  const footer = frame.locator('[data-testid="match-title"]')
  await expect(footer).toHaveAttribute('data-payload-live-preview-path', 'title', { timeout: 15_000 })
  await expect(footer).toHaveAttribute('data-payload-live-preview-auto', 'match')

  await footer.click()

  const titleField = page.locator('#field-title')
  await expect(titleField).toBeInViewport()
  await expect(titleField).toHaveClass(/flash/)
})

test('value matching follows an edit: the element keeps its tag after its text changes', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const footer = frame.locator('[data-testid="match-title"]')
  await expect(footer).toHaveAttribute('data-payload-live-preview-path', 'title', { timeout: 15_000 })

  // Not saved: only the form state changes, which is what live preview renders.
  await page.locator('#field-title').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' edited')

  // The preview re-renders the footer with the new text; the admin pushes
  // the new values; the stale tag is re-judged against them.
  await expect(footer).toContainText('edited')
  await expect(footer).toHaveAttribute('data-payload-live-preview-path', 'title')
  await expect(footer).toHaveAttribute('data-payload-live-preview-auto', 'match')
})

test('disables link navigation inside the live preview iframe by default', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const link = frame.locator('[data-testid="live-preview-test-link"]')

  await link.click()

  // The link's own onClick (simulating a client-side router, like Next.js'
  // <Link>) never ran - our capture-phase interceptor stopped the event
  // before it reached the link's bubble-phase handler.
  await expect(link).not.toHaveAttribute('data-navigated', 'true')
})

/*
 * What a click means in the preview, and the escape hatch.
 *
 * `disableInteractions` is the answer to a complaint with a real shape: a click
 * on a card both revealed its field *and* opened its dialog, so an editor
 * reaching for a field got a modal over the page they were editing. The rule
 * now is that the inspector takes a click only when it has a field to answer
 * with — which is also why the third test below matters as much as the first
 * two: everything outside the edited document (a header, a cookie banner) has
 * to keep working, or the preview stops being usable at all.
 */
test('a plain click reveals the field without running the page’s own handler', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const button = frame.locator('[data-testid="tagged-button"]')

  await button.click()

  // The button’s handler never ran: the capture-phase interceptor stopped the
  // event before the bubble phase, the same way it stops a link.
  await expect(button).not.toHaveAttribute('data-activated', 'true')

  // And the click still did its job — the field it resolves to is revealed.
  const titleField = page.locator('#field-title')
  await expect(titleField).toBeInViewport()
  await expect(titleField).toHaveClass(/flash/)
})

test('holding the modifier operates the page and reveals nothing', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const button = frame.locator('[data-testid="tagged-button"]')

  await button.click({ modifiers: ['Alt'] })

  await expect(button).toHaveAttribute('data-activated', 'true')

  // No reveal: the click was the page’s, so the form was left where it was.
  await expect(page.locator('#field-title')).not.toHaveClass(/flash/)
})

test('a click the inspector cannot answer is left to the page', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const button = frame.locator('[data-testid="untagged-button"]')

  await button.click()

  await expect(button).toHaveAttribute('data-activated', 'true')
})

test('the admin hint names the modifier the preview reported', async ({ page }) => {
  await login(page)

  await openLivePreview(page)

  /*
   * The hint is the only place an editor can learn the modifier exists, and it
   * is rendered in the admin while the setting lives in the iframe — so the
   * iframe reports it. Without that message the sentence would be describing a
   * default rather than this preview.
   */
  await expect(page.locator('text=hold ⌥ (Alt) to use the page instead')).toBeVisible()
})

/*
 * The order between this plugin and a host page that wants the same click.
 *
 * Both listen in the capture phase, and for the same node the DOM runs them in
 * registration order — so on `document` the winner is whichever component
 * mounted first, which neither controls. Measured against the theme this plugin
 * was written for: a popup link inside a tagged section still opened its popup.
 * The interception is on `window` for that reason, and the capture phase
 * descends Window → Document, so it is first regardless.
 */
test('a host page’s own capture listener does not get a suppressed click', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const link = frame.locator('[data-testid="tagged-fragment-link"]')

  await link.click()

  /*
   * Evaluated through an element, because `openLivePreview` hands back a
   * `FrameLocator` — which has no `evaluate` of its own. Inside the callback
   * `window` is the iframe's.
   */
  const sawIt = await frame
    .locator('body')
    .evaluate(() => window.__hostSawClick === true)

  expect(sawIt, 'the host listener ran despite the click being suppressed').toBe(false)
})

test('the modifier hands an in-page link to the host, without navigating', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const link = frame.locator('[data-testid="tagged-fragment-link"]')

  await link.click({ modifiers: ['Alt'] })

  expect(await frame.locator('body').evaluate(() => window.__hostSawClick === true)).toBe(true)

  /*
   * And the browser did nothing of its own: no jump to the fragment, which is
   * also what stops an alt-click being read as "download this".
   */
  expect(await frame.locator('body').evaluate(() => window.location.hash)).toBe('')
})

/*
 * The complex page (`dev/collections/Pages.ts`): forty collapsed sections,
 * tabs inside block rows, arrays in collapsed rows in collapsed rows, a named
 * tab and a collapsible in the last tab. Every reveal here has to land on the
 * exact field with ONE click - a second click being what an editor does when
 * the first one seemed to do nothing - and inside a time budget, read off the
 * `performance.measure` entry each reveal leaves behind.
 */

type RevealMeasure = {
  duration: number
  longestFrames?: Record<string, number>
  outcome: string
  path: string
  phases: Record<string, number>
}

const REVEAL_MEASURE = 'payload-live-preview-inspector:reveal'

/** Generous for CI; locally reveals on this page take a fraction of it. */
const REVEAL_BUDGET_MS = process.env.CI ? 4_000 : 2_500

const revealCount = (page: Page) =>
  page.evaluate((name) => performance.getEntriesByName(name).length, REVEAL_MEASURE)

const nextReveal = async (page: Page, before: number): Promise<RevealMeasure> => {
  await expect.poll(() => revealCount(page), { timeout: 15_000 }).toBeGreaterThan(before)
  return page.evaluate((name) => {
    const entry = performance.getEntriesByName(name).at(-1) as PerformanceMeasure
    return { duration: entry.duration, ...(entry.detail as Omit<RevealMeasure, 'duration'>) }
  }, REVEAL_MEASURE)
}

/**
 * Payload remembers expanded rows, open collapsibles and active tabs in the
 * user's preferences - so without this, whatever an earlier run opened
 * would already be open, and the reveal under test would have nothing left
 * to do.
 */
const resetPreferences = async (page: Page) => {
  const response = await page.request.delete('/api/payload-preferences?where[id][exists]=true')
  expect(response.ok()).toBe(true)
}

type Motion = {
  layoutShift: number
  maxStep: number
  movedAfterFlash: number
  moves: number
  reversals: number
  trace: string
}

/**
 * Records the admin's scroll position frame by frame until `field` flashes
 * and for a moment after - what an editor perceives as smooth or not, which
 * a duration can't tell: a quick reveal can still stop, start again, turn
 * back, or keep moving under a field that has already lit up.
 */
const recordMotion = (page: Page, field: string) =>
  page.evaluate((selector) => {
    type Trace = { flashedAt?: number; frames: { at: number; d: number; y: number }[]; shift: number }
    const trace: Trace = { frames: [], shift: 0 }
    ;(window as unknown as { __motion: Trace }).__motion = trace
    // Content moving under the eye that no scroll explains - a row's fields
    // popping in, a tab's content swapped: the browser's own layout-shift score.
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number }[]) {
        trace.shift += entry.value
      }
    }).observe({ type: 'layout-shift' })

    // What the editor sees move, frame to frame: the field once it can be
    // seen, otherwise what is on screen - never something hidden behind a
    // curtain (rendering there moves nothing anyone sees), nor the scroll
    // position alone (the browser also shifts it to keep the view steady
    // while content above resizes, which nobody sees either).
    const hidden = (el: Element) => Boolean(el.closest('[style*="opacity: 0"]'))
    const visibleProbes = (): Element[] => {
      const target = document.querySelector(selector)
      if (target && !hidden(target)) {
        const { bottom, top } = target.getBoundingClientRect()
        if (bottom > 0 && top < window.innerHeight) {
          return [target]
        }
      }
      // In the form's column - not on the nav or the preview, which stay put.
      const column = document.querySelector('.render-fields')?.getBoundingClientRect()
      const x = column ? column.left + Math.min(40, column.width / 2) : window.innerWidth * 0.3
      return [0.25, 0.5, 0.75]
        .map((y) => document.elementFromPoint(x, window.innerHeight * y))
        .filter((el): el is Element => Boolean(el) && !hidden(el!) && getComputedStyle(el!).position !== 'sticky')
    }

    let probes: { el: Element; top: number }[] = []
    const startedAt = performance.now()
    const tick = (now: number) => {
      const deltas = probes
        .filter(({ el }) => el.isConnected)
        .map(({ el, top }) => top - el.getBoundingClientRect().top)
        .sort((a, b) => a - b)
      const d = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0
      trace.frames.push({ at: now, d, y: window.scrollY })
      probes = visibleProbes().map((el) => ({ el, top: el.getBoundingClientRect().top }))

      if (trace.flashedAt === undefined && /flash/.test(document.querySelector(selector)?.className ?? '')) {
        trace.flashedAt = now
      }
      if (now - startedAt < 8_000 && (trace.flashedAt === undefined || now - trace.flashedAt < 600)) {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  }, field)

const motionOf = async (page: Page): Promise<Motion> => {
  await page.waitForTimeout(650)
  return page.evaluate(() => {
    const { flashedAt, frames, shift } = (
      window as unknown as { __motion: { flashedAt?: number; frames: { at: number; d: number; y: number }[]; shift: number } }
    ).__motion
    let maxStep = 0
    let moves = 0
    let reversals = 0
    let movedAfterFlash = 0
    let direction = 0
    let still = true
    // A motion counts once it covers 20px - a pixel or two of drift is
    // nothing anyone sees as the page moving again.
    let travelled = 0
    for (const { at, d } of frames.slice(1)) {
      if (Math.abs(d) < 1) {
        still = true
        continue
      }
      maxStep = Math.max(maxStep, Math.abs(d))
      if (still) {
        travelled = 0
      }
      const before = travelled
      travelled += Math.abs(d)
      if (before < 20 && travelled >= 20) {
        moves += 1
      }
      still = false
      const sign = Math.sign(d)
      if (direction !== 0 && sign !== direction) {
        reversals += 1
      }
      direction = sign
      if (flashedAt !== undefined && at > flashedAt) {
        movedAfterFlash += Math.abs(d)
      }
    }
    // `DEBUG_REVEALS=1`: the frames themselves - ms relative to the flash, visible motion.
    const trace = frames.map((f) => [Math.round(f.at - (flashedAt ?? 0)), Math.round(f.d)])
    return {
      layoutShift: Math.round(shift * 1000) / 1000,
      maxStep: Math.round(maxStep),
      movedAfterFlash: Math.round(movedAfterFlash),
      moves,
      reversals,
      trace: JSON.stringify(trace),
    }
  })
}

const COMPLEX_TARGETS = [
  { field: '#field-seo__metaDescription', text: 'The meta description of the complex page', why: 'named tab' },
  { field: '#field-sections__30__heading', text: 'Feature section 31', why: 'collapsed row 31 of 40, other tab' },
  {
    field: '#field-sections__34__extra__caption',
    text: 'Caption behind the named tab of section 35',
    why: 'named tab nested in a collapsed block row',
  },
  {
    field: '#field-sections__38__cards__1__points__1__label',
    text: 'Point 2 of card 2 in section 39',
    why: 'array in a collapsed row in a collapsed row in a collapsed row',
  },
  { field: '#field-faq__4__answer', text: 'The answer to frequently asked question number 5.', why: 'collapsible + collapsed row, last tab' },
  { field: '#field-intro', text: 'An introduction to the complex page', why: 'back to the first tab' },
]

test('complex page: every field is reached with one click, exactly, within budget', async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000)
  await login(page)
  const frame = await openLivePreview(page, 'pages')
  await expect(frame.locator('h1[data-payload-live-preview-path="title"]')).toBeVisible()

  const report: string[] = []
  if (process.env.DEBUG_REVEALS) {
    // eslint-disable-next-line no-console -- opt-in debugging aid
    page.on('console', (message) => message.text().includes('live-preview-inspector') && console.log(message.text()))
  }

  if (process.env.CPU_THROTTLE) {
    // A slower machine than the one running the suite: where a heavy row
    // mount turns into a visible stutter.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE) })
  }

  for (const target of COMPLEX_TARGETS) {
    const before = await revealCount(page)
    const startedAt = Date.now()
    await recordMotion(page, target.field)
    await frame.getByText(target.text, { exact: false }).first().click()

    // Click to flash, as the editor sees it - measurable against any version
    // of the listener, which is what `BASELINE=1` is for: it records instead
    // of asserting, so the numbers of an older build can be compared.
    if (process.env.BASELINE) {
      const flashed = await expect(page.locator(target.field))
        .toHaveClass(/flash/, { timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
      report.push(`${flashed ? `${Date.now() - startedAt}ms` : 'NOT REACHED with one click'} - ${target.why}`)
      continue
    }

    await expect(page.locator(target.field), target.why).toHaveClass(/flash/, { timeout: 10_000 })
    const wall = Date.now() - startedAt

    const reveal = await nextReveal(page, before)
    const phases = Object.entries(reveal.phases)
      .map(([name, ms]) => `${name} ${ms}${reveal.longestFrames ? ` [frame ${reveal.longestFrames[name]}]` : ''}`)
      .join(' / ')
    const motion = await motionOf(page)
    if (process.env.DEBUG_REVEALS) {
      // eslint-disable-next-line no-console -- opt-in debugging aid
      console.log(`MOTION ${target.why}: ${motion.trace}`)
    }
    report.push(
      `${wall}ms (reveal ${Math.round(reveal.duration)}ms ${reveal.outcome}) - ${target.why} (${phases})` +
        ` - ${motion.moves} move(s), ${motion.reversals} reversal(s), largest step ${motion.maxStep}px,` +
        ` ${motion.movedAfterFlash}px after the flash, layout shift ${motion.layoutShift}`,
    )

    expect(reveal.outcome, target.why).toBe('exact')
    await expect(page.locator(target.field), target.why).toBeInViewport()
    expect(reveal.duration, target.why).toBeLessThan(REVEAL_BUDGET_MS)
    // Smooth, not only quick: the page is still once the field lights up,
    // and it got there without a jump - a tab switched out of sight used to
    // drop the page by thousands of pixels in one frame. (Turning back is
    // fine: up to a tab bar, then down into the tab, is the way there.)
    expect(motion.movedAfterFlash, `${target.why}: page moved after the flash`).toBeLessThan(4)
    expect(motion.maxStep, `${target.why}: page jumped`).toBeLessThan(600)
    // One motion to where things open, at most one more to the field - not a
    // halt and a new start at every level of a nested path.
    expect(motion.moves, `${target.why}: stop-and-go`).toBeLessThanOrEqual(2)
  }

  test.info().annotations.push({ type: 'reveals', description: report.join('\n') })
  // eslint-disable-next-line no-console -- the numbers are the point of this test
  console.log(`complex page reveals:\n  ${report.join('\n  ')}`)
})

test('complex page: opening a row in the admin takes the preview to that section, never to the top', async ({
  page,
}) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000)
  await login(page)
  const frame = await openLivePreview(page, 'pages')
  await page.locator('.tabs-field__tab-button', { hasText: 'Sections' }).click()

  // The row's header is in the row but in none of its fields - it used to
  // resolve to the whole blocks field, and the preview went to its first
  // row: the top of the page.
  const header = page.locator('#sections-row-30 .collapsible__toggle-wrap').first()
  // Clear of the admin's sticky document controls, which would take the click.
  await header.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  // Where an editor clicks to open it: the header's free right part (the
  // block name input covers its left).
  const box = (await header.boundingBox())!
  await header.click({ position: { x: box.width * 0.75, y: box.height / 2 } })
  await expect(page.locator('#field-sections__30__heading')).toBeVisible()

  const section = frame.locator('h2', { hasText: 'Feature section 31' })
  await expect(section).toBeInViewport()
  await expect(frame.locator('h1')).not.toBeInViewport()

  // The blocks field itself has no one place on the page: the preview stays.
  const addBlock = page.locator('#field-sections').getByRole('button', { name: /add block/i }).last()
  await addBlock.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await addBlock.click()
  await page.waitForTimeout(1_000)
  await expect(section).toBeInViewport()
  await page.keyboard.press('Escape')
})

test('complex page: a row Payload fails to render into is rendered anyway', async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000)
  // What editors saw on a customer page: a row the reveal opened stayed
  // empty - Payload renders a row's fields only once an IntersectionObserver
  // reports them near the viewport, and that report never came. Recreated
  // here by swallowing every report for a moment after the click.
  await page.addInitScript(() => {
    const Native = window.IntersectionObserver
    window.IntersectionObserver = class extends Native {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super((entries, observer) => {
          if (!(window as unknown as { __swallowIntersections?: boolean }).__swallowIntersections) {
            callback(entries, observer)
          }
        }, options)
      }
    }
  })
  await login(page)
  const frame = await openLivePreview(page, 'pages')
  await page.locator('.tabs-field__tab-button', { hasText: 'Sections' }).click()
  await expect(page.locator('#sections-row-30')).toBeAttached()

  await page.evaluate(() => {
    const w = window as unknown as { __swallowIntersections?: boolean }
    w.__swallowIntersections = true
    setTimeout(() => (w.__swallowIntersections = false), 1_200)
  })
  await frame.locator('h2', { hasText: 'Feature section 31' }).click()

  await expect(page.locator('#field-sections__30__heading')).toHaveClass(/flash/, { timeout: 10_000 })
  await expect(page.locator('#field-sections__30__heading')).toBeInViewport()
})

test('complex page: a row that was open all along, inside a section the reveal opens, is rendered too', async ({
  page,
}) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000)
  // The row found stuck on the customer page: not one the reveal opened, but
  // one Payload remembered open inside a section the reveal opened.
  await page.addInitScript(() => {
    const Native = window.IntersectionObserver
    window.IntersectionObserver = class extends Native {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super((entries, observer) => {
          if (!(window as unknown as { __swallowIntersections?: boolean }).__swallowIntersections) {
            callback(entries, observer)
          }
        }, options)
      }
    }
  })
  await login(page)
  const frame = await openLivePreview(page, 'pages')
  await page.locator('.tabs-field__tab-button', { hasText: 'Sections' }).click()

  const toggle = async (id: string) => {
    const header = page.locator(`#${id} .collapsible__toggle-wrap`).first()
    await header.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    const box = (await header.boundingBox())!
    await header.click({ position: { x: box.width * 0.75, y: box.height / 2 } })
  }
  await toggle('sections-row-40')
  await toggle('sections-40-rows-row-1')
  await expect(page.locator('#field-sections__40__rows__1__layout')).toBeAttached()
  await toggle('sections-row-40')
  await expect(page.locator('#sections-row-40 > * > .collapsible, #sections-row-40 .collapsible').first()).toHaveClass(
    /collapsible--collapsed/,
  )

  await page.evaluate(() => {
    const w = window as unknown as { __swallowIntersections?: boolean }
    w.__swallowIntersections = true
    setTimeout(() => (w.__swallowIntersections = false), 1_200)
  })
  await frame.getByText('Grid row 2 column 2 headline').first().click()

  const target = page.locator('#field-sections__40__rows__1__columns__1__content__0__headline')
  await expect(target).toHaveClass(/flash/, { timeout: 10_000 })
  await expect(target).toBeInViewport()
})

test('complex page: a second click in the same section leaves what is already open alone', async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000)
  await login(page)
  const frame = await openLivePreview(page, 'pages')
  const openColumn = page.locator('#sections-40-rows-1-columns-row-1')
  await frame.getByText('Grid row 2 column 2 headline').first().click()
  await expect(page.locator('#field-sections__40__rows__1__columns__1__content__0__headline')).toHaveClass(/flash/)

  // The column just revealed sits right below the one the next click opens.
  // Opening that one may fade in what opens - never the open column beside
  // it, which used to fade out and in again for nothing.
  await openColumn.evaluate((el) => {
    const w = window as unknown as { __openColumnHidden?: boolean }
    new MutationObserver(() => {
      if ((el as HTMLElement).style.opacity === '0') {
        w.__openColumnHidden = true
      }
    }).observe(el, { attributeFilter: ['style'], attributes: true })
  })
  await frame.getByText('Grid row 2 column 1 headline').first().click()
  await expect(page.locator('#field-sections__40__rows__1__columns__0__content__0__headline')).toHaveClass(/flash/)

  expect(await page.evaluate(() => (window as unknown as { __openColumnHidden?: boolean }).__openColumnHidden)).toBeFalsy()
})

test('complex page: a second click during a reveal wins, and the first one leaves no trace', async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000)
  await login(page)
  const frame = await openLivePreview(page, 'pages')
  await expect(frame.locator('h1[data-payload-live-preview-path="title"]')).toBeVisible()

  // First click heads for the last tab; the second, right behind it, for the
  // sections. An un-cancelled first reveal would keep clicking tabs (and
  // finally restore the original one) underneath the second.
  await frame.getByText('The answer to frequently asked question number 2.').click()
  await frame.getByText('Tabbed section 20').click()

  const sectionsTab = page.locator('.tabs-field__tab-button', { hasText: 'Sections' })
  await expect(sectionsTab).toHaveClass(/tabs-field__tab-button--active/)
  await expect(page.locator('#field-sections__19__heading')).toBeInViewport()

  // And it stays that way - nothing from the first reveal lands late.
  await page.waitForTimeout(2_000)
  await expect(sectionsTab).toHaveClass(/tabs-field__tab-button--active/)
  await expect(page.locator('#field-sections__19__heading')).toBeInViewport()
})

test('complex page: a click with no field to go to says so, in the preview and in the admin', async ({ page }) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000)
  await login(page)
  const frame = await openLivePreview(page, 'pages')
  const stale = frame.locator('[data-testid="stale-row"]')
  await expect(stale).toBeVisible()

  await stale.click()

  const mark = frame.locator('[data-payload-live-preview-inspector-overlay] [data-state]')
  await expect(mark).toHaveAttribute('data-state', 'not-found')
  await expect(mark).toContainText('Not in this form')
  await expect(page.getByText('isn’t in this form')).toBeVisible()
  // And then it goes - nothing is left looking busy.
  await expect(mark).toHaveCount(0)
})

test('complex page: a click is marked at once, names its field by its admin label, and the mark goes', async ({
  page,
}) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000)
  await login(page)
  const frame = await openLivePreview(page, 'pages')
  // Not an exact text match: stega puts invisible characters into the text.
  const heading = frame.locator('h2', { hasText: 'Feature section 13' })

  await heading.click()

  // In the preview: framed right away, with the label the admin gives the
  // field (`label: 'Überschrift'` in the fixture, not its name).
  const mark = frame.locator('[data-payload-live-preview-inspector-overlay] [data-state]')
  await expect(mark).toBeVisible()
  await expect(mark).toContainText('Überschrift')
  // In the admin: the hint says where it's going.
  await expect(page.getByText('→ Überschrift')).toBeVisible()

  await expect(page.locator('#field-sections__12__heading')).toHaveClass(/flash/)
  await expect(mark).toHaveCount(0)
})

test('complex page: the preview takes on the admin accent colour', async ({ page }) => {
  await login(page)
  await openLivePreview(page, 'pages')
  const admin = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--theme-success-500').trim(),
  )
  const preview = page.frame({ url: /\/preview\/pages\// })!

  await expect
    .poll(() =>
      preview.evaluate(() =>
        document.documentElement.style.getPropertyValue('--payload-live-preview-inspector-accent').trim(),
      ),
    )
    .toBe(admin)
})

test('complex page: focusing a field glides the preview to its element, clear of the sticky header, in one motion', async ({
  page,
}) => {
  test.setTimeout(process.env.CI ? 240_000 : 90_000)
  await login(page)
  const frame = await openLivePreview(page, 'pages')
  const intro = frame.locator('p[data-payload-live-preview-path="intro"]')
  await expect(intro).toBeVisible()
  const preview = page.frame({ url: /\/preview\/pages\// })!

  // Start from the bottom of the preview, and record its scroll position on
  // every frame from here on.
  await preview.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
    const w = window as unknown as { __scrolls: number[] }
    w.__scrolls = []
    const tick = () => {
      w.__scrolls.push(window.scrollY)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  await page.locator('.tabs-field__tab-button', { hasText: 'Content' }).click()
  await page.locator('#field-intro').click()
  await expect(intro).toHaveClass(/focused/)

  const { headerBottom, scrolls, top } = await preview.evaluate(() => ({
    headerBottom: document.querySelector('header')!.getBoundingClientRect().bottom,
    scrolls: (window as unknown as { __scrolls: number[] }).__scrolls,
    top: document.querySelector('p[data-payload-live-preview-path="intro"]')!.getBoundingClientRect().top,
  }))

  // Landed below the header, not behind it...
  expect(top).toBeGreaterThanOrEqual(headerBottom)
  expect(top).toBeLessThan(headerBottom + 40)
  // ...on the way there, not with a correction after: the page only ever
  // moved up, and never by more than the glide itself does in a frame.
  const steps = scrolls.slice(1).map((y, i) => y - scrolls[i]).filter((step) => step !== 0)
  expect(steps.every((step) => step < 0)).toBe(true)
  const lastSteps = steps.slice(-3).map(Math.abs)
  expect(Math.max(...lastSteps)).toBeLessThan(50)
})
