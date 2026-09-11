import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

declare global {
  interface Window {
    __activatedTabs?: Set<string>
    /** Tag names of preview elements that got the reverse-direction flash class. */
    __focusFlashes?: string[]
  }
}

const login = async (page: Page) => {
  await page.goto('/admin')
  await page.fill('#field-email', 'dev@payloadcms.com')
  await page.fill('#field-password', 'test')
  await page.click('.form-submit button')
  await expect(page).toHaveTitle(/Dashboard/)
}

const openLivePreview = async (page: Page) => {
  await page.goto('/admin/collections/posts')

  // The row link exists in the DOM before React hydration finishes, so an
  // early click can be swallowed - retry until the edit view actually loads.
  // Unlike the toggle button below, re-clicking here is always safe: it's
  // plain forward navigation, not something that flips back off.
  await expect(async () => {
    await page.click('.table tbody tr:first-child a')
    await expect(page).toHaveURL(/\/admin\/collections\/posts\/(?!create)[^/]+$/, { timeout: 3_000 })
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

  return page.frameLocator('#live-preview-iframe')
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
  await expect(paragraph).toBeVisible()

  await page.locator('[data-field-path="body"] [contenteditable="true"] p').first().click()

  await expect(paragraph).toHaveClass(/focused/)
})

test('clicking a later paragraph of a rich text flashes that paragraph, not the first', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)
  const paragraphs = frame.locator('[data-testid="rich-text-body"] p')
  await expect(paragraphs.first()).toBeVisible()

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
  await expect(paragraphs.first()).toBeVisible()

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
  await expect(paragraph).toBeVisible()

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
