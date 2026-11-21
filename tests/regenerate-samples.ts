// Regenerates the samples in public/ from the app: each concert's Save for
// Web page and printed PDF, and the Sage City booklet. Run on demand with
// `npm run samples`; the name doesn't end in .spec.ts, so `npm test` skips it.
// The PDFs come from headless Chrome's page.pdf, which follows @page like
// Print / Save PDF does.
import { copyFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadConcert, saveForWeb, test } from './helpers.ts'

const publicFile = (name: string) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))

const samples = [
  {
    concert: '2026-spring-the-sage-city-symphony-anonymized.json',
    web: 'the-sage-city-symphony-anonymized.html',
    pdf: 'Sage City Symphony Anonymized.pdf',
    booklet: 'Sage City Symphony Anonymized-booklet.pdf',
  },
  {
    concert: 'an-evening-of-symphonies.json',
    web: 'an-evening-of-symphonies.html',
    pdf: 'The Freeform Symphonica.pdf',
  },
]

for (const sample of samples) {
  test(`regenerate the samples from ${sample.concert}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')
    await loadConcert(page, publicFile(sample.concert))
    await copyFile((await saveForWeb(page)).path, publicFile(sample.web))

    const pdf = await page.pdf({ preferCSSPageSize: true })
    await writeFile(publicFile(sample.pdf), pdf)

    if (!sample.booklet) return
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Booklet from PDF…' }).click()
    await (await chooser).setFiles({ name: sample.pdf, mimeType: 'application/pdf', buffer: pdf })
    await (await downloaded).saveAs(publicFile(sample.booklet))
  })
}
