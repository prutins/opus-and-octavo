// Save for Web (the standalone HTML page) and printing.
import type { Page } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { auditIds, expect, fixture, loadConcert, openSection, preview, sampleConcert, saveForWeb, status, test, tinyPng } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test.describe('Save for Web', () => {
  test('downloads a standalone page of the program', async ({ page }) => {
    await loadConcert(page, fixture('full-concert.json'))
    const exported = await saveForWeb(page)
    expect(exported.filename).toBe('winter-lights.html')
    await expect(status(page)).toHaveText('Downloaded winter-lights.html for web.')

    // Checked as booleans: the page is too large to print on failure
    const html = exported.text
    const has = (pattern: string | RegExp) => (typeof pattern === 'string' ? html.includes(pattern) : pattern.test(html))
    expect(has(/^<!doctype html>\s*<html lang="en">/), 'doctype and language').toBe(true)
    expect(has('<title>Winter Lights – Maple Hollow Orchestra – January 1, 2026</title>'), 'title').toBe(true)
    expect(has('@top-center { content: "Winter Lights – Maple Hollow Orchestra – January 1, 2026"; color: #2b2118; }'), 'print header').toBe(true)
    // Styles and fonts are embedded, and the editor isn't included
    expect(has(/<script|<link\b/), 'scripts or linked files').toBe(false)
    expect(html.match(/url\('data:font\/woff2;base64,/g)?.length, 'embedded fonts').toBe(2)
    expect(has(/<(form|input|textarea|button)\b/), 'editor controls').toBe(false)
    expect(has('Formatted document preview'), 'preview label').toBe(false)
    // The concert's colours come along on the program itself
    expect(has(/<article class="document-paper" style="--text: ?#2b2118; ?--heading: ?#7a1f3d; ?--accent: ?#b5651d; ?--line: ?#e4d9c8;?"/), 'colors').toBe(true)
  })

  test('the page shows the same program and needs nothing from the network', async ({ page, context }) => {
    await loadConcert(page, sampleConcert)
    const previewText = await preview(page).innerText()
    const exported = await saveForWeb(page)

    const requests: string[] = []
    const exportPage = await context.newPage()
    exportPage.on('request', (request) => {
      if (!/^(data|file):/.test(request.url())) requests.push(request.url())
    })
    await exportPage.goto(pathToFileURL(exported.path).href)
    await exportPage.evaluate(() => document.fonts.ready)
    expect(await exportPage.locator('main > article.document-paper').innerText()).toBe(previewText)
    expect(requests).toEqual([])
    expect(await exportPage.evaluate(() => [...document.fonts].filter((font) => font.status === 'loaded').length)).toBeGreaterThan(0)

    const { duplicates, dangling } = await exportPage.evaluate(auditIds)
    expect(duplicates).toEqual([])
    expect(dangling).toEqual([])
  })

  test('says so if the exporter can\'t be loaded', async ({ page, consoleProblems }) => {
    // The exporter is loaded on demand; as if the connection dropped after the
    // app loaded
    await page.route(/webExport/, (route) => route.abort())
    await page.getByRole('button', { name: 'Save for Web' }).click()
    await expect(status(page)).toHaveText("Couldn't prepare the web page. Check your connection and try again.")
    // The failed request is logged, as expected here
    expect(consoleProblems.length).toBeGreaterThan(0)
    expect(consoleProblems.every((problem) => /Failed to load resource|webExport/.test(problem)), consoleProblems.join('\n')).toBe(true)
    consoleProblems.length = 0
  })

  test('page breaks carry over, but their marks in the preview don\'t', async ({ page, context }) => {
    await openSection(page, 'program')
    await page.getByLabel('Start a new page before this note').check()
    const exported = await saveForWeb(page)
    const exportPage = await context.newPage()
    await exportPage.goto(pathToFileURL(exported.path).href)
    const notes = exportPage.locator('.program-notes-page')
    await expect(notes).toHaveClass(/page-break-before/)
    expect(await notes.evaluate((element) => getComputedStyle(element, '::before').content)).toBe('none')
    await exportPage.emulateMedia({ media: 'print' })
    await expect(notes).toHaveCSS('break-before', 'page')
  })

  test('text in the title is escaped', async ({ page }) => {
    await page.getByLabel('Concert Title').fill('Bach & "Friends" <Live>')
    const html = (await saveForWeb(page)).text
    expect(html.match(/<title>.*<\/title>/)?.[0]).toBe('<title>Bach &amp; &quot;Friends&quot; &lt;Live&gt; – October 10, 1974</title>')
    expect(html.match(/@page \{ @top-center \{ content: .*\} \}/)?.[0]).toBe('@page { @top-center { content: "Bach & \\"Friends\\" \\3c Live> – October 10, 1974"; color: #1d2b27; } }')
  })

  test('the page links to each part of the program, beside it on wide screens and above it on phones', async ({ page, context }) => {
    await loadConcert(page, fixture('full-concert.json'))
    const exportPage = await context.newPage()
    await exportPage.goto(pathToFileURL((await saveForWeb(page)).path).href)
    const contents = exportPage.getByRole('navigation', { name: 'Contents' })
    const links = contents.getByRole('link')

    // The program's heading and the biographies have fixed names; the rest use
    // their headings. Of the two extras, only the one with a heading is listed
    await expect(links).toHaveText(['Program', 'Biographies', 'Program Notes', 'Maple Hollow Orchestra', 'Thank You', 'Acknowledgements'])
    expect(await links.evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')))).toEqual(
      ['#program', '#biographies', '#program-notes', '#maple-hollow-orchestra', '#thank-you', '#acknowledgements'],
    )
    // Program goes to the heading with the concert title, date and so on
    await expect(exportPage.locator('#program')).toHaveClass('document-heading')
    await expect(exportPage.locator('#program h1')).toHaveText('Winter Lights')
    const { duplicates, dangling } = await exportPage.evaluate(auditIds)
    expect(duplicates).toEqual([])
    expect(dangling).toEqual([])

    // Wide: a column to the left that stays in view as the program scrolls
    const main = exportPage.locator('main')
    expect((await contents.boundingBox())!.x + (await contents.boundingBox())!.width).toBeLessThanOrEqual((await main.boundingBox())!.x)
    await links.filter({ hasText: 'Acknowledgements' }).click()
    await expect(exportPage.locator('#acknowledgements')).toBeInViewport()
    await expect(contents).toBeInViewport()

    // Phones: above the program
    await exportPage.setViewportSize({ width: 390, height: 844 })
    const box = (await contents.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual((await main.boundingBox())!.y)

    // Printed copies have no use for either
    await exportPage.emulateMedia({ media: 'print' })
    await expect(contents).toBeHidden()
    await expect(exportPage.locator('.back-to-top')).toBeHidden()
  })

  test('a back-to-top link appears once the reader scrolls down, and only on a page long enough to need it', async ({ page, context }) => {
    const openExport = async (concert: string) => {
      await loadConcert(page, concert)
      const exportPage = await context.newPage()
      await exportPage.setViewportSize({ width: 390, height: 844 })
      await exportPage.goto(pathToFileURL((await saveForWeb(page)).path).href)
      await exportPage.evaluate(() => document.fonts.ready)
      return exportPage
    }
    const scrollTo = (exportPage: Page, top: number) => exportPage.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), top)

    const long = await openExport(sampleConcert)
    const backToTop = long.getByRole('link', { name: 'Back to top' })
    await expect(backToTop).not.toBeInViewport()
    await scrollTo(long, 3000)
    await expect(backToTop).toBeInViewport()
    // Floating in the window's lower right corner
    const box = (await backToTop.boundingBox())!
    expect(box.x + box.width).toBeGreaterThan(390 - 40)
    expect(box.y + box.height).toBeGreaterThan(844 - 40)
    await backToTop.click()
    await expect.poll(() => long.evaluate(() => window.scrollY)).toBe(0)
    await expect(backToTop).not.toBeInViewport()

    // A short page never shows it, and doesn't scroll further to make room
    const short = await openExport(fixture('minimal.json'))
    const contentHeight = await short.locator('main').evaluate((main) => main.getBoundingClientRect().bottom + window.scrollY)
    await scrollTo(short, 100000)
    await expect(short.getByRole('link', { name: 'Back to top' })).not.toBeInViewport()
    expect(await short.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(Math.max(844, Math.ceil(contentHeight)))
  })
})

// The program has its own colour variables, so it can be recoloured without
// changing the editor
test('the program\'s colours are separate from the editor\'s', async ({ page }) => {
  await loadConcert(page, fixture('full-concert.json'))
  const colors = () =>
    page.evaluate(() => {
      const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
      return {
        text: style('.composer-line').color,
        title: style('.document-title').color,
        link: style('.program-note-link').color,
        heading: style('.biographies-page h2').color,
        programRule: style('.program-list').borderBottomColor,
        biographyRule: style('.document-biography').borderBottomColor,
        editorText: style('body').color,
        editorEyebrow: style('.editor-heading .eyebrow').color,
        editorButton: style('.add-section-button').color,
        editorRule: style('.form-section').borderBottomColor,
        topbarRule: style('.topbar').borderBottomColor,
      }
    })
  // The fixture sets its own program colours; the editor keeps the defaults
  const green = 'rgb(35, 110, 69)'
  const grey = 'rgb(220, 227, 222)'
  const maroon = 'rgb(122, 31, 61)'
  const ink = 'rgb(29, 43, 39)'
  const orange = 'rgb(181, 101, 29)'
  expect(await colors()).toEqual({
    text: 'rgb(43, 33, 24)', title: maroon, link: maroon, heading: maroon, programRule: orange, biographyRule: 'rgb(228, 217, 200)',
    editorText: ink, editorEyebrow: green, editorButton: green, editorRule: grey, topbarRule: grey,
  })

  await preview(page).evaluate((paper) => {
    paper.style.setProperty('--text', 'rgb(60, 60, 60)')
    paper.style.setProperty('--heading', 'rgb(150, 20, 20)')
    paper.style.setProperty('--accent', 'rgb(20, 120, 20)')
    paper.style.setProperty('--line', 'rgb(20, 20, 150)')
  })
  const red = 'rgb(150, 20, 20)'
  expect(await colors()).toEqual({
    text: 'rgb(60, 60, 60)', title: red, link: red, heading: red, programRule: 'rgb(20, 120, 20)', biographyRule: 'rgb(20, 20, 150)',
    editorText: ink, editorEyebrow: green, editorButton: green, editorRule: grey, topbarRule: grey,
  })
})

// Each printed page's number, as "n left" or "n right" for the half of the
// bottom margin (below 0.7 in) it's in, or '' when the page has none
async function pageNumbers(page: Page) {
  const loading = getDocument({ data: new Uint8Array(await page.pdf({ preferCSSPageSize: true })), verbosity: 0 })
  const pdf = await loading.promise
  const numbers: string[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const pdfPage = await pdf.getPage(number)
    const width = pdfPage.view[2]
    const footer = (await pdfPage.getTextContent()).items.filter((item) => 'str' in item && /^\d+$/.test(item.str) && item.transform[5] < 0.7 * 72)
    numbers.push(footer.map((item) => 'str' in item && `${item.str} ${item.transform[4] < width / 2 ? 'left' : 'right'}`).join(' | '))
  }
  await loading.destroy()
  return numbers
}

test.describe('printing', () => {
  test('prints only the program', async ({ page }) => {
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.topbar')).toBeHidden()
    await expect(page.locator('.editor-panel')).toBeHidden()
    await expect(page.locator('.preview-toolbar')).toBeHidden()
    await expect(preview(page)).toBeVisible()
    // On screen the workspace is moved down below the fixed top bar; printed,
    // that would push the first page's content down and cut off its bottom
    await expect(page.locator('.workspace')).toHaveCSS('position', 'static')
  })

  test('the page header follows the concert title', async ({ page }) => {
    const headerRule = page.locator('style[media=print]')
    await expect(headerRule).toHaveCount(1)
    expect(await headerRule.textContent()).toBe('@page { @top-center { content: "The Sage City Symphony – October 10, 1974"; color: #1d2b27; } }')
    await page.getByLabel('Concert Title').fill('')
    await page.getByLabel('Date').fill('')
    await expect(headerRule).toHaveCount(1)
    expect(await headerRule.textContent()).toBe('@page { @top-center { content: "Untitled concert"; color: #1d2b27; } }')
    // The header is outside the program, so it gets the text colour directly
    await openSection(page, 'colors')
    await page.locator('#color-text').fill('#2b2118')
    await expect.poll(() => headerRule.textContent()).toBe('@page { @top-center { content: "Untitled concert"; color: #2b2118; } }')
  })

  test('reading text is 11pt and footnotes 10pt', async ({ page }) => {
    await loadConcert(page, fixture('full-concert.json'))
    await page.emulateMedia({ media: 'print' })
    const pointSize = (selector: string) =>
      preview(page).locator(selector).first().evaluate((element) => Math.round((parseFloat(getComputedStyle(element).fontSize) * 72) / 96 * 10) / 10)
    expect(await pointSize('.document-biography-bio p')).toBe(11)
    expect(await pointSize('.program-note p')).toBe(11)
    expect(await pointSize('.ensemble-player-section li')).toBe(11)
    expect(await pointSize('p.footnote')).toBe(10)
  })

  test('a PDF comes out on US half-letter pages', async ({ page }) => {
    await loadConcert(page, sampleConcert)
    const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1')
    const pageSizes = new Set([...pdf.matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((match) => `${match[1]}×${match[2]}`))
    expect([...pageSizes]).toEqual(['396×612']) // 5.5 × 8.5 in, in points
    expect(pdf.match(/\/Type\s*\/Page\b/g)!.length).toBeGreaterThan(1)
  })

  // The cover's page (a named page in App.css) has empty margin boxes, so
  // neither the running header and page number nor the browser's own headers
  // and footers print there; that shows in the PDF's text (the page-number
  // test below checks it), but not in computed styles
  test('the cover prints on a page of its own', async ({ page }) => {
    const pageCount = async () => (await page.pdf({ preferCSSPageSize: true })).toString('latin1').match(/\/Type\s*\/Page\b/g)!.length
    const withoutCover = await pageCount()
    await openSection(page, 'cover')
    await page.locator('#cover-image').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: tinyPng })
    await page.locator('#cover-content').fill('## Autumn Concert')
    // Exactly one more page: the cover fills its page without spilling over
    expect(await pageCount()).toBe(withoutCover + 1)
    await page.emulateMedia({ media: 'print' })
    await expect(preview(page).locator('.document-cover')).toHaveCSS('page', 'cover')
  })

  // Page 1 is a right-hand page, so odd pages are right-hand pages and even
  // pages left-hand ones; each number sits at the outside corner
  test('page numbers sit at the outside bottom corner: left on left-hand pages, right on right-hand ones', async ({ page }) => {
    // The starter concert has no cover, so the program starts on page 1, on the right
    expect((await pageNumbers(page))[0]).toBe('1 right')

    // The sample's cover takes page 1, unnumbered, and the program starts on page 2, on the left
    await loadConcert(page, sampleConcert)
    const numbers = await pageNumbers(page)
    expect(numbers.length).toBeGreaterThan(3)
    expect(numbers).toEqual(numbers.map((_, index) => (index ? `${index + 1} ${index % 2 ? 'left' : 'right'}` : '')))
  })
})

// Where each line of text starts on the printed pages, in points: the PDF's
// text includes the numbers App.css draws, and runs a number into its
// entry's text when they're close, so each line's first item starts with it
async function lineStarts(page: Page) {
  const loading = getDocument({ data: new Uint8Array(await page.pdf({ preferCSSPageSize: true })), verbosity: 0 })
  const pdf = await loading.promise
  const starts = new Map<string, number>()
  for (let number = 1; number <= pdf.numPages; number++) {
    for (const item of (await (await pdf.getPage(number)).getTextContent()).items) {
      if ('str' in item && item.str.trim() && !starts.has(item.str)) starts.set(item.str, item.transform[4])
    }
  }
  await loading.destroy()
  return starts
}

// Numbers of one, two and three digits each start at the plain lines'
// margin, and each list's entries start level, past its widest number, in a
// list that doesn't start at 1 too
test('numbered movements start at the plain lines\' margin, with their text lined up', async ({ page }) => {
  await openSection(page, 'program')
  await page.locator('#movements-1').fill('Overture\n\n9. Ninth\n10. Tenth\n11. Eleventh\n\nInterlude\n\n98. Late\n99. Later\n100. Latest')

  const starts = await lineStarts(page)
  const margin = starts.get('Overture')!
  expect(margin).toBeDefined()
  expect(starts.get('Interlude')).toBeCloseTo(margin, 0)
  for (const number of ['9', '10', '11', '98', '99', '100']) {
    const line = [...starts.keys()].find((text) => text.startsWith(`${number}.`))
    expect(line, number).toBeDefined()
    expect(starts.get(line!), number).toBeCloseTo(margin, 0)
  }

  await page.emulateMedia({ media: 'print' })
  const lists = await preview(page).locator('.program-movements ol').evaluateAll((lists) =>
    lists.map((list) => {
      const items = [...list.querySelectorAll('li')]
      const textStart = (li: Element) => {
        const range = document.createRange()
        range.selectNodeContents(li)
        return range.getClientRects()[0].left
      }
      // The widest number, set as App.css sets it
      const probe = items.at(-1)!.appendChild(document.createElement('span'))
      probe.style.fontVariantNumeric = 'tabular-nums'
      probe.style.position = 'absolute'
      probe.textContent = `${Number(list.getAttribute('start') ?? 1) + items.length - 1}.`
      const numberWidth = probe.getBoundingClientRect().width
      probe.remove()
      return { starts: items.map(textStart), left: list.getBoundingClientRect().left, numberWidth }
    }),
  )
  expect(lists).toHaveLength(2)
  for (const { starts, left, numberWidth } of lists) {
    for (const start of starts) expect(start).toBeCloseTo(starts[0], 1)
    // A space's width at least between the widest number and the text
    expect(starts[0] - left).toBeGreaterThan(numberWidth + 3)
  }
})
