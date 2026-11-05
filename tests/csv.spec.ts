// Load from CSV for the ensemble players and acknowledgements: columns matched
// by header, a choice to replace or add when the list isn't empty, and the
// loaded entries saved with the concert like any others.
import type { Page } from '@playwright/test'
import { parse } from 'yaml'
import { expect, fixture, loadConcert, openSection, saveConcert, status, test } from './helpers.ts'

type List = 'players' | 'acknowledgements'

async function loadCsv(page: Page, list: List, name: string, text: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: `Load ${list} from CSV…` }).click()
  await (await chooser).setFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })
}

const playerNames = (page: Page) => page.locator('[id^="ensemble-player-name-"]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))
const acknowledgementNames = (page: Page) => page.locator('[id^="acknowledgement-name-"]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))

test.describe('starting from empty lists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadConcert(page, fixture('minimal.json'))
  })

  test('players load by their column names, and are saved with the concert', async ({ page }) => {
    await openSection(page, 'ensemblePlayers')
    // A spreadsheet export: byte order mark, Windows line endings, columns in
    // its own order with one the app doesn't use, quoted values and a blank row
    await loadCsv(page, 'players', 'roster.csv', [
      '﻿Instrument,Last name,First name,Chair,Phone',
      'Violin I,Quillon,Maren,Concertmaster,555-0101',
      '"Cello","Fennimore, Jr.",Tobias,Principal,',
      '',
      'Flute,Ostley,"Dagny ""Dee""",,555-0102',
      '',
    ].join('\r\n'))
    await expect(status(page)).toHaveText('Loaded 3 players from roster.csv.')
    expect(await playerNames(page)).toEqual(['Maren Quillon', 'Tobias Fennimore, Jr.', 'Dagny "Dee" Ostley'])

    const expected = [
      { name: 'Maren Quillon', section: 'Violin I', title: 'Concertmaster', ensemble: '' },
      { name: 'Tobias Fennimore, Jr.', section: 'Cello', title: 'Principal', ensemble: '' },
      { name: 'Dagny "Dee" Ostley', section: 'Flute', title: '', ensemble: '' },
    ]
    expect(JSON.parse((await saveConcert(page, 'JSON')).text).concert.ensemblePlayers).toEqual(expected)
    expect(parse((await saveConcert(page, 'YAML')).text).concert.ensemblePlayers).toEqual(expected)
  })

  test('acknowledgements load from a semicolon-separated file, with Level as the role', async ({ page }) => {
    await openSection(page, 'acknowledgementNames')
    await loadCsv(page, 'acknowledgements', 'donors.csv', 'Name;Level\nIvor Lantry;Patron\nFallow Creek Co-op;Season sponsor\nHattie Penwarden;\n')
    await expect(status(page)).toHaveText('Loaded 3 acknowledgements from donors.csv.')
    await expect(page.locator('.acknowledgements')).toContainText('Fallow Creek Co-op')

    expect(JSON.parse((await saveConcert(page, 'JSON')).text).concert.acknowledgementNames).toEqual([
      { name: 'Ivor Lantry', role: 'Patron' },
      { name: 'Fallow Creek Co-op', role: 'Season sponsor' },
      { name: 'Hattie Penwarden', role: '' },
    ])
  })

  test('a file that can’t be used says why, and changes nothing', async ({ page }) => {
    await openSection(page, 'ensemblePlayers')
    const cases = [
      ['no-header.csv', 'Violin I,Maren Quillon\n', 'no-header.csv needs a header row naming its columns: Name (or First name and Last name), and optionally Section, Title and Ensemble.'],
      ['open-quote.csv', 'Name,Section\n"Maren Quillon,Violin I\n', "open-quote.csv has a quoted value with no closing quote, so it can't be read. Open it in a spreadsheet and export it as CSV again."],
      ['header-only.csv', 'Name,Section\n', 'header-only.csv has a header row but no names below it.'],
      ['empty.csv', '\n\n', 'empty.csv is empty.'],
    ]
    for (const [name, text, message] of cases) {
      await loadCsv(page, 'players', name, text)
      await expect(status(page)).toHaveText(message)
    }
    expect(await playerNames(page)).toEqual([])
  })
})

test('a list that has entries asks whether to replace them or add to the end', async ({ page }) => {
  await page.goto('/')
  await openSection(page, 'ensemblePlayers')
  const startingPlayers = await playerNames(page)
  expect(startingPlayers.length).toBeGreaterThan(0)
  const dialog = page.getByRole('dialog', { name: 'Load 2 players from more.csv?' })
  const more = 'Name,Section\nSelma Ruddock,Viola\nCorwin Ashdale,Oboe\n'

  await loadCsv(page, 'players', 'more.csv', more)
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(`The list already has ${startingPlayers.length} player`)
  // Focus starts on the choice that changes nothing
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Add to the end' }).click()
  await expect(dialog).toBeHidden()
  await expect(status(page)).toHaveText('Added 2 players from more.csv to the end of the list.')
  expect(await playerNames(page)).toEqual([...startingPlayers, 'Selma Ruddock', 'Corwin Ashdale'])

  // Escape is the same as Cancel
  await loadCsv(page, 'players', 'more.csv', more)
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(status(page)).toHaveText('Nothing loaded from more.csv.')
  expect(await playerNames(page)).toEqual([...startingPlayers, 'Selma Ruddock', 'Corwin Ashdale'])

  await loadCsv(page, 'players', 'more.csv', more)
  await dialog.getByRole('button', { name: 'Replace the list' }).click()
  await expect(status(page)).toHaveText('Replaced the list with 2 players from more.csv.')
  expect(await playerNames(page)).toEqual(['Selma Ruddock', 'Corwin Ashdale'])

  // New entries keep working with the editor's own buttons
  await page.getByRole('button', { name: 'Add an ensemble player' }).click()
  expect(await playerNames(page)).toEqual(['Selma Ruddock', 'Corwin Ashdale', ''])
})

test('acknowledgements ask too, and adding keeps the ones already there', async ({ page }) => {
  await page.goto('/')
  await openSection(page, 'acknowledgementNames')
  const starting = await acknowledgementNames(page)
  await loadCsv(page, 'acknowledgements', 'thanks.csv', 'Name,Role\nPellworth Halloran,Friend\n')
  const dialog = page.getByRole('dialog', { name: 'Load 1 acknowledgement from thanks.csv?' })
  await dialog.getByRole('button', { name: 'Add to the end' }).click()
  await expect(status(page)).toHaveText('Added 1 acknowledgement from thanks.csv to the end of the list.')
  expect(await acknowledgementNames(page)).toEqual([...starting, 'Pellworth Halloran'])
})
