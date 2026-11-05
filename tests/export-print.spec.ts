// Save for Web (the standalone HTML page) and printing.
import { pathToFileURL } from 'node:url'
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
  // and footers print there; that shows in the PDF's text, which isn't checked
  // here, but not in computed styles
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
})
