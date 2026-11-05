// Load from CSV for the ensemble players and acknowledgements. Columns are
// matched by the names in the header row, in any order and ignoring case,
// spaces and punctuation; columns that aren't used are skipped, so a whole
// roster spreadsheet can be exported as it is.

export class CsvError extends Error {}

export type PlayerRow = { name: string; section: string; title: string; ensemble: string }
export type AcknowledgementRow = { name: string; role: string }

// Accepted header names, normalised (see headerKey)
const nameHeaders = {
  name: ['name', 'fullname'],
  firstName: ['firstname', 'first', 'givenname'],
  lastName: ['lastname', 'last', 'surname', 'familyname'],
}
const playerHeaders = {
  section: ['section', 'instrument', 'part'],
  title: ['title', 'position', 'chair'],
  ensemble: ['ensemble', 'group', 'affiliation'],
}
const acknowledgementHeaders = {
  role: ['role', 'level', 'category', 'note', 'notes'],
}

const headerKey = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, '')

// Spreadsheets write commas, or semicolons where the comma is the decimal
// separator; tab-separated exports work too. The header row decides.
function detectDelimiter(text: string) {
  const header = text.split(/\r\n|\r|\n/, 1)[0].replace(/"[^"]*"/g, '')
  const counts = [',', ';', '\t'].map((delimiter) => [delimiter, header.split(delimiter).length] as const)
  return counts.reduce((best, count) => (count[1] > best[1] ? count : best))[0]
}

// RFC 4180: a quoted field may contain the delimiter, line breaks and doubled
// quotes. Blank rows are dropped.
export function parseCsv(text: string, filename: string) {
  const source = text.replace(/^﻿/, '')
  const delimiter = detectDelimiter(source)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (quoted) {
      if (character !== '"') field += character
      else if (source[index + 1] === '"') field += source[index++]
      else quoted = false
    } else if (character === '"' && field === '') {
      quoted = true
    } else if (character === delimiter) {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index++
      rows.push([...row, field])
      row = []
      field = ''
    } else {
      field += character
    }
  }
  if (quoted) {
    throw new CsvError(`${filename} has a quoted value with no closing quote, so it can't be read. Open it in a spreadsheet and export it as CSV again.`)
  }
  rows.push([...row, field])
  return rows.filter((cells) => cells.some((cell) => cell.trim()))
}

// Rows as records of the given fields; a name comes from a Name column, or
// from First name and Last name columns joined
function readList<Field extends string>(text: string, filename: string, headers: Record<Field, string[]>, optional: string) {
  const [header, ...rows] = parseCsv(text, filename)
  if (!header) throw new CsvError(`${filename} is empty.`)

  const keys = header.map(headerKey)
  const columns = Object.fromEntries(
    Object.entries({ ...nameHeaders, ...headers }).map(([field, names]) => [field, keys.findIndex((key) => (names as string[]).includes(key))]),
  )
  if (columns.name < 0 && columns.firstName < 0 && columns.lastName < 0) {
    throw new CsvError(`${filename} needs a header row naming its columns: Name (or First name and Last name), and optionally ${optional}.`)
  }

  const list = rows
    .map((cells) => {
      const cell = (field: string) => (columns[field] < 0 ? '' : (cells[columns[field]] ?? '').trim())
      const name = cell('name') || [cell('firstName'), cell('lastName')].filter(Boolean).join(' ')
      return { name, ...Object.fromEntries(Object.keys(headers).map((field) => [field, cell(field)])) } as { name: string } & Record<Field, string>
    })
    .filter((entry) => Object.values(entry).some(Boolean))
  if (!list.length) throw new CsvError(`${filename} has a header row but no names below it.`)
  return list
}

export function playersFromCsv(text: string, filename: string): PlayerRow[] {
  return readList(text, filename, playerHeaders, 'Section, Title and Ensemble')
}

export function acknowledgementsFromCsv(text: string, filename: string): AcknowledgementRow[] {
  return readList(text, filename, acknowledgementHeaders, 'Role')
}
