import { defineConfig } from '@playwright/test'
import config from './playwright.config.ts'

// `npm run samples`: regenerates the samples in public/ with
// tests/regenerate-samples.ts, at desktop width, on the same dev server as
// the tests
export default defineConfig({
  ...config,
  testMatch: 'regenerate-samples.ts',
  projects: config.projects?.filter((project) => project.name === 'desktop'),
})
