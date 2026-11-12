// Structure that assistive technology relies on: labels, ids, headings,
// image alternatives, and the collapsible form sections; and button text
// that stays readable.
import { auditIds, expect, fixture, loadConcert, openSection, preview, sampleConcert, saveForWeb, test } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

const sections = ['details', 'cover', 'biographies', 'program', 'ensemblePlayers', 'extras', 'acknowledgementNames', 'colors'] as const

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
  // Over a hundred clicks, which can pass 30 seconds on a slow or power-saving machine
  test.slow()
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

// WCAG 2 contrast ratio of two computed "rgb(r, g, b)" colours
function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map((value) => {
      const channel = Number(value) / 255
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// The Print / Save PDF button is dark with light text, and turns light with
// dark text under the pointer, both from the theme's colour variables
test('the Print / Save PDF button keeps its text readable, and under the pointer too', async ({ page }) => {
  const button = page.getByRole('button', { name: 'Print / Save PDF' })
  const colors = () => button.evaluate((element) => {
    const resolve = (value: string) => {
      const probe = document.body.appendChild(document.createElement('div'))
      probe.style.color = value
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }
    const style = getComputedStyle(element)
    return {
      background: style.backgroundColor,
      text: style.color,
      canvas: resolve('var(--canvas)'),
      ink: resolve('var(--ink)'),
      surface: resolve('var(--surface)'),
    }
  })

  const resting = await colors()
  expect([resting.background, resting.text]).toEqual([resting.ink, resting.surface])
  expect(contrast(resting.background, resting.text)).toBeGreaterThanOrEqual(4.5)

  await button.hover()
  // The colours fade over 140 ms
  await expect.poll(async () => {
    const hovered = await colors()
    return [hovered.background === hovered.canvas, hovered.text === hovered.ink]
  }).toEqual([true, true])
  const hovered = await colors()
  expect(contrast(hovered.background, hovered.text)).toBeGreaterThanOrEqual(4.5)
})

// Markdown fields accept raw HTML, for footnotes, so the output is sanitized:
// concert files can come from anyone, and Save for Web puts the preview on a
// website
test('scripts in Markdown fields do not run, and formatting is kept', async ({ page }) => {
  const attack = (field: string) =>
    `**Bold** <img src="data:image/png;base64,AAAA" alt="" onerror="window.injected = '${field}'">` +
    `<script>window.injected = '${field} script'</script>` +
    `[Click](javascript:window.injected=1) <a href="javascript:void 0" onclick="window.injected = '${field} click'">Here</a>\n\n` +
    '<p class="footnote">Kept</p>'
  await openSection(page, 'biographies')
  await page.locator('#biography-text-1').fill(attack('biography'))
  await openSection(page, 'program')
  await page.locator('#featured-1').fill(attack('featured'))
  await page.locator('#program-note-text-1').fill(attack('program note'))
  await page.locator('#program-note-author-1').fill(attack('byline'))
  await page.locator('#program-title-1').fill(attack('title'))
  await page.locator('#movements-1').fill(attack('movements'))
  await openSection(page, 'extras')
  await page.locator('#extra-1').fill(attack('extra'))

  const doc = preview(page)
  for (const selector of ['.document-biography-bio', '.featured-line', '.program-movements', '.program-note', '.document-addenda > article']) {
    const field = doc.locator(selector).first()
    await expect(field.locator('strong'), selector).toHaveText('Bold')
    await expect(field.locator('p.footnote'), selector).toHaveText('Kept')
    await expect(field.locator('img'), selector).not.toHaveAttribute('onerror')
  }
  // The byline is one line, so it keeps inline formatting only; so do titles,
  // in the program and over the note
  await expect(doc.locator('.program-note-credit').first().locator('strong')).toHaveText('Bold')
  await expect(doc.locator('.program-item h3').first().locator('strong')).toHaveText('Bold')
  await expect(doc.locator('.program-note-entry h3').first().locator('strong')).toHaveText('Bold')
  await expect(doc.locator('script, [onerror], [onclick], a[href^="javascript:" i]')).toHaveCount(0)
  for (const link of await doc.getByRole('link', { name: /^(Click|Here)$/ }).all()) await link.click()
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as { injected?: string }).injected)).toBeUndefined()

  const html = (await saveForWeb(page)).text
  expect(/<script|\son(error|click)=|href="javascript:/i.test(html), 'scripts in the exported page').toBe(false)
})
