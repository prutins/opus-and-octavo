import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

const port = 4174

// Use CHROMIUM_PATH or a system Chromium when there is one; otherwise fall back
// to the browser installed by `npx playwright install chromium`
const executablePath =
  process.env.CHROMIUM_PATH ||
  ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((path) => existsSync(path))

export default defineConfig({
  testDir: './tests',
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    // Functional tests run once, at desktop width; layout checks also run at phone width
    {
      name: 'mobile',
      testMatch: /(layout|text-spacing)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
  // A port of its own, so it doesn't collide with `npm run dev` on 5173
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: !process.env.CI,
  },
})
