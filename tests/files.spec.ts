// Saving and loading concert files (JSON and YAML), and biography and program
// note photos.
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import {
  chooseConcertFile,
  defaultColors,
  documentColors,
  expect,
  fixture,
  loadConcert,
  openSection,
  preview,
  sampleConcert,
  saveConcert,
  status,
  test,
  tinyPng,
} from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('Save as JSON downloads the concert, named after its title', async ({ page }) => {
  const saved = await saveConcert(page, 'JSON')
  expect(saved.filename).toBe('the-sage-city-symphony.json')
  await expect(status(page)).toHaveText('Downloaded the-sage-city-symphony.json.')
  const data = JSON.parse(saved.text)
  expect(data).toMatchObject({
    format: 'opus-and-octavo-concert',
    version: 1,
    concert: {
      concertTitle: 'The Sage City Symphony',
      date: '1974-10-10',
      location: 'Bennington, Vermont',
      conductor: 'Louis Calabro',
      colors: { text: '#1d2b27', heading: '#236e45', accent: '#57836c', line: '#dce3de' },
      extras: [{ content: expect.stringMatching(/^## About the Orchestra/), class: '' }],
      ensemblePlayers: [{ section: 'Percussion', name: 'Theodora Wilcoxen', title: '', ensemble: '' }],
    },
  })
  // Internal ids aren't saved
  expect(saved.text).not.toMatch(/"id"/)
})

test('the save menu offers both formats and closes after choosing', async ({ page }) => {
  const saveButton = page.getByRole('button', { name: 'Save', exact: true })
  await expect(saveButton).toHaveAttribute('aria-expanded', 'false')
  await saveButton.click()
  await expect(saveButton).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: 'Save as JSON' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save as YAML' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(saveButton).toHaveAttribute('aria-expanded', 'false')
  await expect(saveButton).toBeFocused()

  await saveButton.click()
  await page.locator('.editor-heading').click()
  await expect(page.getByRole('button', { name: 'Save as JSON' })).toBeHidden()

  await saveConcert(page, 'YAML')
  await expect(page.getByRole('button', { name: 'Save as YAML' })).toBeHidden()
  await expect(saveButton).toBeFocused()
})

test('filenames are made safe, with a fallback for an empty title', async ({ page }) => {
  await page.getByLabel('Concert Title').fill('  Bach & Friends: Live!  ')
  expect((await saveConcert(page, 'JSON')).filename).toBe('bach-friends-live.json')
  await page.getByLabel('Concert Title').fill('')
  expect((await saveConcert(page, 'JSON')).filename).toBe('concert-program.json')
})

test('Save as YAML holds the same data as Save as JSON', async ({ page }) => {
  await loadConcert(page, fixture('full-concert.json'))
  const json = await saveConcert(page, 'JSON')
  const yaml = await saveConcert(page, 'YAML')
  expect(yaml.filename).toBe('winter-lights.yaml')
  await expect(status(page)).toHaveText('Downloaded winter-lights.yaml.')
  // Read back the way the app reads it: every value as text, except the
  // version and image layout sizes, which the app turns back into numbers
  const withNumbers = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withNumbers)
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key.endsWith('Layout')
          ? Object.fromEntries(Object.entries(entry as object).map(([field, n]) => [field, field === 'align' ? n : Number(n)]))
          : withNumbers(entry),
      ]),
    )
  }
  const fromYaml = withNumbers(parse(yaml.text, { schema: 'failsafe' })) as Record<string, unknown>
  expect({ ...fromYaml, version: Number(fromYaml.version) }).toEqual(JSON.parse(json.text))
  // Multi-line text is kept readable as literal blocks
  expect(yaml.text).toContain('bio: |-')
})

test('a saved file loads back unchanged', async ({ page }) => {
  await loadConcert(page, fixture('full-concert.json'))
  const saved = await saveConcert(page, 'JSON')
  expect(JSON.parse(saved.text)).toEqual(JSON.parse(await readFile(fixture('full-concert.json'), 'utf8')))
})

test('the sample loads from YAML and saves the same through JSON and YAML', async ({ page }) => {
  await loadConcert(page, sampleConcert)
  const first = await saveConcert(page, 'JSON')
  await loadConcert(page, first.path)
  const second = await saveConcert(page, 'JSON')
  expect(second.text).toBe(first.text)

  const yaml = await saveConcert(page, 'YAML')
  await loadConcert(page, yaml.path)
  expect((await saveConcert(page, 'JSON')).text).toBe(first.text)
})

test('a loaded file replaces the concert in the editor and preview', async ({ page }) => {
  await loadConcert(page, fixture('full-concert.json'))
  const doc = preview(page)
  await expect(page).toHaveTitle('Winter Lights – Maple Hollow Orchestra – January 1, 2026')
  await expect(page.getByLabel('Concert Title')).toHaveValue('Winter Lights')
  await expect(page.locator('#form-section-toggle-biographies .form-section-summary')).toHaveText('2 entries')
  await expect(page.locator('#form-section-toggle-program .form-section-summary')).toHaveText('3 works')
  await expect(page.locator('#form-section-toggle-ensemblePlayers .form-section-summary')).toHaveText('2 players')
  await expect(page.locator('#form-section-toggle-extras .form-section-summary')).toHaveText('2 entries')
  await expect(page.locator('#form-section-toggle-cover .form-section-summary')).toHaveText('Image and text')
  await expect(doc.locator('.document-cover-clip img')).toHaveAttribute('alt', 'Snow on the town hall roof')
  await expect(doc.locator('.document-biography-photo.image-clip.align-right')).toHaveCount(1)
  await expect(doc.locator('.document-cover-content strong')).toHaveText('Winter Lights')
  await expect(doc.locator('.document-cover-content')).toContainText('A concert for the longest nights.')
  // The class goes on each extra's article
  await expect(page.locator('#extra-class-1')).toHaveValue('thanks')
  // A class that isn't one of the choices is kept
  await expect(page.locator('#extra-class-1 option:checked')).toHaveText('Other: thanks')
  expect(await doc.locator('.document-addenda > article').evaluateAll((articles) => articles.map((article) => article.className))).toEqual(['thanks has-photo', ''])
  await expect(doc.locator('.addendum-photo.image-clip.align-center img')).toHaveAttribute('alt', 'Volunteers setting out chairs')
  await expect(doc.locator('.document-addenda > article').last()).toHaveText('Program subject to change.')
  await expect(page.locator('#form-section-toggle-acknowledgementNames .form-section-summary')).toHaveText('2 acknowledgements')
  await expect(doc.locator('.acknowledgements li')).toHaveText(['Della Price Stage Manager', 'Town Hall Friends'])
  expect(await documentColors(page)).toEqual({ text: '#2b2118', heading: '#7a1f3d', accent: '#b5651d', line: '#e4d9c8' })
  await expect(page.locator('#form-section-toggle-colors .form-section-summary')).toHaveText('Custom')
  await expect(doc.locator('.program-item')).toHaveCount(2) // the third is empty
  await expect(doc.locator('.document-biography-photo img')).toHaveAttribute('alt', 'Photograph of Ines Marlow, Conductor')
  await expect(doc).not.toContainText('Louis Calabro')
})

test('an older file without optional fields still loads', async ({ page }) => {
  await loadConcert(page, fixture('minimal.json'))
  const doc = preview(page)
  await expect(doc.locator('.document-title')).toHaveText('Minimal Concert')
  await expect(doc.locator('.program-item h3')).toHaveText('Only Work')
  await expect(doc.locator('.document-cover, .biographies-page, .program-notes-page, .ensemble-players, .document-addenda, .acknowledgements')).toHaveCount(0)
  await expect(page.getByLabel('Ensemble Name')).toHaveValue('')
  expect(await documentColors(page)).toEqual(defaultColors)
})

test('YAML values are read as plain text', async ({ page }) => {
  await loadConcert(page, fixture('gotchas.yaml'))
  await expect(page.getByLabel('Concert Title')).toHaveValue('007')
  await expect(page.getByLabel('Ensemble Name')).toHaveValue('yes')
  await expect(page.getByLabel('Conductor')).toHaveValue('true')
  await expect(page.getByLabel('Date')).toHaveValue('2026-05-20')
  await expect(page.getByLabel('Location')).toHaveValue('')
  // The blank heading keeps its default; the quoted line colour is read
  expect(await documentColors(page)).toEqual({ ...defaultColors, line: '#e4d9c8' })
  const doc = preview(page)
  await expect(doc.locator('.program-note-link span:not(.program-leader)')).toHaveText(['Suite', /^No\. 1\u2060?$/])
  await expect(doc.locator('.program-note p')).toHaveText(['First paragraph.', 'Second paragraph.'])
  await expect(doc.locator('.document-addenda > article')).toHaveText(['Thank you.', 'With thanks.'])
  await expect(page.locator('#extra-class-2')).toHaveValue('')
})

for (const [file, reason] of [
  ['broken.yaml', 'invalid YAML'],
  ['not-json.json', 'invalid JSON'],
  ['wrong-format.json', 'another format'],
  ['future-version.json', 'an unknown version'],
  ['remote-photo.json', 'a photo that is not an embedded image'],
  ['bad-cover.json', 'a cover image that is not an embedded image'],
  ['bad-image-layout.json', 'an image size or alignment that is out of range'],
  ['bad-extra-image.json', 'an extra image that is not an embedded image'],
  ['bad-acknowledgement.json', 'an acknowledgement role that is not text'],
  ['bad-extra.json', 'an extra whose class is not text'],
  ['bad-color.json', 'a color that is not a plain hex value'],
] as const) {
  test(`a file with ${reason} is rejected and the concert kept`, async ({ page }) => {
    await page.getByLabel('Concert Title').fill('Unsaved work')
    await chooseConcertFile(page, fixture(file))
    await expect(status(page)).toHaveText(`Could not load ${file}. Choose a valid Opus & Octavo JSON or YAML file.`)
    await expect(page.getByLabel('Concert Title')).toHaveValue('Unsaved work')
  })
}

test('the same file can be loaded twice in a row', async ({ page }) => {
  await loadConcert(page, fixture('full-concert.json'))
  await page.getByLabel('Concert Title').fill('Edited')
  await loadConcert(page, fixture('full-concert.json'))
  await expect(page.getByLabel('Concert Title')).toHaveValue('Winter Lights')
})

test.describe('photos', () => {
  test('a biography photo can be added, saved and removed', async ({ page }) => {
    await openSection(page, 'biographies')
    await page.locator('#biography-photo-1').setInputFiles({ name: 'calabro.png', mimeType: 'image/png', buffer: tinyPng })
    await expect(status(page)).toHaveText('Biography photograph added.')
    await expect(page.locator('.editor-biography-photo')).toHaveAttribute('alt', 'Selected photograph of Louis Calabro, Conductor')
    const photo = preview(page).locator('.document-biography-photo')
    await expect(photo).toHaveAttribute('alt', 'Photograph of Louis Calabro, Conductor')
    await expect(photo).toHaveAttribute('src', /^data:image\/png;base64,/)

    const saved = JSON.parse((await saveConcert(page, 'JSON')).text)
    expect(saved.concert.biographies[0].photo).toBe(`data:image/png;base64,${tinyPng.toString('base64')}`)

    await page.getByRole('button', { name: 'Remove photograph' }).click()
    await expect(status(page)).toHaveText('Biography photograph removed.')
    await expect(photo).toHaveCount(0)
  })

  test('a photo can be sized, clipped and aligned, and is saved that way', async ({ page }) => {
    await openSection(page, 'biographies')
    await page.locator('#biography-photo-1').setInputFiles({ name: 'calabro.png', mimeType: 'image/png', buffer: tinyPng })
    const photo = preview(page).locator('.document-biography-photo')
    const field = (name: string) => page.locator(`#biography-photo-1-layout-${name}`)
    const box = async () => {
      const { width, height } = (await photo.boundingBox())!
      return [Math.round(width), Math.round(height)]
    }

    // By default the photo is the plain image, at its usual size and place
    await expect(photo).toHaveJSProperty('tagName', 'IMG')
    await expect(photo).toHaveCSS('float', 'left')
    await field('align').selectOption({ label: 'Right' })
    await expect(photo).toHaveCSS('float', 'right')
    await expect(photo).toHaveJSProperty('tagName', 'IMG')

    // A 1 × 1.5 in clip (96 px to an inch); the square image covers it
    await field('clipWidth').fill('1')
    await field('clipHeight').fill('1.5')
    await expect(photo).toHaveClass(/image-clip/)
    await expect.poll(box).toEqual([96, 144])
    const image = photo.locator('img')
    await expect(image).toHaveAttribute('alt', 'Photograph of Louis Calabro, Conductor')
    // The image's size relative to the inside of the clip, within its border
    const relativeSize = () =>
      image.evaluate((img: HTMLImageElement) => {
        const clip = img.parentElement!
        return [Math.round((img.offsetWidth / clip.clientWidth) * 100), Math.round((img.offsetHeight / clip.clientHeight) * 100)]
      })
    await expect.poll(relativeSize).toEqual([150, 100])
    // The focus picks the part that shows: 0 keeps the left edge
    await field('focusX').fill('0')
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.offsetLeft)).toBe(0)
    // A set image size is used as is: 3 in tall, and as wide again since only
    // the height is set and the image is square
    await field('height').fill('3')
    await expect.poll(relativeSize).toEqual([300, 200])

    // A clip wider than the column is narrowed to it, keeping its shape
    await field('clipWidth').fill('20')
    await field('clipHeight').fill('2')
    const columnWidth = await preview(page).locator('.document-biography').evaluate((article) => article.clientWidth)
    await expect.poll(box).toEqual([columnWidth, Math.round(columnWidth / 10)])

    // Saved with only the fields that are set, and loaded back from YAML
    await field('clipWidth').fill('1')
    await field('clipHeight').fill('1.5')
    await field('height').fill('')
    const saved = JSON.parse((await saveConcert(page, 'JSON')).text)
    expect(saved.concert.biographies[0].photoLayout).toEqual({ clipWidth: 1, clipHeight: 1.5, focusX: 0, align: 'right' })
    await loadConcert(page, (await saveConcert(page, 'YAML')).path)
    await openSection(page, 'biographies')
    await expect(field('clipHeight')).toHaveValue('1.5')
    await expect(field('align')).toHaveValue('right')
    await expect.poll(box).toEqual([96, 144])

    await page.getByRole('button', { name: 'Reset size and position' }).click()
    await expect(photo).toHaveJSProperty('tagName', 'IMG')
    await expect(photo).toHaveCSS('float', 'left')
    expect(JSON.parse((await saveConcert(page, 'JSON')).text).concert.biographies[0]).not.toHaveProperty('photoLayout')
  })

  test('the cover image can be clipped and aligned', async ({ page }) => {
    await openSection(page, 'cover')
    await page.locator('#cover-image').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: tinyPng })
    const cover = preview(page).locator('.document-cover')
    // At its usual size, the alignment moves the image within the cover
    await page.locator('#cover-image-layout-align').selectOption({ label: 'Top' })
    await expect(cover.locator('.document-cover-image')).toHaveCSS('object-position', '50% 0px')

    // A clip half the cover's width sits at its top, centred across it
    await page.locator('#cover-image-layout-clipWidth').fill('2.45')
    const clip = cover.locator('.document-cover-clip')
    await expect(clip).toBeVisible()
    // Measured together, so scrolling can't come between them
    const { coverBox, clipBox } = await cover.evaluate((element) => ({
      coverBox: element.getBoundingClientRect().toJSON(),
      clipBox: element.querySelector('.document-cover-clip')!.getBoundingClientRect().toJSON(),
    }))
    expect(clipBox.width / coverBox.width).toBeCloseTo(0.5, 2)
    expect(Math.round(clipBox.y - coverBox.y)).toBe(0)
    expect(Math.round(clipBox.x - coverBox.x)).toBe(Math.round((coverBox.width - clipBox.width) / 2))
  })

  test('an extra can have an image, laid out like the others', async ({ page }) => {
    await openSection(page, 'extras')
    await page.locator('#extra-1').fill('Short.')
    await page.locator('#extra-image-1').setInputFiles({ name: 'chairs.png', mimeType: 'image/png', buffer: tinyPng })
    await expect(status(page)).toHaveText('Extra image added.')
    const article = preview(page).locator('.document-addenda > article')
    const photo = article.locator('.addendum-photo')
    // The usual photo size and place, and decoration until it's described
    await expect(photo).toHaveJSProperty('tagName', 'IMG')
    await expect(photo).toHaveCSS('float', 'left')
    await expect(photo).toHaveAttribute('alt', '')
    await page.locator('#extra-image-description-1').fill('Volunteers setting out chairs')
    await expect(photo).toHaveAttribute('alt', 'Volunteers setting out chairs')
    // The rule below the extra clears the image, even next to short text
    const [articleBox, photoBox] = [(await article.boundingBox())!, (await photo.boundingBox())!]
    expect(articleBox.y + articleBox.height).toBeGreaterThan(photoBox.y + photoBox.height)

    await page.locator('#extra-image-1-layout-clipWidth').fill('1')
    await page.locator('#extra-image-1-layout-clipHeight').fill('1')
    await page.locator('#extra-image-1-layout-align').selectOption({ label: 'Right' })
    const clip = article.locator('.addendum-photo.image-clip')
    await expect(clip).toHaveCSS('float', 'right')
    await expect(clip.locator('img')).toHaveAttribute('alt', 'Volunteers setting out chairs')

    const saved = JSON.parse((await saveConcert(page, 'JSON')).text).concert.extras[0]
    expect(saved).toMatchObject({
      image: `data:image/png;base64,${tinyPng.toString('base64')}`,
      imageDescription: 'Volunteers setting out chairs',
      imageLayout: { clipWidth: 1, clipHeight: 1, align: 'right' },
    })

    // An image alone is enough for the extra to show
    await page.locator('#extra-1').fill('')
    await expect(clip).toBeVisible()
    await page.locator('#form-section-panel-extras').getByRole('button', { name: 'Remove image' }).click()
    await expect(status(page)).toHaveText('Extra image removed.')
    await expect(preview(page).locator('.document-addenda')).toHaveCount(0)
  })

  test('a program note photo can be added and removed', async ({ page }) => {
    await openSection(page, 'program')
    await page.locator('#program-note-photo-1').setInputFiles({ name: 'score.png', mimeType: 'image/png', buffer: tinyPng })
    await expect(status(page)).toHaveText('Program note photograph added.')
    const photo = preview(page).locator('.program-note-photo')
    await expect(photo).toHaveAttribute('src', /^data:image\/png;base64,/)
    await page.locator('#form-section-panel-program').getByRole('button', { name: 'Remove photograph' }).click()
    await expect(status(page)).toHaveText('Program note photograph removed.')
    await expect(photo).toHaveCount(0)
  })

  test('only PNG, JPEG, WebP or GIF files up to 5 MB are accepted', async ({ page }) => {
    await openSection(page, 'biographies')
    const input = page.locator('#biography-photo-1')
    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(status(page)).toHaveText('Choose a PNG, JPEG, WebP, or GIF image.')
    await input.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) })
    await expect(status(page)).toHaveText('Images must be 5 MB or smaller.')
    await expect(preview(page).locator('.document-biography-photo')).toHaveCount(0)
    // The input is cleared, so choosing the same file again still responds
    await expect(input).toHaveValue('')
  })
})
