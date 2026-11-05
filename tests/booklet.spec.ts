// Booklet from PDF: half-letter pages imposed two-up on landscape letter
// sheets, in saddle-stitch order, at 100%, with blank pages before the
// acknowledgements.
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { expect, fixture, loadConcert, openSection, status, test } from './helpers.ts'

type PdfFile = { name: string; buffer: Buffer }

// A stand-in for the app's PDF: each half-letter page says "Page n" below a
// running header in the top margin, and one can carry the Acknowledgements
// heading, either first on its page or further down
async function programPdf(count: number, acknowledgements?: { page: number; first: boolean }, size: [number, number] = [396, 612]) {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let number = 1; number <= count; number++) {
    const page = pdf.addPage(size)
    page.drawText('Autumn Concert', { x: 150, y: size[1] - 27, size: 9, font })
    const here = acknowledgements?.page === number
    if (here && acknowledgements.first) page.drawText('Acknowledgements', { x: 30, y: size[1] - 72, size: 16, font })
    page.drawText(`Page ${number}`, { x: 30, y: size[1] - 112, size: 12, font })
    if (here && !acknowledgements.first) page.drawText('Acknowledgements', { x: 30, y: 300, size: 16, font })
  }
  return { name: 'program.pdf', buffer: Buffer.from(await pdf.save()) }
}

async function chooseBookletPdf(page: Page, file: PdfFile) {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Booklet from PDF…' }).click()
  await (await chooser).setFiles({ ...file, mimeType: 'application/pdf' })
}

async function makeBooklet(page: Page, file: PdfFile) {
  const downloaded = page.waitForEvent('download')
  await chooseBookletPdf(page, file)
  const download = await downloaded
  return { filename: download.suggestedFilename(), bytes: await readFile((await download.path())!) }
}

// Each page's text, split into its halves when there are two, as
// "text@x,y" with x measured from the half's left edge, so a page placed at
// 100% reads the same as the original
async function pdfText(bytes: Uint8Array, halves: 1 | 2) {
  const loading = getDocument({ data: new Uint8Array(bytes), verbosity: 0 })
  const pdf = await loading.promise
  const pages: { size: string; halves: string[] }[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const [, , width, height] = page.view
    const text: string[][] = Array.from({ length: halves }, () => [])
    for (const item of (await page.getTextContent()).items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [x, y] = [item.transform[4], item.transform[5]]
      const half = halves === 2 && x >= width / 2 ? 1 : 0
      text[half].push(`${item.str}@${(x - (half * width) / 2).toFixed(1)},${y.toFixed(1)}`)
    }
    pages.push({ size: `${width}×${height}`, halves: text.map((lines) => lines.join(' | ')) })
  }
  await loading.destroy()
  return pages
}

// The "Page n" labels on each side of the booklet, left then right ('' for a blank)
async function bookletLabels(bytes: Uint8Array) {
  return (await pdfText(bytes, 2)).map((side) => side.halves.map((half) => half.match(/Page (\d+)/)?.[1] ?? ''))
}

const printAdvice = 'Print it double-sided, flipping on the short edge, at actual size (100%).'

test('blank pages go before the acknowledgements, and the sheets are in booklet order', async ({ page }) => {
  await page.goto('/')
  const { filename, bytes } = await makeBooklet(page, await programPdf(6, { page: 6, first: true }))
  expect(filename).toBe('program-booklet.pdf')
  await expect(status(page)).toHaveText(`Downloaded program-booklet.pdf: 2 sheets, with 2 blank pages before the acknowledgements. ${printAdvice}`)
  // Reading order 1 2 3 4 5 – – 6, folded: the first sheet's outside has 6 and 1
  expect(await bookletLabels(bytes)).toEqual([['6', '1'], ['2', ''], ['', '3'], ['4', '5']])
  // Landscape letter sheets
  expect(new Set((await pdfText(bytes, 2)).map((side) => side.size))).toEqual(new Set(['792×612']))
})

test('without an acknowledgements page, blank pages go at the end', async ({ page }) => {
  await page.goto('/')
  const { bytes } = await makeBooklet(page, await programPdf(5))
  await expect(status(page)).toHaveText(`Downloaded program-booklet.pdf: 2 sheets, with 3 blank pages at the end. ${printAdvice}`)
  expect(await bookletLabels(bytes)).toEqual([['', '1'], ['2', ''], ['', '3'], ['4', '5']])
})

test('acknowledgements that share a page get the blank pages after them, and say why', async ({ page }) => {
  await page.goto('/')
  const { bytes } = await makeBooklet(page, await programPdf(7, { page: 7, first: false }))
  await expect(status(page)).toHaveText(
    `Downloaded program-booklet.pdf: 2 sheets, with 1 blank page at the end, since the acknowledgements don't start on a new page. ${printAdvice}`,
  )
  expect(await bookletLabels(bytes)).toEqual([['', '1'], ['2', '7'], ['6', '3'], ['4', '5']])
})

test('a program that fills its sheets needs no blank pages', async ({ page }) => {
  await page.goto('/')
  const { bytes } = await makeBooklet(page, await programPdf(4, { page: 4, first: true }))
  await expect(status(page)).toHaveText(`Downloaded program-booklet.pdf: 1 sheet. ${printAdvice}`)
  expect(await bookletLabels(bytes)).toEqual([['4', '1'], ['2', '3']])
})

test('only half-letter PDFs are accepted', async ({ page }) => {
  await page.goto('/')
  await chooseBookletPdf(page, { ...(await programPdf(2, undefined, [612, 792])), name: 'letter.pdf' })
  await expect(status(page)).toHaveText("letter.pdf isn't on US half-letter pages (5.5 × 8.5 in). Choose the PDF saved from Print / Save PDF.")
  await chooseBookletPdf(page, { name: 'notes.pdf', buffer: Buffer.from('Not a PDF at all') })
  await expect(status(page)).toHaveText("Couldn't read notes.pdf as a PDF. Choose the PDF saved from Print / Save PDF.")
})

test('says so if the booklet maker can\'t be loaded', async ({ page, consoleProblems }) => {
  await page.goto('/')
  // Its libraries are loaded on demand; as if the connection dropped after
  // the app loaded
  await page.route(/pdf-lib|pdfjs-dist/, (route) => route.abort())
  await chooseBookletPdf(page, await programPdf(4))
  await expect(status(page)).toHaveText("Couldn't prepare the booklet maker. Check your connection and try again.")
  // The failed requests are logged, as expected here
  expect(consoleProblems.every((problem) => /Failed to load resource|pdf-lib|pdfjs-dist/.test(problem)), consoleProblems.join('\n')).toBe(true)
  consoleProblems.length = 0
})

test('a booklet of the app’s own PDF keeps every page whole and at full size', async ({ page }) => {
  await page.goto('/')
  await loadConcert(page, fixture('full-concert.json'))
  // Players on a page of their own make it more than 4 pages, so blanks are needed
  await openSection(page, 'ensemblePlayers')
  await page.getByLabel('Start the ensemble players on a new page').check()
  await openSection(page, 'acknowledgementNames')
  await page.getByLabel('Start the acknowledgements on a new page').check()
  const program = Buffer.from(await page.pdf({ preferCSSPageSize: true }))
  const original = (await pdfText(program, 1)).map((sourcePage) => sourcePage.halves[0])

  const { bytes } = await makeBooklet(page, { name: 'program.pdf', buffer: program })
  const sides = await pdfText(bytes, 2)
  // Unfold the sheets back into reading order
  const count = sides.length * 2
  const reading: string[] = []
  sides.forEach((side, index) => {
    const sheet = Math.floor(index / 2)
    const [left, right] = index % 2 ? [2 * sheet + 1, count - 2 - 2 * sheet] : [count - 1 - 2 * sheet, 2 * sheet]
    reading[left] = side.halves[0]
    reading[right] = side.halves[1]
  })

  const acknowledgements = original.findIndex((text) => text.includes('Acknowledgements@'))
  expect(acknowledgements).toBeGreaterThan(0)
  const blanks = count - original.length
  expect(blanks).toBeGreaterThan(0)
  expect(reading).toEqual([...original.slice(0, acknowledgements), ...Array<string>(blanks).fill(''), ...original.slice(acknowledgements)])
  await expect(status(page)).toContainText(`with ${blanks} blank page${blanks === 1 ? '' : 's'} before the acknowledgements`)
})
