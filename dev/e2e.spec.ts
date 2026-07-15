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
  await page.click('.table tbody tr:first-child a')

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
  const title = frame.locator('[data-payload-live-preview-path="title"]')

  await title.hover()
  await expect(title).toHaveClass(/payload-live-preview-inspector-hovered/)

  await title.click()

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
