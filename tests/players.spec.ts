// How players are grouped and ordered in the preview.
import { expect, fixture, loadConcert, openSection, preview, sampleConcert, test } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('players are grouped by ensemble and section, in score order', async ({ page }) => {
  await loadConcert(page, fixture('players.json'))
  const ensembles = preview(page).locator('.ensemble-players > article')

  // SCS first, then players with no ensemble (headed by the ensemble name), then the chorus
  await expect(ensembles.locator('h2')).toHaveText(['SCS', 'Fixture Orchestra', 'Chorus'])
  // The ensembles are articles in one section, so thin rules separate them;
  // the last ends the document, which has no closing rule
  await expect(preview(page).locator('.ensemble-players')).toHaveCount(1)
  const rules = await ensembles.evaluateAll((articles) => articles.map((article) => getComputedStyle(article).borderBottom))
  expect(rules.slice(0, 2)).toEqual(Array(2).fill('1px solid rgb(220, 227, 222)'))
  expect(rules[2]).toMatch(/ none /)

  const roster = await ensembles.evaluateAll((articles) =>
    articles.map((article) =>
      [...article.querySelectorAll('.ensemble-player-section')].map((group) => [
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

test('players who name the concert’s own ensemble are listed with the players who name none', async ({ page }) => {
  await loadConcert(page, fixture('players.json'))
  await openSection(page, 'ensemblePlayers')
  const players = page.locator('.ensemble-player-group')
  const headings = preview(page).locator('.ensemble-players > article > h2')
  const sections = (heading: string) =>
    preview(page).locator('.ensemble-players > article', { has: page.locator('h2', { hasText: heading }) }).locator('h3')

  // Matching ignores case and surrounding spaces
  await players.nth(0).locator('input[id^=player-ensemble]').fill('fixture orchestra')
  await players.nth(10).locator('input[id^=player-ensemble]').fill(' Fixture Orchestra ')
  await expect(headings).toHaveText(['Fixture Orchestra', 'Chorus'])
  await expect(sections('Fixture Orchestra')).toHaveText(['Flute', 'Oboe', 'Violin I', 'Viola', 'Accordion', 'Kazoo'])

  // Renaming the concert's ensemble brings that ensemble's players in instead
  await page.locator('#ensemble-name').fill('Chorus')
  await expect(headings).toHaveText(['Chorus', 'Fixture Orchestra'])
  await expect(sections('Chorus')).toHaveText(['Flute', 'Violin I', 'Soprano', 'Alto', 'Accordion', 'Kazoo'])
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

test('players who share a last name are sorted by first name', async ({ page }) => {
  await openSection(page, 'ensemblePlayers')
  for (const name of ['Zoe Smith', 'Adam Smith']) {
    await page.getByRole('button', { name: 'Add an ensemble player' }).click()
    const player = page.locator('.ensemble-player-group').last()
    await player.locator('input[id^=ensemble-player-name]').fill(name)
    await player.locator('input[id^=player-section]').fill('Viola')
  }
  await expect(preview(page).locator('.ensemble-player-section', { has: page.locator('h3', { hasText: /^Viola$/ }) }).locator('li'))
    .toHaveText(['Adam Smith', 'Zoe Smith'])
})

test('a note in parentheses after a name doesn’t count as the last name', async ({ page }) => {
  await openSection(page, 'ensemblePlayers')
  // Entered out of order, each with a note that would sort first or last
  for (const name of ['Juno Talbot (AA)', 'Corin Ashgrove (ZZ & YY)', 'Mavis Pembury (BC', 'Lena Ashgrove (ZZ)']) {
    await page.getByRole('button', { name: 'Add an ensemble player' }).click()
    const player = page.locator('.ensemble-player-group').last()
    await player.locator('input[id^=ensemble-player-name]').fill(name)
    await player.locator('input[id^=player-section]').fill('Harp')
  }
  // The notes are still shown
  await expect(preview(page).locator('.ensemble-player-section', { has: page.locator('h3', { hasText: /^Harp$/ }) }).locator('li'))
    .toHaveText(['Corin Ashgrove (ZZ & YY)', 'Lena Ashgrove (ZZ)', 'Mavis Pembury (BC', 'Juno Talbot (AA)'])
})

// The starter concert names no ensemble, for the concert or its players
test('the player list always has a heading', async ({ page }) => {
  const heading = preview(page).locator('.ensemble-players h2')
  await expect(heading).toHaveText('Ensemble Players')
  await page.locator('#ensemble-name').fill('Quarrymoor Consort')
  await expect(heading).toHaveText('Quarrymoor Consort')
  // Spaces alone aren't a name
  await page.locator('#ensemble-name').fill('   ')
  await expect(heading).toHaveText('Ensemble Players')
})

// Runs in the page: for each column list, the lines that start off its row
// grid, and the columns that don't start on the top row
function linesOffColumnRows() {
  const problems: string[] = []
  for (const list of document.querySelectorAll('article.document-paper :is(.ensemble-player-columns, .acknowledgement-columns)')) {
    const row = parseFloat(getComputedStyle(list.querySelector('li')!).lineHeight)
    const top = list.getBoundingClientRect().top + parseFloat(getComputedStyle(list).paddingTop)
    const columnTops = new Map<number, number>()
    for (const element of list.querySelectorAll('h3, li')) {
      for (const box of element.getClientRects()) {
        const offset = box.top - top
        if (Math.abs(offset - Math.round(offset / row) * row) > 0.5) problems.push(`${element.textContent} is ${offset.toFixed(1)}px down`)
        const left = Math.round(box.left)
        columnTops.set(left, Math.min(columnTops.get(left) ?? Infinity, offset))
      }
    }
    if (columnTops.size < 2) problems.push(`${list.className} isn't in columns`)
    for (const [left, offset] of columnTops) if (Math.abs(offset) > 0.5) problems.push(`the column at ${left}px starts ${offset.toFixed(1)}px down`)
  }
  return problems
}

// Every line is one row and a heading two, so the columns' lines are level,
// and a column with a heading holds as much as one without
test('lines in the player and acknowledgement columns are level across columns', async ({ page }) => {
  await loadConcert(page, sampleConcert)
  expect(await page.evaluate(linesOffColumnRows)).toEqual([])
  await page.emulateMedia({ media: 'print' })
  expect(await page.evaluate(linesOffColumnRows)).toEqual([])
})

// Marks and notes after a title, such as "Principal*+" or "Principal (BC)",
// don't stop it counting as the title it starts with. Among the same title,
// fewer marks come first, then the full title decides.
test('titles with marks or a note sort with their title, fewer marks first', async ({ page }) => {
  await openSection(page, 'ensemblePlayers')
  // Entered out of order, and the last names alone would sort them differently
  const players = [
    ['Abel Ames', ''],
    ['Cass Bell', 'Concertmaster *+'],
    ['Zora Yarrow', 'Principal (BC)'],
    ['Dov Cole', 'Concertmaster*'],
    ['Bea Cole', ''],
    ['Yuri Xavier', 'Principal*+'],
    ['Tess Uhl', 'Principal +'],
    ['Wren Vance', 'Concertmaster'],
    ['Vera Ulm', 'Principal'],
  ]
  for (const [name, title] of players) {
    await page.getByRole('button', { name: 'Add an ensemble player' }).click()
    const player = page.locator('.ensemble-player-group').last()
    await player.locator('input[id^=ensemble-player-name]').fill(name)
    await player.locator('input[id^=player-section]').fill('Double Bass')
    await player.locator('input[id^=player-title]').fill(title)
  }
  const names = preview(page).locator('.ensemble-player-section', { has: page.locator('h3', { hasText: /^Double Bass$/ }) }).locator('.ensemble-player-name')
  await expect(names).toHaveText([
    'Wren Vance', // Concertmaster
    'Dov Cole', // Concertmaster*
    'Cass Bell', // Concertmaster *+
    'Vera Ulm', // Principal
    'Zora Yarrow', // Principal (BC): a note isn't a mark
    'Tess Uhl', // Principal +
    'Yuri Xavier', // Principal*+
    'Abel Ames',
    'Bea Cole',
  ])
})
