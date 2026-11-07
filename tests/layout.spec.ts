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

// The composer column is as wide as its longest line, up to 60% of the
// heading; past that the credit wraps, so the title keeps at least 40%
test('a long composer credit wraps instead of being cut off', async ({ page }) => {
  await openSection(page, 'program')
  await page.locator('#composer-1').fill('Johann Sebastian Bach, arranged for full orchestra by Leopold Stokowski and revised by the Philadelphia Orchestra library\n(1685–1750)')
  await expect(preview(page).locator('.composer-line')).toContainText('Leopold Stokowski')
  expect(await page.evaluate(textPastPreviewEdge)).toEqual([])
  const width = (selector: string) => preview(page).locator(selector).first().evaluate((element) => element.getBoundingClientRect().width)
  expect(await width('.program-item h3')).toBeGreaterThanOrEqual(0.4 * (await width('.program-item-heading')) - 0.5)
})

// The title's last line and its dotted leader line up with the composer's
// first line, not with the last line of a composer that wraps
test('the dotted leader runs to the first line of a wrapped composer', async ({ page }) => {
  await openSection(page, 'program')
  await page.locator('#program-title-1').fill('Concerto for Violin and Cello in A minor, Op. 102\n\n("Double Concerto")')
  await page.locator('#composer-1').fill('Johannes Franz Constantine Brahms, in an arrangement for chamber orchestra and continuo')
  for (const media of ['screen', 'print'] as const) {
    await page.emulateMedia({ media })
    // Emulated print keeps the window's width, so narrow it to a printed page's
    if (media === 'print') await page.setViewportSize({ width: 528, height: 816 })
    const { leader, lines } = await preview(page).locator('.program-item-heading').first().evaluate((heading) => {
      const range = document.createRange()
      range.selectNodeContents(heading.querySelector('.composer-line > span > span')!)
      return {
        leader: heading.querySelector('.program-leader')!.getBoundingClientRect().bottom,
        lines: [...new Set([...range.getClientRects()].map((box) => `${box.top} ${box.bottom}`))].map((box) => box.split(' ').map(Number)),
      }
    })
    expect(lines.length, `${media}: the composer wraps`).toBeGreaterThan(1)
    expect(leader, `${media}: below the first line's top`).toBeGreaterThan(lines[0][0])
    expect(leader, `${media}: above the first line's bottom`).toBeLessThan(lines[0][1])
  }
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
    // The editor panel scrolls on wider screens, the whole page on phones
    const panel = element.closest('.editor-panel')!
    const scroller = getComputedStyle(panel).overflowY === 'auto' ? panel : document.scrollingElement!
    scroller.scrollBy(0, element.getBoundingClientRect().top - barHeight + 20)
  })
  await field.focus()
  const barBottom = await page.locator('.topbar').evaluate((bar) => bar.getBoundingClientRect().bottom)
  expect(await field.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(barBottom - 0.5)
})

test('the editor and preview scroll separately on wider screens, and together on phones', async ({ page }, testInfo) => {
  await loadConcert(page, sampleConcert)
  for (const id of ['biographies', 'program', 'ensemblePlayers', 'extras'] as const) await openSection(page, id)
  const read = () =>
    page.evaluate(() => ({
      page: window.scrollY,
      editor: document.querySelector('.editor-panel')!.scrollTop,
      preview: document.querySelector('.preview-panel')!.scrollTop,
    }))
  // Wheel and key scrolling animate; wait until nothing is moving
  const scrolled = async () => {
    let last = ''
    await expect.poll(async () => last === (last = JSON.stringify(await read()))).toBe(true)
    return read()
  }

  if (testInfo.project.name === 'mobile') {
    await page.locator('.editor-panel').hover()
    await page.mouse.wheel(0, 1500)
    await expect.poll(async () => (await scrolled()).page).toBeGreaterThan(0)
    expect(await scrolled()).toMatchObject({ editor: 0, preview: 0 })
    return
  }

  await page.locator('.editor-panel').hover()
  await page.mouse.wheel(0, 1500)
  await expect.poll(async () => (await scrolled()).editor).toBeGreaterThan(0)
  expect(await scrolled()).toMatchObject({ page: 0, preview: 0 })
  const { editor } = await scrolled()
  // The collapse toggle stays just below the top bar
  const toggleGap = await page.evaluate(() =>
    document.querySelector('.editor-toggle')!.getBoundingClientRect().top - document.querySelector('.topbar')!.getBoundingClientRect().bottom)
  expect(toggleGap).toBeCloseTo(16, 0)

  // The preview can be focused and scrolled from the keyboard
  await page.locator('.preview-panel').focus()
  await page.keyboard.press('End')
  await expect.poll(async () => (await scrolled()).preview).toBeGreaterThan(0)
  expect(await scrolled()).toMatchObject({ page: 0, editor })

  // The top bar stays put, and the panels fill the window below it
  const viewportHeight = page.viewportSize()!.height
  for (const selector of ['.editor-panel', '.preview-panel']) {
    const box = await page.locator(selector).evaluate((panel) => panel.getBoundingClientRect().toJSON())
    expect(box.top).toBeCloseTo(await page.locator('.topbar').evaluate((bar) => bar.getBoundingClientRect().bottom), 0)
    expect(box.bottom).toBeCloseTo(viewportHeight, 0)
  }
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
