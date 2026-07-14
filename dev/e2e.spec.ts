import { expect, test } from '@playwright/test'

const login = async (page: import('@playwright/test').Page) => {
  await page.goto('/admin')
  await page.fill('#field-email', 'dev@payloadcms.com')
  await page.fill('#field-password', 'test')
  await page.click('.form-submit button')
  await expect(page).toHaveTitle(/Dashboard/)
}

test('should render admin panel logo', async ({ page }) => {
  await login(page)
  await expect(page.locator('.graphic-icon')).toBeVisible()
})

test('clicking a component in the live preview scrolls and highlights the matching field', async ({ page }) => {
  await login(page)

  await page.goto('/admin/collections/posts')
  await page.click('.table tbody tr:first-child a')

  // Payload renders live preview as an inline toggle button (eye icon) in the
  // document controls, not as a separate view tab/link. The button is in the
  // DOM before React hydration finishes, so an early click can be swallowed -
  // retry the click until the iframe actually appears.
  await expect(async () => {
    await page.click('#live-preview-toggler')
    await expect(page.locator('#live-preview-iframe')).toBeVisible({ timeout: 2_000 })
  }).toPass()

  const frame = page.frameLocator('#live-preview-iframe')
  const title = frame.locator('[data-payload-live-preview-path="title"]')

  await title.hover()
  await expect(title).toHaveClass(/payload-live-preview-inspector-hovered/)

  await title.click()

  const titleField = page.locator('#field-title')
  await expect(titleField).toBeInViewport()
  await expect(titleField).toHaveClass(/flash/)
})
