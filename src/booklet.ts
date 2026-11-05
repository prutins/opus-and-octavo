// Booklet from PDF: places the half-letter pages from Print / Save PDF two to
// a side on landscape letter sheets, in the order that reads correctly once
// the sheets are printed double-sided, stacked and folded. Loaded on demand,
// like webExport.ts: its two PDF libraries are larger than the rest of the app.
import type { PDFDocument, PDFEmbeddedPage } from 'pdf-lib'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

type PdfJs = typeof import('pdfjs-dist')

// PDF sizes are in points, 72 to the inch
const pageWidth = 5.5 * 72
const pageHeight = 8.5 * 72
// The @page top margin in App.css; the running header prints inside it
const topMargin = 0.7 * 72

export class BookletError extends Error {}

// The same message App.tsx gives if this module itself can't be loaded
const bookletUnavailable = "Couldn't prepare the booklet maker. Check your connection and try again."

export type Booklet = {
  bytes: Uint8Array<ArrayBuffer>
  sheets: number
  blanks: number
  // Where the blank pages went: before the acknowledgements, or at the end
  // when the acknowledgements share a page with what comes before them, or
  // when there are none
  blanksPlaced: 'before-acknowledgements' | 'end-shared-page' | 'end'
}

// The page the acknowledgements start on, recognised by their heading being
// the first line of text below the top margin; 'shared' when the heading is
// further down its page. pdf.js reads the text: pdf-lib can't, since Chrome
// stores it as glyph numbers in embedded font subsets.
async function findAcknowledgementsPage(pdfjs: PdfJs, data: Uint8Array): Promise<number | 'shared' | null> {
  const loading = pdfjs.getDocument({ data, verbosity: pdfjs.VerbosityLevel.ERRORS })
  const pdf = await loading.promise
  try {
    // The acknowledgements close the program, so search from the back
    for (let index = pdf.numPages - 1; index >= 0; index--) {
      const page = await pdf.getPage(index + 1)
      // Text runs on the same baseline make up a line
      const lines = new Map<number, string>()
      for (const item of (await page.getTextContent()).items) {
        if (!('str' in item)) continue
        const baseline = Math.round(item.transform[5])
        lines.set(baseline, (lines.get(baseline) ?? '') + item.str)
      }
      const heading = [...lines].find(([, text]) => text.replace(/\s/g, '') === 'Acknowledgements')
      if (!heading) continue
      const contentTop = page.view[3] - topMargin
      const firstLine = Math.max(...[...lines.keys()].filter((baseline) => baseline < contentTop))
      return heading[0] === firstLine ? index : 'shared'
    }
    return null
  } finally {
    await loading.destroy()
  }
}

// Saddle-stitch order: the outside of the first sheet carries the last page
// on the left and the first on the right, its inside the second page and the
// second to last, and so on inwards. pages.length is a multiple of 4.
function bookletSides<Page>(pages: Page[]) {
  const last = pages.length - 1
  const sides: [Page, Page][] = []
  for (let sheet = 0; sheet < pages.length / 4; sheet++) {
    sides.push([pages[last - 2 * sheet], pages[2 * sheet]])
    sides.push([pages[2 * sheet + 1], pages[last - 1 - 2 * sheet]])
  }
  return sides
}

export async function makeBooklet(source: ArrayBuffer, name: string): Promise<Booklet> {
  // Each library loads as a chunk of its own, side by side
  let pdfLib: typeof import('pdf-lib'), pdfjs: PdfJs
  try {
    ;[pdfLib, pdfjs] = await Promise.all([import('pdf-lib'), import('pdfjs-dist')])
  } catch {
    throw new BookletError(bookletUnavailable)
  }
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

  let program: PDFDocument
  try {
    program = await pdfLib.PDFDocument.load(source, { updateMetadata: false })
  } catch {
    throw new BookletError(`Couldn't read ${name} as a PDF. Choose the PDF saved from Print / Save PDF.`)
  }
  const pages = program.getPages()
  const halfLetter = pages.every((page) => {
    const { width, height } = page.getSize()
    return Math.abs(width - pageWidth) < 1 && Math.abs(height - pageHeight) < 1
  })
  if (!pages.length || !halfLetter) {
    throw new BookletError(`${name} isn't on US half-letter pages (5.5 × 8.5 in). Choose the PDF saved from Print / Save PDF.`)
  }

  // A copy, since pdf.js hands its data to a worker and the original is gone
  const acknowledgements = await findAcknowledgementsPage(pdfjs, new Uint8Array(source.slice(0)))
  const blanks = (4 - (pages.length % 4)) % 4
  const blanksAt = typeof acknowledgements === 'number' && acknowledgements > 0 ? acknowledgements : pages.length

  const booklet = await pdfLib.PDFDocument.create()
  const title = program.getTitle()
  if (title) booklet.setTitle(title)
  // Embedded as they are, so text stays text and nothing is scaled
  const embedded = await booklet.embedPdf(program, pages.map((_, index) => index))
  const order: (PDFEmbeddedPage | null)[] = [
    ...embedded.slice(0, blanksAt),
    ...Array.from({ length: blanks }, () => null),
    ...embedded.slice(blanksAt),
  ]
  for (const side of bookletSides(order)) {
    const sheet = booklet.addPage([2 * pageWidth, pageHeight])
    side.forEach((page, column) => page && sheet.drawPage(page, { x: column * pageWidth, y: 0 }))
  }

  return {
    // Copied into a plain ArrayBuffer, which is what Blob accepts
    bytes: new Uint8Array(await booklet.save()),
    sheets: order.length / 4,
    blanks,
    blanksPlaced: blanksAt < pages.length ? 'before-acknowledgements' : acknowledgements === 'shared' ? 'end-shared-page' : 'end',
  }
}

export function describeBooklet(booklet: Booklet, filename: string) {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  const blanks = plural(booklet.blanks, 'blank page')
  const where = {
    'before-acknowledgements': `, with ${blanks} before the acknowledgements`,
    'end-shared-page': `, with ${blanks} at the end, since the acknowledgements don't start on a new page`,
    end: `, with ${blanks} at the end`,
  }[booklet.blanksPlaced]
  return (
    `Downloaded ${filename}: ${plural(booklet.sheets, 'sheet')}${booklet.blanks ? where : ''}. ` +
    'Print it double-sided, flipping on the short edge, at actual size (100%).'
  )
}
