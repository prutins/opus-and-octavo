// Layout at desktop and phone widths: no sideways scrolling, long text wraps,
// and the top bar never covers what it scrolls to. Runs in both projects.
import { expect, loadConcert, openSection, preview, sampleConcert, test } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

// Runs in the page: text that runs past the preview's right edge
function textPastPreviewEdge() {
  const paper = document.querySelector('article.document-paper')!
  const edge = paper.getBoundingClientRect().right
  const out: string[] = []
  const walker = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const range = document.createRange()
    range.selectNodeContents(node)
    const box = range.getBoundingClientRect()
    if (box.width && box.right > edge + 1) out.push(`${node.textContent!.trim().slice(0, 40)} (+${Math.round(box.right - edge)}px)`)
  }
  return out
}

const pageScrollsSideways = () => document.documentElement.scrollWidth > document.documentElement.clientWidth

test('the sample concert fits the screen', async ({ page }) => {
  await loadConcert(page, sampleConcert)
  expect(await page.evaluate(pageScrollsSideways)).toBe(false)
  expect(await page.evaluate(textPastPreviewEdge)).toEqual([])
})

test('long unbroken text wraps instead of widening the page', async ({ page }) => {
  const url = 'https://www.example.org/a/very/long/path/without/any/breaks/Symphonic_Metamorphosis_on_Themes_of_Carl_Maria_von_Weber'
  await page.getByLabel('Concert Title').fill(url)
  await page.getByLabel('Conductor').fill(url)
  await page.getByLabel('Location').fill(url)
  await openSection(page, 'program')
  // The composer line is covered by its own test below
  for (const field of ['#program-title-1', '#movements-1', '#featured-1', '#program-note-text-1']) {
    await page.locator(field).fill(`Text ${url}`)
  }
  await openSection(page, 'biographies')
  await page.locator('#biography-text-1').fill(`Text ${url}`)
  await openSection(page, 'extras')
  await page.locator('#extra-1').fill(`Text ${url}`)
  await openSection(page, 'acknowledgementNames')
  await page.getByRole('button', { name: 'Add an acknowledgement' }).click()
  await page.locator('#acknowledgement-name-1').fill(url)
  await page.locator('#acknowledgement-role-1').fill(url)
  await expect(preview(page).locator('.document-title')).toHaveText(url)

  expect(await page.evaluate(pageScrollsSideways)).toBe(false)
  expect(await page.evaluate(textPastPreviewEdge)).toEqual([])
})

// Known bug: composer lines never wrap (white-space: nowrap), so a long credit
// is cut off at the page edge, on phones even at ordinary lengths. Remove
// test.fail() once fixed.
test('a long composer credit wraps instead of being cut off', async ({ page }) => {
  test.fail()
  await openSection(page, 'program')
  await page.locator('#composer-1').fill('Johann Sebastian Bach, arranged for full orchestra by Leopold Stokowski and revised by the Philadelphia Orchestra library\n(1685–1750)')
  await expect(preview(page).locator('.composer-line')).toContainText('Leopold Stokowski')
  expect(await page.evaluate(textPastPreviewEdge)).toEqual([])
})

test('the skip link brings the editor into view below the top bar', async ({ page }) => {
  await page.evaluate(() => (document.documentElement.style.scrollBehavior = 'auto'))
  for (const id of ['biographies', 'program', 'ensemblePlayers', 'extras'] as const) await openSection(page, id)
  await page.mouse.wheel(0, 1500)
  await page.getByRole('link', { name: 'Opus and Octavo home' }).click()
  await expect(page).toHaveURL(/#main-content$/)
  const barBottom = await page.locator('.topbar').evaluate((bar) => bar.getBoundingClientRect().bottom)
  const headingTop = await page.locator('.editor-heading').evaluate((heading) => heading.getBoundingClientRect().top)
  expect(headingTop).toBeGreaterThanOrEqual(barBottom - 0.5)
})

test('a focused field is never hidden under the top bar', async ({ page }) => {
  await page.evaluate(() => (document.documentElement.style.scrollBehavior = 'auto'))
  for (const id of ['biographies', 'program'] as const) await openSection(page, id)
  const field = page.locator('#program-title-1')
  // Scroll so the field sits just under the top bar, then focus it as Shift+Tab would
  await field.evaluate((element) => {
    const barHeight = document.querySelector('.topbar')!.getBoundingClientRect().height
    window.scrollBy(0, element.getBoundingClientRect().top - barHeight + 20)
  })
  await field.focus()
  const barBottom = await page.locator('.topbar').evaluate((bar) => bar.getBoundingClientRect().bottom)
  expect(await field.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(barBottom - 0.5)
})

test.describe('editor panel toggle', () => {
  test('collapses and expands the editor on wider screens', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the toggle is hidden on phones')
    const toggle = page.getByRole('button', { name: 'Editor panel' })
    const previewWidth = () => page.locator('.preview-panel').evaluate((panel) => panel.getBoundingClientRect().width)
    const expandedWidth = await previewWidth()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(toggle).toHaveAttribute('title', 'Collapse editor')

    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toHaveAttribute('title', 'Expand editor')
    await expect(page.locator('#editor-content')).toBeHidden()
    expect(await previewWidth()).toBeGreaterThan(expandedWidth)
    await expect(toggle).toBeFocused()

    // Status messages are still announced while collapsed
    await loadConcert(page, sampleConcert)

    await toggle.focus()
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#editor-content')).toBeVisible()
  })

  test('is hidden on phones, where the editor stacks above the preview', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout only')
    await expect(page.getByRole('button', { name: 'Editor panel' })).toBeHidden()
    await expect(page.locator('#editor-content')).toBeVisible()
  })
})
