// Structure that assistive technology relies on: labels, ids, headings,
// image alternatives, and the collapsible form sections.
import { auditIds, expect, fixture, loadConcert, openSection, preview, sampleConcert, test } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

const sections = ['details', 'biographies', 'program', 'ensemblePlayers', 'extras', 'acknowledgementNames'] as const

async function addAndRemoveEntries(page: import('@playwright/test').Page) {
  const kinds = [
    ['biographies', 'Add a biography', 'Remove biography 1'],
    ['program', 'Add a program item', 'Remove program item 1'],
    ['ensemblePlayers', 'Add an ensemble player', 'Remove ensemble player 1'],
    ['extras', 'Add an extra', 'Remove extra 1'],
    ['acknowledgementNames', 'Add an acknowledgement', 'Remove acknowledgement 1'],
  ] as const
  for (const [section, add, remove] of kinds) {
    await openSection(page, section)
    const panel = page.locator(`#form-section-panel-${section}`)
    await panel.getByRole('button', { name: add }).click()
    await panel.getByRole('button', { name: add }).click()
    await panel.getByRole('button', { name: remove, exact: true }).click()
    await panel.getByRole('button', { name: add }).click()
  }
}

test('ids stay unique and every reference resolves', async ({ page }) => {
  expect(await page.evaluate(auditIds)).toEqual({ duplicates: [], dangling: [] })
  await addAndRemoveEntries(page)
  expect(await page.evaluate(auditIds)).toEqual({ duplicates: [], dangling: [] })
  await loadConcert(page, sampleConcert)
  expect(await page.evaluate(auditIds)).toEqual({ duplicates: [], dangling: [] })
  await addAndRemoveEntries(page)
  expect(await page.evaluate(auditIds)).toEqual({ duplicates: [], dangling: [] })
})

test('every form field has a visible label', async ({ page }) => {
  for (const id of sections) await openSection(page, id)
  const unlabelled = await page.locator('.document-form').evaluate((form) =>
    [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
      .filter((field) => ![...(field.labels ?? [])].some((label) => label.getBoundingClientRect().width > 0 && label.textContent!.trim()))
      .map((field) => field.id || field.name),
  )
  expect(unlabelled).toEqual([])
})

test("the preview's headings don't skip levels", async ({ page }) => {
  for (const file of [sampleConcert, fixture('full-concert.json')]) {
    await loadConcert(page, file)
    const levels = await preview(page).evaluate((paper) => [...paper.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1])))
    expect(levels[0]).toBe(1)
    const skips = levels.flatMap((level, i) => (i > 0 && level > levels[i - 1] + 1 ? [`h${levels[i - 1]} → h${level}`] : []))
    expect(skips).toEqual([])
  }
})

test('images have text alternatives or are marked decorative', async ({ page }) => {
  await loadConcert(page, fixture('full-concert.json'))
  const missing = await page.locator('body').evaluate((body) =>
    [...body.querySelectorAll('img')].filter((img) => !img.alt.trim() && img.getAttribute('aria-hidden') !== 'true').map((img) => img.className),
  )
  expect(missing).toEqual([])
})

test('form sections open and close by mouse and keyboard', async ({ page }) => {
  const toggle = (id: string) => page.locator(`#form-section-toggle-${id}`)
  const panel = (id: string) => page.locator(`#form-section-panel-${id}`)

  // Concert details starts open, the rest closed
  for (const id of sections) {
    await expect(toggle(id)).toHaveAttribute('aria-expanded', id === 'details' ? 'true' : 'false')
    await expect(toggle(id)).toHaveAttribute('aria-controls', `form-section-panel-${id}`)
    await expect(panel(id)).toBeVisible({ visible: id === 'details' })
  }
  await expect(panel('program')).toHaveAttribute('role', 'region')
  await expect(page.getByRole('region', { name: 'Concert details' })).toBeVisible()

  await toggle('program').focus()
  await page.keyboard.press('Enter')
  await expect(panel('program')).toBeVisible()
  await toggle('biographies').focus()
  await page.keyboard.press('Space')
  await expect(panel('biographies')).toBeVisible()
  await toggle('details').click()
  await expect(panel('details')).toBeHidden()
  await expect(toggle('details')).toHaveAttribute('aria-expanded', 'false')

  // Loading a file returns them to the starting state
  await loadConcert(page, fixture('full-concert.json'))
  for (const id of sections) await expect(toggle(id)).toHaveAttribute('aria-expanded', id === 'details' ? 'true' : 'false')
})

test('program titles link to their notes', async ({ page }) => {
  await loadConcert(page, sampleConcert)
  const links = preview(page).locator('a.program-note-link')
  expect(await links.count()).toBeGreaterThan(0)
  for (const href of await links.evaluateAll((all) => all.map((a) => a.getAttribute('href')!))) {
    await expect(preview(page).locator(`.program-notes-page h3${href}`)).toHaveCount(1)
  }
})

// Known issue: Markdown fields accept raw HTML (needed for footnotes), but
// nothing removes scripts or event handlers, so opening someone else's concert
// file can run code, and Save for Web carries it onto a website. Remove
// test.fail() once the Markdown output is sanitized.
test('scripts in Markdown fields do not run', async ({ page }) => {
  test.fail()
  await openSection(page, 'extras')
  await page.locator('#extra-1').fill('<img src="data:image/png;base64,AAAA" alt="" onerror="window.injected = true"><p class="footnote">Kept</p>')
  await expect(preview(page).locator('p.footnote')).toHaveText('Kept')
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => 'injected' in window)).toBe(false)
})
