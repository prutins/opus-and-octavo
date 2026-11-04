import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, expect, type Page } from '@playwright/test'

// Every test fails if the page logs an error or warning, or throws
export const test = base.extend<{ consoleProblems: string[] }>({
  consoleProblems: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type())) problems.push(`${message.type()}: ${message.text()}`)
      })
      page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`))
      await use(problems)
      expect(problems, 'console errors and warnings').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

export const sampleConcert = fileURLToPath(new URL('../public/2026-spring-the-sage-city-symphony-anonymized.yaml', import.meta.url))
export const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

// A 1×1 PNG, for photo uploads
export const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

export const preview = (page: Page) => page.locator('article.document-paper')
export const status = (page: Page) => page.getByRole('status')

// The program's colour variables, as set on the preview
export const documentColors = (page: Page) =>
  preview(page).evaluate((paper) => {
    const style = getComputedStyle(paper)
    return {
      text: style.getPropertyValue('--text'),
      heading: style.getPropertyValue('--heading'), accent: style.getPropertyValue('--accent'), line: style.getPropertyValue('--line') }
  })
export const defaultColors = { text: '#1d2b27', heading: '#236e45', accent: '#57836c', line: '#dce3de' }

export async function chooseConcertFile(page: Page, path: string) {
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Load File' }).click()
  await (await fileChooser).setFiles(path)
}

export async function loadConcert(page: Page, path: string) {
  await chooseConcertFile(page, path)
  await expect(status(page)).toHaveText(`Loaded ${basename(path)}.`)
  await page.evaluate(() => document.fonts.ready)
}

export async function openSection(page: Page, id: 'details' | 'cover' | 'biographies' | 'program' | 'ensemblePlayers' | 'extras' | 'acknowledgementNames' | 'colors') {
  const toggle = page.locator(`#form-section-toggle-${id}`)
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

// Kept under its own filename in the test's output folder: Playwright's
// temporary download has no extension, which the app and browser rely on
async function download(page: Page, action: () => Promise<void>) {
  const downloaded = page.waitForEvent('download')
  await action()
  const file = await downloaded
  const filename = file.suggestedFilename()
  const path = test.info().outputPath(`${Date.now()}-${filename}`, filename)
  await file.saveAs(path)
  return { filename, path, text: await readFile(path, 'utf8') }
}

export function saveConcert(page: Page, format: 'JSON' | 'YAML') {
  return download(page, async () => {
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('button', { name: `Save as ${format}` }).click()
  })
}

export function saveForWeb(page: Page) {
  return download(page, () => page.getByRole('button', { name: 'Save for Web' }).click())
}

// Runs in the page: duplicate ids, and label/ARIA references to ids that don't exist
export function auditIds() {
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id)
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  const dangling: string[] = []
  for (const label of document.querySelectorAll('label[for]')) {
    const target = (label as HTMLLabelElement).htmlFor
    if (!document.getElementById(target)) dangling.push(`for=${target}`)
  }
  for (const attribute of ['aria-labelledby', 'aria-controls', 'aria-describedby']) {
    for (const element of document.querySelectorAll(`[${attribute}]`)) {
      for (const ref of element.getAttribute(attribute)!.split(/\s+/)) {
        if (!document.getElementById(ref)) dangling.push(`${attribute}=${ref}`)
      }
    }
  }
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    const target = link.getAttribute('href')!.slice(1)
    if (target && !document.getElementById(target)) dangling.push(`href=#${target}`)
  }
  return { duplicates, dangling }
}
