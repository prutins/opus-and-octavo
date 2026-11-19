// Save for Web (the standalone HTML page) and printing.
import type { Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
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

  // With the heading on the cover, Program goes to the running order, not
  // to the foot of the cover
  test('with the heading on the cover, the Program link goes to the running order', async ({ page, context }) => {
    await loadConcert(page, fixture('full-concert.json'))
    await openSection(page, 'cover')
    await page.getByLabel('Concert heading on the cover').check()
    const exportPage = await context.newPage()
    await exportPage.goto(pathToFileURL((await saveForWeb(page)).path).href)
    const links = exportPage.getByRole('navigation', { name: 'Contents' }).getByRole('link')
    await expect(links).toHaveText(['Program', 'Biographies', 'Program Notes', 'Maple Hollow Orchestra', 'Thank You', 'Donors to Maple Hollow Orchestra'])
    await expect(exportPage.locator('#program')).toHaveClass('program-list')
    await expect(exportPage.locator('.document-cover .document-heading h1')).toHaveText('Winter Lights')
  })

  // On a wide screen, the cover is the printed cover's size (4.9 × 7.9 in,
  // 96px to the inch), not the width of the window, and a sized image is
  // its own size; the printed cover is as before
  test('the cover keeps its printed size on the web page', async ({ page, context }) => {
    await openSection(page, 'cover')
    // A 3 × 4 image, so it fills a 3 × 4 in clip
    const png = await page.evaluate(() => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 30, height: 40 })
      canvas.getContext('2d')!.fillRect(0, 0, 30, 40)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await page.locator('#cover-image').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    const exportPage = await context.newPage()
    await exportPage.setViewportSize({ width: 1600, height: 1000 })
    const box = async (selector: string) => (await exportPage.locator(selector).boundingBox())!
    const openExport = async () => exportPage.goto(pathToFileURL((await saveForWeb(page)).path).href)

    await openExport()
    const cover = await box('.document-cover')
    expect(cover.width).toBeCloseTo(4.9 * 96, 0)
    expect(cover.height).toBeCloseTo(7.9 * 96, 0)
    // Centred in the program
    const paper = await box('.document-paper')
    expect(cover.x - paper.x).toBeCloseTo(paper.x + paper.width - (cover.x + cover.width), 0)
    // The default image fits the cover: as wide as it
    expect((await box('.document-cover-image')).width).toBeCloseTo(4.9 * 96, 0)

    await page.locator('#cover-image-layout-clipWidth').fill('3')
    await page.locator('#cover-image-layout-clipHeight').fill('4')
    await openExport()
    const clip = await box('.document-cover-clip')
    expect(clip.width).toBeCloseTo(3 * 96, 0)
    expect(clip.height).toBeCloseTo(4 * 96, 0)

    // Printed, the web page and the app both have the image at its own size,
    // centred on the cover, 0.3 in from the page's edges
    for (const printed of [await firstPageImageTops(exportPage), await firstPageImageTops(page)]) {
      expect(printed).toHaveLength(1)
      printed[0].forEach((inches, index) => expect(inches).toBeCloseTo([2.25, 6.25, 1.25, 4.25][index], 1))
    }
  })

  test('the page links to each part of the program, beside it on wide screens and above it on phones', async ({ page, context }) => {
    await loadConcert(page, fixture('full-concert.json'))
    const exportPage = await context.newPage()
    await exportPage.goto(pathToFileURL((await saveForWeb(page)).path).href)
    const contents = exportPage.getByRole('navigation', { name: 'Contents' })
    const links = contents.getByRole('link')

    // The program's heading and the biographies have fixed names; the rest use
    // their headings. Of the two extras, only the one with a heading is listed
    await expect(links).toHaveText(['Program', 'Biographies', 'Program Notes', 'Maple Hollow Orchestra', 'Thank You', 'Donors to Maple Hollow Orchestra'])
    expect(await links.evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')))).toEqual(
      ['#program', '#biographies', '#program-notes', '#maple-hollow-orchestra', '#thank-you', '#donors-to-maple-hollow-orchestra'],
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
    await links.filter({ hasText: 'Donors to Maple Hollow Orchestra' }).click()
    await expect(exportPage.locator('#donors-to-maple-hollow-orchestra')).toBeInViewport()
    await expect(contents).toBeInViewport()

    // Phones: above the program
    await exportPage.setViewportSize({ width: 390, height: 844 })
    // Both measured at once, since the page may still be scrolling from the link
    const [contentsBottom, mainTop] = await exportPage.evaluate(() =>
      [document.querySelector('.web-contents')!.getBoundingClientRect().bottom, document.querySelector('main')!.getBoundingClientRect().top])
    expect(contentsBottom).toBeLessThanOrEqual(mainTop)

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
    await page.getByLabel('Date', { exact: true }).fill('')
    await expect(headerRule).toHaveCount(1)
    expect(await headerRule.textContent()).toBe('@page { @top-center { content: "Untitled concert"; color: #1d2b27; } }')
    // The header is outside the program, so it gets the text colour directly
    await openSection(page, 'colors')
    await page.locator('#color-text').fill('#2b2118')
    await expect.poll(() => headerRule.textContent()).toBe('@page { @top-center { content: "Untitled concert"; color: #2b2118; } }')
  })

  test('reading text is 10pt and footnotes 9pt', async ({ page }) => {
    await loadConcert(page, fixture('full-concert.json'))
    await page.emulateMedia({ media: 'print' })
    const pointSize = (selector: string) =>
      preview(page).locator(selector).first().evaluate((element) => Math.round((parseFloat(getComputedStyle(element).fontSize) * 72) / 96 * 10) / 10)
    expect(await pointSize('.document-biography-bio p')).toBe(10)
    expect(await pointSize('.program-note p')).toBe(10)
    expect(await pointSize('.ensemble-player-section li')).toBe(10)
    expect(await pointSize('p.footnote')).toBe(9)
  })

  test('the first work title follows close under the Program Notes heading', async ({ page }) => {
    await loadConcert(page, fixture('full-concert.json'))
    const gap = () => preview(page).locator('.program-notes-page').evaluate((section) =>
      section.querySelector('.program-note-entry h3')!.getBoundingClientRect().top - section.querySelector('h2')!.getBoundingClientRect().bottom)
    expect(await gap()).toBeCloseTo(10, 0)
    await page.emulateMedia({ media: 'print' })
    expect(await gap()).toBeCloseTo(10, 0)
  })

  test('print-small text is the footnotes\' size, on screen and in print', async ({ page }) => {
    await openSection(page, 'biographies')
    await page.locator('#biography-text-1').fill('<p class="print-small">Small print</p>\n\n<p class="footnote">A footnote</p>')
    const bio = preview(page).locator('.document-biography-bio')
    const size = (selector: string) => bio.locator(selector).evaluate((element) => getComputedStyle(element).fontSize)
    expect(await size('p.print-small')).toBe('12px')
    expect(await size('p.footnote')).toBe('12px')
    await page.emulateMedia({ media: 'print' })
    // 9pt is 12px
    expect(await size('p.print-small')).toBe('12px')
    expect(await size('p.print-small')).toBe(await size('p.footnote'))
  })

  // The concert heading and a full program (three works and an intermission,
  // with four and fifteen movements) print on one page
  test('a full program and its heading fit on one page', async ({ page }) => {
    await loadConcert(page, fixture('one-page-program.json'))
    const pdf = (await page.pdf({ preferCSSPageSize: true })).toString('latin1')
    expect(pdf.match(/\/Type\s*\/Page\b/g)!.length).toBe(1)
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

// The first line of text on each printed page below the running header
async function pageTopLines(page: Page) {
  const loading = getDocument({ data: new Uint8Array(await page.pdf({ preferCSSPageSize: true })), verbosity: 0 })
  const pdf = await loading.promise
  const lines: string[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const pdfPage = await pdf.getPage(number)
    const height = pdfPage.view[3]
    const body = (await pdfPage.getTextContent()).items.flatMap((item) =>
      'str' in item && item.str.trim() && item.transform[5] > 0.7 * 72 && item.transform[5] < height - 0.7 * 72 ? [item] : [],
    )
    const top = Math.max(...body.map((item) => item.transform[5]))
    lines.push(body.filter((item) => Math.abs(item.transform[5] - top) < 1).map((item) => item.str).join(''))
  }
  await loading.destroy()
  return lines
}

// Many short notes of uneven length, so their ends fall all over the page
// and some at its foot; none of their bylines starts a page
test('a program note’s byline is never left alone at the top of a printed page', async ({ page }) => {
  const words = 'the strings answer the winds and the theme returns in a new key before the movement closes'.split(' ')
  const items = Array.from({ length: 60 }, (_, index) => ({
    title: `Work ${index + 1}`,
    composer: '',
    programNote: Array.from({ length: 5 + ((index * 17) % 60) }, (_, word) => words[word % words.length]).join(' ') + '.',
    programNoteAuthor: `Note by Writer ${index + 1}`,
  }))
  const path = test.info().outputPath('bylines.json')
  await writeFile(path, JSON.stringify({ format: 'opus-and-octavo-concert', version: 1, concert: { concertTitle: 'Bylines', date: '', location: '', conductor: '', items } }))
  await loadConcert(page, path)
  const lines = await pageTopLines(page)
  expect(lines.length).toBeGreaterThan(10)
  expect(lines.filter((line) => line.startsWith('Note by'))).toEqual([])
})

// A title that links to its note looks like one that doesn't, in print as on
// screen; other links print in the text colour
test('program titles keep the heading colour in print, linked to a note or not', async ({ page }) => {
  await loadConcert(page, sampleConcert)
  await openSection(page, 'biographies')
  await page.locator('#biography-text-1').fill('Studied at [the conservatory](https://example.com/).')
  // Every work in the sample has a note, so add one without
  await openSection(page, 'program')
  await page.getByRole('button', { name: 'Add a program item' }).click()
  await page.locator('textarea[id^="program-title-"]').last().fill('Intermission')
  await page.emulateMedia({ media: 'print' })
  const colors = await preview(page).evaluate((paper) => {
    const color = (element: Element) => getComputedStyle(element).color
    const probe = paper.appendChild(document.createElement('span'))
    probe.style.color = 'var(--heading)'
    const heading = color(probe)
    probe.style.color = 'var(--text)'
    const text = color(probe)
    probe.remove()
    const titles = [...paper.querySelectorAll('.program-item h3')]
    return {
      heading,
      text,
      linked: [...new Set(titles.filter((h3) => h3.querySelector('a')).map((h3) => color(h3.querySelector('a')!)))],
      unlinked: [...new Set(titles.filter((h3) => !h3.querySelector('a')).map(color))],
      biographyLink: color(paper.querySelector('.document-biography-bio a')!),
    }
  })
  expect(colors.heading).not.toBe(colors.text)
  expect(colors.linked).toEqual([colors.heading])
  expect(colors.unlinked).toEqual([colors.heading])
  expect(colors.biographyLink).toBe(colors.text)
})

// Where images are drawn on the first printed page, as [top, bottom] in
// inches from the top of the page, following the PDF's own drawing
// operations: emulated print media lays the program out as one long page,
// so it can't show what Chrome does at a page break
async function firstPageImageTops(page: Page) {
  // Half-letter paper, as the program's pages are: without it, the PDF picks
  // its width-based rules for Letter paper, 8.5 in (816px) wide, so the web
  // page's wide-screen layout, with its contents column, is used. Printing
  // from a browser uses the page's own size
  const pdf = await page.pdf({ width: '5.5in', height: '8.5in', preferCSSPageSize: true })
  const loading = getDocument({ data: new Uint8Array(pdf), verbosity: 0 })
  const pdfPage = await (await loading.promise).getPage(1)
  const height = pdfPage.view[3]
  const { fnArray, argsArray } = await pdfPage.getOperatorList()
  type Matrix = [number, number, number, number, number, number]
  const times = ([a, b, c, d, e, f]: Matrix, [A, B, C, D, E, F]: Matrix): Matrix =>
    [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F]
  let matrix: Matrix = [1, 0, 0, 1, 0, 0]
  const saved: Matrix[] = []
  const images: [number, number, number, number][] = []
  fnArray.forEach((fn, index) => {
    if (fn === OPS.save) saved.push(matrix)
    else if (fn === OPS.restore) matrix = saved.pop() ?? matrix
    else if (fn === OPS.transform) matrix = times(argsArray[index] as Matrix, matrix)
    else if (fn === OPS.paintImageXObject) {
      // The image fills the unit square: its top edge is at y = 1, and its
      // right edge at x = 1
      const [top, bottom, left, right] = [height - (matrix[3] + matrix[5]), height - matrix[5], matrix[4], matrix[0] + matrix[4]]
      images.push([top, bottom, left, right].map((points) => Math.round((points / 72) * 100) / 100) as [number, number, number, number])
    }
  })
  await loading.destroy()
  return images
}

// A 5 × 7 in clip is scaled to the cover's 4.9 in width, so 6.86 in tall,
// on a 7.9 in cover 0.3 in from the page's edges. Centred, it extends past
// the page break before it's moved up, which once printed it too low and cut
// off its bottom
test('a clipped cover image prints at the top, middle or bottom of the cover', async ({ page }) => {
  await openSection(page, 'cover')
  // A 5 × 7 image, so it fills the clip, and the clip's top and bottom are the image's
  const png = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 50, height: 70 })
    canvas.getContext('2d')!.fillRect(0, 0, 50, 70)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('#cover-image').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.locator('#cover-image-layout-clipWidth').fill('5')
  await page.locator('#cover-image-layout-clipHeight').fill('7')
  for (const [label, expected] of [['Top', [0.3, 7.16]], ['Middle', [0.82, 7.68]], ['Bottom', [1.34, 8.2]]] as const) {
    await page.locator('#cover-image-layout-align').selectOption({ label })
    const images = await firstPageImageTops(page)
    expect(images, label).toHaveLength(1)
    expect(images[0][0], label).toBeCloseTo(expected[0], 1)
    expect(images[0][1], label).toBeCloseTo(expected[1], 1)
  }
})

// With the heading on the cover, the cover page carries the title,
// conductor, date and place, and the program's first page starts with the
// first work
test('the concert heading prints on the cover page when it is put there', async ({ page }) => {
  await openSection(page, 'cover')
  await page.locator('#cover-image').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: tinyPng })
  await page.getByLabel('Concert heading on the cover').check()
  const loading = getDocument({ data: new Uint8Array(await page.pdf({ preferCSSPageSize: true })), verbosity: 0 })
  const pdf = await loading.promise
  const pageText = async (number: number) =>
    (await (await pdf.getPage(number)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ')
  const [cover, program] = [await pageText(1), await pageText(2)]
  await loading.destroy()
  expect(cover).toContain('Louis Calabro, conducting')
  expect(cover).toContain('October 10, 1974')
  expect(cover).toContain('Bennington, Vermont')
  expect(program).not.toContain('conducting')
  // The cover is still a page of its own, the full content area tall
  await page.emulateMedia({ media: 'print' })
  const coverPage = preview(page).locator('.document-cover')
  await expect(coverPage).toHaveCSS('page', 'cover')
  expect(await coverPage.evaluate((element) => element.getBoundingClientRect().height / 96)).toBeCloseTo(7.9, 2)
  const heading = await coverPage.evaluate((element) => [element.getBoundingClientRect().bottom, element.querySelector('.document-heading')!.getBoundingClientRect().bottom])
  expect(heading[1]).toBeCloseTo(heading[0], 0)
  // Its rule, above it here, prints in the same colour as on the program page
  const rule = await coverPage.locator('.document-heading').evaluate((element) => getComputedStyle(element).borderTopColor)
  // (the form is hidden in print)
  await page.emulateMedia({ media: 'screen' })
  await page.getByLabel('Concert heading on the cover').uncheck()
  await page.emulateMedia({ media: 'print' })
  await expect(preview(page).locator(':scope > .document-heading')).toHaveCSS('border-bottom-color', rule)
})

// The text of every printed page, joined
async function printedText(page: Page) {
  const loading = getDocument({ data: new Uint8Array(await page.pdf({ preferCSSPageSize: true })), verbosity: 0 })
  const pdf = await loading.promise
  const pages: string[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    pages.push((await (await pdf.getPage(number)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  await loading.destroy()
  return pages.join(' ')
}

// HTML with the do-not-print class, a paragraph or within a line, shows in
// the preview and on the web page, but isn't printed
// Each extra goes before or after the acknowledgements; each group is a
// section of its own, with its own page break, and the program ends with
// the last extra, without a rule
test('extras can be placed before or after the acknowledgements', async ({ page, context }) => {
  await loadConcert(page, fixture('full-concert.json'))
  await openSection(page, 'extras')
  await page.locator('#extra-placement-1').selectOption({ label: 'After the acknowledgements' })
  const sections = () => preview(page).evaluate((paper) =>
    [...paper.querySelectorAll(':scope > section')].map((section) => section.className.split(' ')[0]).slice(-3))
  expect(await sections()).toEqual(['document-addenda', 'acknowledgements', 'document-addenda'])
  const addenda = preview(page).locator(':scope > .document-addenda')
  await expect(addenda.first()).toHaveText('Program subject to change.')
  await expect(addenda.last().locator('h2')).toHaveText('Thank You')

  const ruleBelow = (selector: string) => preview(page).locator(selector).evaluate((element) => getComputedStyle(element).borderBottomWidth)
  expect(await ruleBelow('.acknowledgements > article')).not.toBe('0px')
  expect(await ruleBelow(':scope > .document-addenda:last-child > article')).toBe('0px')

  // Its page break starts the group after the acknowledgements
  await page.locator('#extra-page-break-1').check()
  await expect(addenda.last()).toHaveClass(/page-break-before/)
  await expect(addenda.first()).not.toHaveClass(/page-break-before/)

  // The web page's contents follow the new order
  const exportPage = await context.newPage()
  await exportPage.goto(pathToFileURL((await saveForWeb(page)).path).href)
  await expect(exportPage.getByRole('navigation', { name: 'Contents' }).getByRole('link'))
    .toHaveText(['Program', 'Biographies', 'Program Notes', 'Maple Hollow Orchestra', 'Donors to Maple Hollow Orchestra', 'Thank You'])

  // With no acknowledgements, the extras stay together, in order
  await openSection(page, 'acknowledgementNames')
  await page.getByRole('button', { name: 'Remove acknowledgement 1' }).click()
  await page.getByRole('button', { name: 'Remove acknowledgement 1' }).click()
  await expect(preview(page).locator('.acknowledgements')).toHaveCount(0)
  await expect(addenda).toHaveCount(1)
  await expect(addenda.locator(':scope > article')).toHaveCount(2)
  await expect(addenda.locator(':scope > article').first().locator('h2')).toHaveText('Thank You')
})

// An extra can follow a particular program note, so it comes before the
// players: within the notes it takes the rule between notes, or the section
// rule after the last note, and goes back by the acknowledgements when its
// note is blank or its work is removed
test('an extra can follow a program note, before the players', async ({ page, context }) => {
  await loadConcert(page, fixture('full-concert.json'))
  await openSection(page, 'program')
  await page.locator('#program-note-text-2').fill('A second note.')
  await openSection(page, 'extras')
  const place = page.locator('#extra-placement-1')
  // Only the works with notes are offered, in program order
  await expect(place.locator('option')).toHaveText([
    'After the note on Overture to The Snow Garden',
    'After the note on Piano Concerto No. 2',
    'Before the acknowledgements',
    'After the acknowledgements',
  ])
  await place.selectOption({ label: 'After the note on Overture to The Snow Garden' })

  const notes = preview(page).locator('.program-notes-page')
  const children = () => notes.evaluate((section) => [...section.children].map((child) => child.className.split(' ')[0] || child.tagName))
  expect(await children()).toEqual(['H2', 'program-note-entry', 'document-addenda', 'program-note-entry'])
  await expect(notes.locator('.document-addenda h2')).toHaveText('Thank You')
  // Still before the players, which follow the notes
  expect(await preview(page).evaluate((paper) => [...paper.querySelectorAll(':scope > section')].map((section) => section.className.split(' ')[0])))
    .toEqual(expect.arrayContaining(['program-notes-page', 'ensemble-players']))
  expect(await notes.evaluate((section) => section.nextElementSibling!.className.split(' ')[0])).toBe('ensemble-players')

  const ruleBelow = (locator: ReturnType<typeof preview>) => locator.evaluate((element) => getComputedStyle(element).borderBottom)
  const thin = await ruleBelow(notes.locator('.program-note-entry').first())
  const sectionRule = await ruleBelow(notes.locator('.program-note-entry').last())
  expect(thin).not.toBe(sectionRule)
  // Between notes, the thin rule
  expect(await ruleBelow(notes.locator('.document-addenda > article'))).toBe(thin)
  // After the last note, the section rule, and the last note now has the thin one
  await place.selectOption({ label: 'After the note on Piano Concerto No. 2' })
  expect(await children()).toEqual(['H2', 'program-note-entry', 'program-note-entry', 'document-addenda'])
  expect(await ruleBelow(notes.locator('.document-addenda > article'))).toBe(sectionRule)
  expect(await ruleBelow(notes.locator('.program-note-entry').last())).toBe(thin)
  // A rule the extra chooses still wins
  await page.locator('#extra-class-1').selectOption({ label: 'No rule' })
  expect(await ruleBelow(notes.locator('.document-addenda > article'))).toMatch(/^0px/)

  // Its page break starts it on a new page
  await page.locator('#extra-page-break-1').check()
  await expect(notes.locator('.document-addenda')).toHaveClass(/page-break-before/)

  // The web page's contents list it after the notes, before the players
  const exportPage = await context.newPage()
  await exportPage.goto(pathToFileURL((await saveForWeb(page)).path).href)
  await expect(exportPage.getByRole('navigation', { name: 'Contents' }).getByRole('link'))
    .toHaveText(['Program', 'Biographies', 'Program Notes', 'Thank You', 'Maple Hollow Orchestra', 'Donors to Maple Hollow Orchestra'])

  // With its note blank, it goes back before the acknowledgements, and says so
  await page.locator('#program-note-text-2').fill('')
  await expect(notes.locator('.document-addenda')).toHaveCount(0)
  await expect(preview(page).locator(':scope > .document-addenda h2')).toHaveText('Thank You')
  await expect(place.locator('option:checked')).toHaveText('After the note on Piano Concerto No. 2 (no note yet, so before the acknowledgements)')
  // and back after it when the note returns
  await page.locator('#program-note-text-2').fill('A second note.')
  await expect(notes.locator('.document-addenda h2')).toHaveText('Thank You')

  // Removing the work puts it back before the acknowledgements
  await openSection(page, 'program')
  await page.getByRole('button', { name: 'Remove program item 2' }).click()
  await expect(place).toHaveValue('before')
  await expect(preview(page).locator(':scope > .document-addenda h2')).toHaveText('Thank You')
})

// With no program notes, an extra can go before the players instead; it keeps
// that place when notes are added, after them, and goes before the
// acknowledgements while there are no players
test('with no program notes, an extra can go before the players', async ({ page }) => {
  await loadConcert(page, fixture('full-concert.json'))
  await openSection(page, 'extras')
  const place = page.locator('#extra-placement-1')
  // With a note, the place after it is offered instead
  await expect(place.locator('option', { hasText: 'Before the players' })).toHaveCount(0)

  await openSection(page, 'program')
  await page.locator('#program-note-text-1').fill('')
  await openSection(page, 'extras')
  await expect(place.locator('option')).toHaveText([
    'Before the players',
    'Before the acknowledgements',
    'After the acknowledgements',
  ])
  await place.selectOption({ label: 'Before the players' })
  // The document's sections in order, each extras section with its first text
  const sections = () => preview(page).evaluate((paper) => [...paper.querySelectorAll(':scope > section')].map((section) =>
    section.className.split(' ')[0] + (section.classList.contains('document-addenda') ? `:${section.querySelector('h2, p')?.textContent?.trim()}` : '')))
  const order = await sections()
  const thankYou = order.indexOf('document-addenda:Thank You')
  expect(order[thankYou + 1]).toBe('ensemble-players')
  // The other extra stays before the acknowledgements
  const other = order.indexOf('document-addenda:Program subject to change.')
  expect(other).toBeGreaterThan(thankYou + 1)
  expect(order.indexOf('acknowledgements')).toBe(other + 1)

  // Adding a note keeps the choice: the extra follows the notes
  await openSection(page, 'program')
  await page.locator('#program-note-text-2').fill('A second note.')
  await openSection(page, 'extras')
  await expect(place).toHaveValue('players')
  await expect(place.locator('option:checked')).toHaveText('Before the players')
  const withNotes = await sections()
  const notes = withNotes.indexOf('program-notes-page')
  expect(withNotes.slice(notes, notes + 3)).toEqual(['program-notes-page', 'document-addenda:Thank You', 'ensemble-players'])

  // Without players, it goes before the acknowledgements, and says so
  await openSection(page, 'program')
  await page.locator('#program-note-text-2').fill('')
  await openSection(page, 'ensemblePlayers')
  await page.getByRole('button', { name: 'Remove ensemble player 2' }).click()
  await page.getByRole('button', { name: 'Remove ensemble player 1' }).click()
  await openSection(page, 'extras')
  await expect(place.locator('option:checked')).toHaveText('Before the players (no players yet, so before the acknowledgements)')
  const withoutPlayers = await sections()
  expect(withoutPlayers).not.toContain('ensemble-players')
  expect(withoutPlayers.slice(-2)).toEqual(['document-addenda:Thank You', 'acknowledgements'])
})

test('do-not-print text shows on screen and the web page, but not in print', async ({ page }) => {
  await openSection(page, 'biographies')
  await page.locator('#biography-text-1').fill(
    'Printed and online <span class="do-not-print">Online inline</span> text.\n\n<p class="do-not-print">Online paragraph</p>',
  )
  const bio = preview(page).locator('.document-biography-bio')
  await expect(bio.locator('.do-not-print')).toHaveCount(2)
  for (const element of await bio.locator('.do-not-print').all()) await expect(element).toBeVisible()

  const text = (await printedText(page)).replace(/\s+/g, ' ')
  expect(text).toContain('Printed and online')
  expect(text).not.toContain('Online inline')
  expect(text).not.toContain('Online paragraph')
  await page.emulateMedia({ media: 'print' })
  for (const element of await bio.locator('.do-not-print').all()) await expect(element).toBeHidden()
  await page.emulateMedia({ media: 'screen' })

  const html = (await saveForWeb(page)).text
  expect(html).toContain('<span class="do-not-print">Online inline</span>')
  expect(html).toContain('<p class="do-not-print">Online paragraph</p>')
})

// Unticked, the acknowledgements aren't printed, with or without their page
// break, but stay in the preview and on the web page, with their link
test('the acknowledgements can be left out of print and kept on the web page', async ({ page }) => {
  await loadConcert(page, sampleConcert)
  expect(await printedText(page)).toContain('Donors to Sage City Symphony')
  const pages = async () => (await page.pdf({ preferCSSPageSize: true })).toString('latin1').match(/\/Type\s*\/Page\b/g)!.length
  const withAcknowledgements = await pages()

  await openSection(page, 'acknowledgementNames')
  const pageBreak = page.getByLabel('Start the acknowledgements on a new page')
  await expect(pageBreak).toBeChecked()
  await expect(pageBreak).toBeEnabled()
  await page.getByLabel('Include the acknowledgements in print').uncheck()
  await expect(pageBreak).toBeDisabled()
  await expect(preview(page).locator('.acknowledgements h2')).toBeVisible()

  expect(await printedText(page)).not.toContain('Donors to Sage City Symphony')
  expect(await pages()).toBeLessThan(withAcknowledgements)

  const html = (await saveForWeb(page)).text
  expect(html).toContain('id="acknowledgements-heading"')
  expect(/<a [^>]*href="#[^"]*"[^>]*>Donors to Sage City Symphony<\/a>/.test(html), 'contents link').toBe(true)
})


// Bold italics are drawn from the italic font at a bold weight, in the preview
// and on the web page, rather than as regular italics: the browser doesn't
// fake bold (font-synthesis is off), so the italic font must have the weight
test('bold italic text is set in a bold italic font', async ({ page, context }) => {
  await openSection(page, 'extras')
  await page.locator('#extra-1').fill('*Hebrides* ***Hebrides*** **Hebrides**')

  const check = async (target: Page) => {
    // Each word's width and the font file Chrome drew it with
    const cdp = await context.newCDPSession(target)
    await cdp.send('DOM.enable')
    await cdp.send('CSS.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
    const word = async (selector: string) => {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `.document-addenda p${selector}` })
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
      const width = await target.locator(`.document-addenda p${selector}`).first().evaluate((element) => element.getBoundingClientRect().width)
      return { fonts: fonts.map((font) => font.postScriptName), width }
    }
    const italic = await word(' > em')
    const boldItalic = await word(' > em > strong')
    const bold = await word(' > strong')
    // Italics come from the italic font, not slanted upright letters
    expect(italic.fonts).toEqual([expect.stringMatching(/^AtkinsonHyperlegibleNext-.*Italic$/)])
    expect(boldItalic.fonts).toEqual(italic.fonts)
    expect(bold.fonts).toEqual([expect.not.stringMatching(/Italic/)])
    // Bold strokes make the word wider than the regular italic
    expect(boldItalic.width).toBeGreaterThan(italic.width * 1.05)
    await cdp.detach()
  }

  await page.evaluate(() => document.fonts.ready)
  await check(page)
  const exportPage = await context.newPage()
  await exportPage.goto(pathToFileURL((await saveForWeb(page)).path).href)
  await exportPage.evaluate(() => document.fonts.ready)
  await check(exportPage)
})
