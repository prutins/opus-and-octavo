// The editor form: starting content, concert details, and adding, editing and
// removing biographies, program items, players, extras and acknowledgements.
import { defaultColors, documentColors, expect, openSection, preview, status, test, tinyPng } from './helpers.ts'

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
  await expect(item.locator('.composer-line > span')).toHaveText(['Johannes Brahms', '(1833–1897)'])
  // One movement per line; a blank line between them adds no space
  const movements = item.locator('.program-movements')
  await expect.poll(() => movements.evaluate((block: HTMLElement) => block.innerText.split(/\n+/))).toEqual(['Un poco sostenuto', 'Andante sostenuto', 'Allegro'])
  const lineHeight = await movements.evaluate((block) => parseFloat(getComputedStyle(block.querySelector('p')!).lineHeight))
  expect(await movements.evaluate((block) => block.getBoundingClientRect().height)).toBeCloseTo(3 * lineHeight, 0)
  // Nothing is numbered automatically
  await expect(movements.locator('ol, ul')).toHaveCount(0)

  // Lines numbered in Markdown become a numbered list, its text level with
  // plain lines, and inline formatting and links work
  await page.locator('#movements-2').fill('Theme (*Enigma*)\n1. **C.A.E.**\n2. [H.D.S-P.](https://example.com/)\n3. R.B.T.')
  await expect(movements.locator('ol > li')).toHaveText(['C.A.E.', 'H.D.S-P.', 'R.B.T.'])
  // Its numbers are drawn by App.css, not as list markers, so it says it's a list
  await expect(movements.getByRole('list')).toHaveCount(1)
  await expect(movements.locator('em')).toHaveText('Enigma')
  await expect(movements.locator('li strong')).toHaveText('C.A.E.')
  await expect(movements.locator('li a')).toHaveAttribute('href', 'https://example.com/')
  // Four lines, no taller than four plain lines; on screen and in print,
  // every line starts at the same margin, the entries' text level after the
  // numbers (whose own position is checked in the PDF, in
  // export-print.spec.ts), and the lines are the same size
  for (const media of ['screen', 'print'] as const) {
    await page.emulateMedia({ media })
    const lines = await movements.evaluate((block) => {
      const lines = [block.querySelector('p')!, ...block.querySelectorAll('li')]
      // Where the line's text starts, after any number
      const firstGlyph = (line: Element) => {
        const range = document.createRange()
        range.selectNodeContents(line)
        return Math.round(range.getClientRects()[0].left)
      }
      return {
        starts: [...new Set(lines.map((line) => Math.round(line.getBoundingClientRect().left)))],
        margin: Math.round(lines[0].getBoundingClientRect().left),
        textStarts: [...new Set([...block.querySelectorAll('li')].map(firstGlyph))],
        sizes: [...new Set(lines.map((line) => getComputedStyle(line).fontSize))],
        lineHeight: parseFloat(getComputedStyle(lines[0]).lineHeight),
        height: block.getBoundingClientRect().height,
      }
    })
    expect(lines.starts, media).toHaveLength(1)
    expect(lines.textStarts, media).toHaveLength(1)
    expect(lines.textStarts[0], media).toBeGreaterThan(lines.margin)
    expect(lines.sizes, media).toEqual([media === 'print' ? '13.3333px' : '13px'])
    expect(lines.height, media).toBeCloseTo(4 * lines.lineHeight, 0)
  }
  await page.emulateMedia({ media: 'screen' })
  await expect(item.locator('.featured-line em')).toHaveText('Ada Lin')

  // A program note links the title to the note
  await page.locator('#program-note-text-2').fill('A *symphony* long in the making.')
  await page.locator('#program-note-author-2').fill('Notes by *Ruth Okafor*, [Example Press](https://example.org/notes)')
  const link = item.locator('h3 a.program-note-link')
  await expect(link).toHaveAttribute('href', '#program-note-2')
  await expect(link.locator('span:not(.program-leader)')).toHaveText(['Symphony No. 1', /^in C minor\u2060?$/])
  const note = doc.locator('.program-notes-page .program-note-entry').nth(1)
  await expect(note.locator('h3#program-note-2')).toHaveText('Symphony No. 1 in C minor')
  await expect(note.locator('.program-note-composer')).toContainText('Johannes Brahms')
  await expect(note.locator('.program-note em')).toHaveText('symphony')
  // The byline takes inline Markdown, without a paragraph of its own
  const credit = note.locator('.program-note-credit')
  await expect(credit).toHaveText('Notes by Ruth Okafor, Example Press')
  await expect(credit.locator('em')).toHaveText('Ruth Okafor')
  await expect(credit.getByRole('link', { name: 'Example Press' })).toHaveAttribute('href', 'https://example.org/notes')
  await expect(credit.locator('p')).toHaveCount(0)
  await link.click()
  await expect(page).toHaveURL(/#program-note-2$/)
  await expect(note.locator('h3')).toBeInViewport()

  // No composer, no leader; no title, a placeholder
  await page.locator('#composer-2').fill('')
  await expect(item.locator('.program-leader')).toHaveCount(0)
  await page.locator('#program-title-2').fill('')
  await expect(item.locator('h3')).toHaveText('Untitled work')
})

// Titles take inline Markdown, but a link's text only: in the program the
// whole title links to its note, and a link can't hold another
test("a work's title takes inline Markdown, without links", async ({ page }) => {
  const doc = preview(page)
  await openSection(page, 'program')
  await page.getByRole('button', { name: 'Add a program item' }).click()
  await page.locator('#program-title-2').fill('Variations on *America*\n[after Ives](https://example.org/ives)')
  await page.locator('#composer-2').fill('William Schuman')

  const heading = doc.locator('.program-item').nth(1).locator('h3')
  await expect(heading).toHaveText(/^Variations on America after Ives⁠?$/)
  await expect(heading.locator('em')).toHaveText('America')
  await expect(heading.locator('a')).toHaveCount(0)
  // The leader still follows the last line's last word
  await expect(heading.locator('span:not(.program-leader)').last().locator('.program-leader')).toHaveCount(1)

  await page.locator('#program-note-text-2').fill('A set of variations.')
  await page.locator('#program-note-photo-2').setInputFiles({ name: 'score.png', mimeType: 'image/png', buffer: tinyPng })
  await expect(heading.locator('a')).toHaveCount(1)
  await expect(heading.locator('a.program-note-link em')).toHaveText('America')
  const note = doc.locator('.program-notes-page .program-note-entry').nth(1)
  await expect(note.locator('h3')).toHaveText('Variations on America after Ives')
  await expect(note.locator('h3 em')).toHaveText('America')
  await expect(note.locator('h3 a')).toHaveCount(0)
  // Alt text gets the plain words
  await expect(note.locator('.program-note-photo')).toHaveAttribute('alt', 'Image representing Variations on America after Ives')
  await expect(page.locator('#form-section-panel-program .editor-program-note-photo')).toHaveAttribute('alt', 'Selected photograph of Variations on America after Ives')
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

  // Each extra is its own article, like biographies and program notes, with
  // a thin rule between them and the section's accent rule after the last
  await page.getByRole('button', { name: 'Add an extra' }).click()
  await page.locator('#extra-2').fill('Program subject to change.')
  const articles = addenda.locator(':scope > article')
  await expect(articles).toHaveText([/^Thank You/, 'Program subject to change.'])
  await expect(addenda.locator('ul, li')).toHaveCount(0)
  // The default --line and --accent colours
  await expect(articles.first()).toHaveCSS('border-bottom-color', 'rgb(220, 227, 222)')
  await expect(articles.last()).toHaveCSS('border-bottom-color', 'rgb(87, 131, 108)')
  // The chosen rule's class goes on the extra's article, and replaces the
  // automatic rule
  const extraClass = page.locator('#extra-class-2')
  await expect(extraClass).toHaveValue('')
  await expect(articles.first()).not.toHaveAttribute('class')
  await extraClass.selectOption({ label: 'No rule' })
  await expect(articles.last()).toHaveAttribute('class', 'no-rule')
  await expect(articles.last()).toHaveCSS('border-bottom-style', 'none')
  await extraClass.selectOption({ label: 'Thin rule' })
  await expect(articles.last()).toHaveCSS('border-bottom-color', 'rgb(220, 227, 222)')
  await page.locator('#extra-class-1').selectOption({ label: 'Section rule' })
  await expect(articles.first()).toHaveAttribute('class', 'section-rule')
  await expect(articles.first()).toHaveCSS('border-bottom-color', 'rgb(87, 131, 108)')

  // Blank extras leave no empty section behind
  await page.locator('#extra-2').fill('')
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
  // At the end of the document, after the extras, with an accent rule between
  // them like the program's; the document itself ends without a rule
  expect(await doc.locator(':scope > :last-child').getAttribute('class')).toBe('acknowledgements')
  const programRule = await doc.locator('.program-list').evaluate((list) => getComputedStyle(list).borderBottom)
  expect(await doc.locator('.document-addenda > article').evaluate((article) => getComputedStyle(article).borderBottom)).toBe(programRule)
  await expect(section.locator(':scope > article')).toHaveCSS('border-bottom-style', 'none')

  await page.getByRole('button', { name: 'Remove acknowledgement 2', exact: true }).click()
  await expect(status(page)).toHaveText('Acknowledgement removed.')
  await expect(section.locator('li')).toHaveText(['John Doe Supporter', 'Town Hall Friends'])
  await expect(page.locator('#acknowledgement-name-3')).toHaveValue('  Town Hall Friends  ')

  // With every entry removed, the section disappears, and the extras end the
  // document without a rule
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Remove acknowledgement 1', exact: true }).click()
  await expect(summary).toHaveText('0 acknowledgements')
  await expect(section).toHaveCount(0)
  await expect(doc.locator('.document-addenda > article')).toHaveCSS('border-bottom-style', 'none')
  // unless the extra chooses a rule
  await openSection(page, 'extras')
  await page.locator('#extra-class-1').selectOption({ label: 'Section rule' })
  await expect(doc.locator('.document-addenda > article')).toHaveCSS('border-bottom-style', 'solid')
})

test('program colors can be changed, and low text and heading contrast is flagged', async ({ page }) => {
  const summary = page.locator('#form-section-toggle-colors .form-section-summary')
  const text = page.locator('#color-text')
  const heading = page.locator('#color-heading')
  const warning = page.locator('#color-heading-contrast')
  await openSection(page, 'colors')
  await expect(summary).toHaveText('Default')
  await expect(heading).toHaveValue(defaultColors.heading)
  expect(await documentColors(page)).toEqual(defaultColors)

  await text.fill('#2b2118')
  await heading.fill('#7a1f3d')
  await page.locator('#color-accent').fill('#b5651d')
  await page.locator('#color-line').fill('#e4d9c8')
  await expect(summary).toHaveText('Custom')
  expect(await documentColors(page)).toEqual({ text: '#2b2118', heading: '#7a1f3d', accent: '#b5651d', line: '#e4d9c8' })
  await expect(preview(page).locator('.document-title')).toHaveCSS('color', 'rgb(122, 31, 61)')
  await expect(preview(page).locator('.composer-line').first()).toHaveCSS('color', 'rgb(43, 33, 24)')
  await expect(preview(page).locator('.program-list')).toHaveCSS('border-bottom-color', 'rgb(181, 101, 29)')
  // The editor keeps its own colours
  await expect(page.locator('.editor-heading .eyebrow')).toHaveCSS('color', 'rgb(35, 110, 69)')
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(29, 43, 39)')
  await expect(warning).toHaveCount(0)

  // #aaaaaa is 2.32:1 against white
  await heading.fill('#aaaaaa')
  await expect(warning).toHaveText('Contrast with the white page is 2.3:1. Headings need at least 4.5:1 to be easy to read.')
  await expect(heading).toHaveAttribute('aria-describedby', 'color-heading-contrast')
  // #767676 is 4.54:1, just enough
  await heading.fill('#767676')
  await expect(warning).toHaveCount(0)
  await expect(heading).not.toHaveAttribute('aria-describedby')

  // Text gets the same check
  const textWarning = page.locator('#color-text-contrast')
  await text.fill('#aaaaaa')
  await expect(textWarning).toHaveText('Contrast with the white page is 2.3:1. Text needs at least 4.5:1 to be easy to read.')
  await expect(text).toHaveAttribute('aria-describedby', 'color-text-contrast')
  await text.fill('#767676')
  await expect(textWarning).toHaveCount(0)

  await page.getByRole('button', { name: 'Reset to default colors' }).click()
  await expect(status(page)).toHaveText('Colors reset to defaults.')
  await expect(summary).toHaveText('Default')
  expect(await documentColors(page)).toEqual(defaultColors)
})


test('the cover shows an image as large as fits, with the text in front', async ({ page }) => {
  const cover = preview(page).locator('.document-cover')
  const summary = page.locator('#form-section-toggle-cover .form-section-summary')
  await expect(cover).toHaveCount(0)
  await openSection(page, 'cover')
  await expect(summary).toHaveText('None')

  // Text alone, as Markdown or HTML
  await page.locator('#cover-content').fill('## Autumn Concert\n\n<p class="footnote">Free admission</p>')
  await expect(summary).toHaveText('Text')
  await expect(cover.locator('h2')).toHaveText('Autumn Concert')
  await expect(cover.locator('p.footnote')).toHaveText('Free admission')
  await expect(cover.locator('img')).toHaveCount(0)

  // An image fills the cover, which has the shape of a page's content area,
  // and is scaled to fit rather than cropped
  await page.locator('#cover-image').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: tinyPng })
  await expect(status(page)).toHaveText('Cover image added.')
  await expect(summary).toHaveText('Image and text')
  const image = cover.locator('.document-cover-image')
  await expect(image).toHaveCSS('object-fit', 'contain')
  const coverBox = (await cover.boundingBox())!
  expect(coverBox.width / coverBox.height).toBeCloseTo(4.9 / 7.9, 2)
  expect(await image.boundingBox()).toEqual(coverBox)
  // The text is in front of it
  const inFront = await cover.locator('h2').evaluate((heading) => {
    const box = heading.getBoundingClientRect()
    return heading.contains(document.elementFromPoint(box.left + 5, box.top + box.height / 2))
  })
  expect(inFront).toBe(true)

  // Without a description the image is decoration
  await expect(image).toHaveAttribute('alt', '')
  await page.locator('#cover-image-description').fill('A violin on a maple leaf')
  await expect(image).toHaveAttribute('alt', 'A violin on a maple leaf')

  await page.locator('#cover-content').fill('')
  await expect(summary).toHaveText('Image')
  await expect(cover.locator('.document-cover-content')).toHaveCount(0)
  await page.getByRole('button', { name: 'Remove image' }).click()
  await expect(status(page)).toHaveText('Cover image removed.')
  await expect(cover).toHaveCount(0)
})

test('biographies, program notes and extras can each start a new printed page', async ({ page }) => {
  const doc = preview(page)
  const marker = (locator: ReturnType<typeof doc.locator>) =>
    locator.evaluate((element) => getComputedStyle(element, '::before').content)
  await openSection(page, 'biographies')
  await page.getByRole('button', { name: 'Add a biography' }).click()
  await page.locator('#biography-name-2').fill('Ines Marlow, Conductor')
  const biographies = doc.locator('.biographies-page')
  const second = biographies.locator('article').nth(1)

  // A later entry takes the break itself, and the preview marks it
  await page.getByLabel('Start a new page before this biography').nth(1).check()
  await expect(second).toHaveClass(/page-break-before/)
  expect(await marker(second)).toContain('Page break')
  await expect(biographies).not.toHaveClass(/page-break-before/)

  // The first entry's break goes before the whole section instead
  await page.getByLabel('Start a new page before this biography').first().check()
  await expect(biographies).toHaveClass(/page-break-before/)
  await expect(biographies.locator('article').first()).not.toHaveClass(/page-break-before/)

  // Program notes: the section, so the Program Notes heading moves with the note
  await openSection(page, 'program')
  await page.getByLabel('Start a new page before this note').first().check()
  await expect(doc.locator('.program-notes-page')).toHaveClass(/page-break-before/)

  await openSection(page, 'extras')
  await page.getByRole('button', { name: 'Add an extra' }).click()
  await page.locator('#extra-2').fill('Program subject to change.')
  await page.getByLabel('Start a new page before this extra').nth(1).check()
  await expect(doc.locator('.document-addenda > article').nth(1)).toHaveClass(/page-break-before/)
  await expect(doc.locator('.document-addenda')).not.toHaveClass(/page-break-before/)

  // The player list and the acknowledgements each have one checkbox
  const players = doc.locator('.ensemble-players')
  const acknowledgements = doc.locator('.acknowledgements')
  await openSection(page, 'ensemblePlayers')
  await page.getByLabel('Start the ensemble players on a new page').check()
  await expect(players).toHaveClass(/page-break-before/)
  await openSection(page, 'acknowledgementNames')
  await expect(acknowledgements).not.toHaveClass(/page-break-before/)
  await page.getByLabel('Start the acknowledgements on a new page').check()
  await expect(acknowledgements).toHaveClass(/page-break-before/)

  // Printed, these are forced page breaks, and the marker is gone
  await page.emulateMedia({ media: 'print' })
  for (const breaksBefore of [second, biographies, players, acknowledgements]) await expect(breaksBefore).toHaveCSS('break-before', 'page')
  expect(await marker(second)).toBe('none')
})
