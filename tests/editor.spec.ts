// The editor form: starting content, concert details, and adding, editing and
// removing biographies, program items, players, extras and acknowledgements.
import { expect, openSection, preview, status, test } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('starts with the 1974 starter concert', async ({ page }) => {
  const doc = preview(page)
  await expect(page).toHaveTitle('The Sage City Symphony – October 10, 1974')
  await expect(doc.locator('.document-title')).toHaveText('The Sage City Symphony')
  await expect(doc.locator('.document-conductor')).toHaveText('Louis Calabro, conducting')
  await expect(doc.locator('.document-date')).toHaveText('October 10, 1974')
  await expect(doc.locator('.document-location')).toHaveText('Bennington, Vermont')
  await expect(doc.locator('.program-item h3')).toHaveText(/^Concerto for Percussion Quartet and Orchestra\u2060?$/)
  await expect(doc.locator('.document-biography h2')).toHaveText('Louis Calabro, Conductor')
  await expect(doc.locator('.ensemble-player-section h3')).toHaveText('Percussion')
  await expect(doc.locator('.document-addenda h2')).toHaveText('About the Orchestra')
  await expect(status(page)).toHaveText('Preview updates as you type.')
})

test.describe('concert details', () => {
  test('update the preview and the page title as you type', async ({ page }) => {
    const doc = preview(page)
    await page.getByLabel('Concert Title').fill('Winter Lights')
    await expect(doc.locator('.document-title')).toHaveText('Winter Lights')
    await expect(page).toHaveTitle('Winter Lights – October 10, 1974')

    await page.getByLabel('Ensemble Name').fill('Maple Hollow Orchestra')
    await expect(page).toHaveTitle('Winter Lights – Maple Hollow Orchestra – October 10, 1974')

    await page.getByLabel('Conductor').fill('Ines Marlow')
    await expect(doc.locator('.document-conductor')).toHaveText('Ines Marlow, conducting')

    await page.getByLabel('Location').fill('Town Hall')
    await expect(doc.locator('.document-location')).toHaveText('Town Hall')

    await page.getByLabel('Date').fill('2026-12-31')
    await expect(doc.locator('.document-date')).toHaveText('December 31, 2026')
  })

  test("don't repeat an ensemble name the title already contains", async ({ page }) => {
    await page.getByLabel('Ensemble Name').fill('Maple Hollow Orchestra')
    await page.getByLabel('Concert Title').fill('The Maple Hollow Orchestra in Concert')
    await expect(page).toHaveTitle('The Maple Hollow Orchestra in Concert – October 10, 1974')
  })

  test('fall back sensibly when cleared', async ({ page }) => {
    const doc = preview(page)
    await page.getByLabel('Concert Title').fill('')
    await expect(doc.locator('.document-title')).toHaveText('Untitled concert')
    await expect(page).toHaveTitle('October 10, 1974')

    await page.getByLabel('Date').fill('')
    await expect(page).toHaveTitle('Opus & Octavo — Concert program builder')
    await expect(doc.locator('.document-date')).toHaveCount(0)

    await page.getByLabel('Conductor').fill('')
    await expect(doc.locator('.document-conductor')).toHaveCount(0)
    await page.getByLabel('Location').fill('')
    await expect(doc.locator('.concert-details dd')).toHaveCount(0)
  })
})

test.describe('dates', () => {
  // Far from UTC, so a date parsed in local time would show the day before
  test.use({ timezoneId: 'Pacific/Honolulu' })

  test('show the day entered in any time zone', async ({ page }) => {
    await page.getByLabel('Date').fill('2026-01-01')
    await expect(preview(page).locator('.document-date')).toHaveText('January 1, 2026')
  })
})

const lists = [
  { section: 'biographies', noun: 'biography', add: 'Add a biography', added: 'Biography added.', removed: 'Biography removed.', units: ['entry', 'entries'] },
  { section: 'program', noun: 'program item', add: 'Add a program item', added: 'Program item added.', removed: 'Program item removed.', units: ['work', 'works'] },
  { section: 'ensemblePlayers', noun: 'ensemble player', add: 'Add an ensemble player', added: 'Ensemble player added.', removed: 'Ensemble player removed.', units: ['player', 'players'] },
  { section: 'extras', noun: 'extra', add: 'Add an extra', added: 'Extra added.', removed: 'Extra removed.', units: ['entry', 'entries'] },
] as const

for (const list of lists) {
  test(`${list.noun} entries can be added and removed`, async ({ page }) => {
    await openSection(page, list.section)
    const summary = page.locator(`#form-section-toggle-${list.section} .form-section-summary`)
    const panel = page.locator(`#form-section-panel-${list.section}`)
    const removeButtons = panel.getByRole('button', { name: new RegExp(`^Remove ${list.noun} \\d+$`) })
    await expect(summary).toHaveText(`1 ${list.units[0]}`)

    await panel.getByRole('button', { name: list.add }).click()
    await panel.getByRole('button', { name: list.add }).click()
    await expect(status(page)).toHaveText(list.added)
    await expect(summary).toHaveText(`3 ${list.units[1]}`)
    await expect(removeButtons).toHaveCount(3)

    // Removing the first renumbers the rest
    await panel.getByRole('button', { name: `Remove ${list.noun} 1`, exact: true }).click()
    await expect(status(page)).toHaveText(list.removed)
    await expect(summary).toHaveText(`2 ${list.units[1]}`)
    await expect(removeButtons).toHaveText(['Remove', 'Remove'])
    await expect(panel.getByRole('button', { name: `Remove ${list.noun} 3`, exact: true })).toHaveCount(0)

    await removeButtons.first().click()
    await removeButtons.first().click()
    await expect(summary).toHaveText(`0 ${list.units[1]}`)
  })
}

test('biographies appear in the preview, with Markdown', async ({ page }) => {
  const doc = preview(page)
  await openSection(page, 'biographies')
  await page.getByRole('button', { name: 'Add a biography' }).click()
  await page.locator('#biography-name-2').fill('Theo Brandt, Piano')
  await page.locator('#biography-text-2').fill('Theo Brandt is a **pianist**.\n\nHe lives in *Vermont*.')
  const biography = doc.locator('.document-biography').nth(1)
  await expect(biography.locator('h2')).toHaveText('Theo Brandt, Piano')
  await expect(biography.locator('.document-biography-bio p')).toHaveCount(2)
  await expect(biography.locator('strong')).toHaveText('pianist')
  await expect(biography.locator('em')).toHaveText('Vermont')

  // A blank entry isn't shown, and with no entries the section disappears
  await page.getByRole('button', { name: 'Add a biography' }).click()
  await expect(doc.locator('.document-biography')).toHaveCount(2)
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Remove biography 1', exact: true }).click()
  await expect(doc.locator('.biographies-page')).toHaveCount(0)
})

test('program items appear in the preview', async ({ page }) => {
  const doc = preview(page)
  await openSection(page, 'program')
  await page.getByRole('button', { name: 'Add a program item' }).click()
  await page.locator('#program-title-2').fill('Symphony No. 1\nin C minor')
  await page.locator('#composer-2').fill('Johannes Brahms\n(1833–1897)')
  await page.locator('#movements-2').fill('Un poco sostenuto\n\nAndante sostenuto\nAllegro')
  await page.locator('#featured-2').fill('*Ada Lin*, violin')

  const item = doc.locator('.program-item').nth(1)
  await expect(item.locator('h3')).toContainText('Symphony No. 1 in C minor')
  await expect(item.locator('h3 a')).toHaveCount(0) // no note yet, so no link
  await expect(item.locator('.program-leader')).toHaveCount(1)
  await expect(item.locator('.composer-line span')).toHaveText(['Johannes Brahms', '(1833–1897)'])
  await expect(item.locator('.program-movements li')).toHaveText(['Un poco sostenuto', 'Andante sostenuto', 'Allegro'])
  await expect(item.locator('.featured-line em')).toHaveText('Ada Lin')

  // A program note links the title to the note
  await page.locator('#program-note-text-2').fill('A *symphony* long in the making.')
  await page.locator('#program-note-author-2').fill('Notes by Ruth Okafor')
  const link = item.locator('h3 a.program-note-link')
  await expect(link).toHaveAttribute('href', '#program-note-2')
  await expect(link.locator('span:not(.program-leader)')).toHaveText(['Symphony No. 1', /^in C minor\u2060?$/])
  const note = doc.locator('.program-notes-page .program-note-entry').nth(1)
  await expect(note.locator('h3#program-note-2')).toHaveText('Symphony No. 1 in C minor')
  await expect(note.locator('.program-note-composer')).toContainText('Johannes Brahms')
  await expect(note.locator('.program-note em')).toHaveText('symphony')
  await expect(note.locator('.program-note-credit')).toHaveText('Notes by Ruth Okafor')
  await link.click()
  await expect(page).toHaveURL(/#program-note-2$/)
  await expect(note.locator('h3')).toBeInViewport()

  // No composer, no leader; no title, a placeholder
  await page.locator('#composer-2').fill('')
  await expect(item.locator('.program-leader')).toHaveCount(0)
  await page.locator('#program-title-2').fill('')
  await expect(item.locator('h3')).toHaveText('Untitled work')
})

test('an empty program item is left out of the preview', async ({ page }) => {
  await openSection(page, 'program')
  await page.getByRole('button', { name: 'Add a program item' }).click()
  await expect(preview(page).locator('.program-item')).toHaveCount(1)
})

test('players appear in the preview once they have a name and section', async ({ page }) => {
  const doc = preview(page)
  await openSection(page, 'ensemblePlayers')
  await page.getByRole('button', { name: 'Add an ensemble player' }).click()
  await page.locator('#ensemble-player-name-2').fill('Ada Birch')
  await expect(doc.locator('.ensemble-player-name')).toHaveText(['Theodora Wilcoxen'])
  await page.locator('#player-section-2').fill('Flute')
  await page.locator('#player-title-2').fill('Principal')
  await expect(doc.locator('.ensemble-player-section h3')).toHaveText(['Flute', 'Percussion'])
  await expect(doc.locator('.ensemble-player-section').first().locator('li')).toHaveText('Ada Birch Principal')
})

test('extras appear in the preview as Markdown', async ({ page }) => {
  const doc = preview(page)
  await openSection(page, 'extras')
  await page.locator('#extra-1').fill('## Thank You\n\nTo our [volunteers](https://example.org/).\n\n<p class="footnote">Subject to change.</p>')
  const addenda = doc.locator('.document-addenda')
  await expect(addenda.locator('h2')).toHaveText('Thank You')
  await expect(addenda.getByRole('link', { name: 'volunteers' })).toHaveAttribute('href', 'https://example.org/')
  await expect(addenda.locator('p.footnote')).toHaveText('Subject to change.')

  // Blank extras leave no empty section behind
  await page.locator('#extra-1').fill('   ')
  await expect(doc.locator('.document-addenda')).toHaveCount(0)
})

test('acknowledgements can be added, edited and removed', async ({ page }) => {
  const doc = preview(page)
  const summary = page.locator('#form-section-toggle-acknowledgementNames .form-section-summary')
  const section = doc.locator('section.acknowledgements')
  await openSection(page, 'acknowledgementNames')
  await expect(summary).toHaveText('1 acknowledgement')
  await expect(section.locator('li')).toHaveText(['John Doe Supporter'])

  await page.getByRole('button', { name: 'Add an acknowledgement' }).click()
  await expect(status(page)).toHaveText('Acknowledgement added.')
  await expect(summary).toHaveText('2 acknowledgements')
  // Without a name, nothing new is listed yet
  await expect(section.locator('li')).toHaveCount(1)
  await page.locator('#acknowledgement-name-2').fill('Della Price')
  await page.locator('#acknowledgement-role-2').fill('Stage Manager')

  // The role is optional
  await page.getByRole('button', { name: 'Add an acknowledgement' }).click()
  await page.locator('#acknowledgement-name-3').fill('  Town Hall Friends  ')
  await page.getByRole('button', { name: 'Add an acknowledgement' }).click()
  await page.locator('#acknowledgement-role-4').fill('Ushers')
  await expect(summary).toHaveText('4 acknowledgements')

  await expect(section.getByRole('heading', { level: 2 })).toHaveText('Acknowledgements')
  await expect(section.locator('li')).toHaveText(['John Doe Supporter', 'Della Price Stage Manager', 'Town Hall Friends'])
  await expect(section.locator('li').nth(2).locator('.acknowledgement-role')).toHaveCount(0)
  await expect(section.locator('.acknowledgement-role').first()).toHaveCSS('font-style', 'italic')
  // At the end of the document, after the extras, with a green rule between
  // them like the program's; without extras there's no rule
  expect(await doc.locator(':scope > :last-child').getAttribute('class')).toBe('acknowledgements')
  const programRule = await doc.locator('.program-list').evaluate((list) => getComputedStyle(list).borderBottom)
  expect(await section.evaluate((element) => getComputedStyle(element).borderTop)).toBe(programRule)
  await openSection(page, 'extras')
  await page.locator('#extra-1').fill('')
  await expect(section).toHaveCSS('border-top-style', 'none')

  await page.getByRole('button', { name: 'Remove acknowledgement 2', exact: true }).click()
  await expect(status(page)).toHaveText('Acknowledgement removed.')
  await expect(section.locator('li')).toHaveText(['John Doe Supporter', 'Town Hall Friends'])
  await expect(page.locator('#acknowledgement-name-3')).toHaveValue('  Town Hall Friends  ')

  // With every entry removed, the section disappears
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Remove acknowledgement 1', exact: true }).click()
  await expect(summary).toHaveText('0 acknowledgements')
  await expect(section).toHaveCount(0)
})

