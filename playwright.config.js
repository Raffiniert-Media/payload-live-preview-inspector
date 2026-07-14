import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './dev',
  testMatch: '**/e2e.spec.{ts,js}',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /*
   * Payload's admin routes compile on demand under `next dev`. On a cold
   * cache (always the case on CI) navigating through login → collection
   * list → a document's edit view (form, sidebar, live preview panel) can
   * comfortably exceed Playwright's 30s default before anything is even slow
   * by app standards - bump it well above what a warm local dev server needs.
   */
  timeout: process.env.CI ? 90_000 : 30_000,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm dev',
    reuseExistingServer: !process.env.CI,
    url: 'http://localhost:3000/admin',
  },
})
