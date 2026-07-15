import type { Page } from '@playwright/test'

import { expect, test } from '@playwright/test'

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

test('container inference: tags the content block section from its stega leaf', async ({ page }) => {
  await login(page)

  const frame = await openLivePreview(page)

  // The <section> around the stega-tagged <p> has no pathOf() either - it is
  // inferred as the block row's container from the leaf inside it.
  const section = frame.locator('[data-testid="content-section"]')
  await expect(section).toHaveAttribute('data-payload-live-preview-path', /^layout\.\$[^.]+$/)
  await expect(section).toHaveAttribute('data-payload-live-preview-auto', 'container')
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
