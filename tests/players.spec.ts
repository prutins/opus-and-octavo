// How players are grouped and ordered in the preview.
import { expect, fixture, loadConcert, openSection, preview, test } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('players are grouped by ensemble and section, in score order', async ({ page }) => {
  await loadConcert(page, fixture('players.json'))
  const ensembles = preview(page).locator('.ensemble-players')

  // SCS first, then players with no ensemble (headed by the ensemble name), then the chorus
  await expect(ensembles.locator('h2')).toHaveText(['SCS', 'Fixture Orchestra', 'Chorus'])
  // Each ensemble's list is an article, so it closes with the same accent rule
  // as the other sections, and the section itself needs no border. The last
  // one ends the document, which has no closing rule
  const programRule = await preview(page).locator('.program-list').evaluate((list) => getComputedStyle(list).borderBottom)
  const rules = await ensembles.evaluateAll((sections) =>
    sections.map((section) => [
      getComputedStyle(section).borderBottomStyle,
      getComputedStyle(section.querySelector(':scope > article')!).borderBottom,
    ]),
  )
  expect(rules.slice(0, 2)).toEqual([['none', programRule], ['none', programRule]])
  expect(rules[2][1]).toMatch(/ none /)

  const roster = await ensembles.evaluateAll((sections) =>
    sections.map((section) =>
      [...section.querySelectorAll('.ensemble-player-section')].map((group) => [
        group.querySelector('h3')!.textContent,
        [...group.querySelectorAll('li')].map((li) => li.textContent!.trim()),
      ]),
    ),
  )
  expect(roster).toEqual([
    [['Oboe', ['Gus Lane Principal']]],
    [
      ['Flute', ['Iris Vale Principal', 'Ada Birch']],
      // Sections match regardless of case; titles sort before untitled players
      ['Violin I', ['Mara Quill Concertmaster', 'Noel Hart Asst. Concertmaster', 'Bo Ames']],
      ['Viola', ['Rowan Pike']],
      // Sections not in the score-order list come last, alphabetically
      ['Accordion', ['Lee Fenn']],
      ['Kazoo', ['Pat Reed']],
    ],
    [['Soprano', ['Cleo Dunn']], ['Alto', ['Fay Ross']]],
  ])

  // Entries without a name or a section are left out
  await expect(preview(page)).not.toContainText('No Section')
})

test('players in a section are sorted by last name', async ({ page }) => {
  await loadConcert(page, fixture('players.json'))
  await openSection(page, 'ensemblePlayers')
  for (const name of ['Quinn Abbott', 'Sam Zeller']) {
    await page.getByRole('button', { name: 'Add an ensemble player' }).click()
    const player = page.locator('.ensemble-player-group').last()
    await player.locator('input[id^=ensemble-player-name]').fill(name)
    await player.locator('input[id^=player-section]').fill('Viola')
  }
  await expect(preview(page).locator('.ensemble-player-section', { has: page.locator('h3', { hasText: /^Viola$/ }) }).locator('li'))
    .toHaveText(['Quinn Abbott', 'Rowan Pike', 'Sam Zeller'])
})

// Known bug: the sort compares last names only, so players who share one stay
// in the order they were entered. The code comment and README both say
// players are then sorted by first name. Remove test.fail() once fixed.
test('players who share a last name are sorted by first name', async ({ page }) => {
  test.fail()
  await openSection(page, 'ensemblePlayers')
  for (const name of ['Zoe Smith', 'Adam Smith']) {
    await page.getByRole('button', { name: 'Add an ensemble player' }).click()
    const player = page.locator('.ensemble-player-group').last()
    await player.locator('input[id^=ensemble-player-name]').fill(name)
    await player.locator('input[id^=player-section]').fill('Viola')
  }
  await expect(preview(page).locator('.ensemble-player-section', { has: page.locator('h3', { hasText: /^Viola$/ }) }).locator('li'))
    .toHaveText(['Adam Smith', 'Zoe Smith'], { timeout: 2000 })
})

// Known bug: when neither the concert nor the players name an ensemble (as in
// the starter concert), the player list's heading is an empty <h2>. Remove
// test.fail() once fixed.
test('the player list always has a heading', async ({ page }) => {
  test.fail()
  await expect(preview(page).locator('.ensemble-players h2')).not.toHaveText('', { timeout: 2000 })
})
