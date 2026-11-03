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
  // Read back the way the app reads it: every value as text, except the version
  const fromYaml = parse(yaml.text, { schema: 'failsafe' })
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
  await expect(page.locator('#form-section-toggle-acknowledgementNames .form-section-summary')).toHaveText('2 acknowledgements')
  await expect(doc.locator('.acknowledgements li')).toHaveText(['Della Price Stage Manager', 'Town Hall Friends'])
  expect(await documentColors(page)).toEqual({ text: '#2b2118', heading: '#7a1f3d', accent: '#b5651d', line: '#e4d9c8' })
  await expect(page.locator('#form-section-toggle-colors .form-section-summary')).toHaveText('Custom')
  await expect(doc.locator('.program-item')).toHaveCount(2) // the third is empty
  await expect(doc.locator('.document-biography-photo')).toHaveAttribute('alt', 'Photograph of Ines Marlow, Conductor')
  await expect(doc).not.toContainText('Louis Calabro')
})

test('an older file without optional fields still loads', async ({ page }) => {
  await loadConcert(page, fixture('minimal.json'))
  const doc = preview(page)
  await expect(doc.locator('.document-title')).toHaveText('Minimal Concert')
  await expect(doc.locator('.program-item h3')).toHaveText('Only Work')
  await expect(doc.locator('.biographies-page, .program-notes-page, .ensemble-players, .document-addenda, .acknowledgements')).toHaveCount(0)
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
})

for (const [file, reason] of [
  ['broken.yaml', 'invalid YAML'],
  ['not-json.json', 'invalid JSON'],
  ['wrong-format.json', 'another format'],
  ['future-version.json', 'an unknown version'],
  ['remote-photo.json', 'a photo that is not an embedded image'],
  ['bad-acknowledgement.json', 'an acknowledgement role that is not text'],
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
    await expect(status(page)).toHaveText('Biography photographs must be 5 MB or smaller.')
    await expect(preview(page).locator('.document-biography-photo')).toHaveCount(0)
    // The input is cleared, so choosing the same file again still responds
    await expect(input).toHaveValue('')
  })
})
