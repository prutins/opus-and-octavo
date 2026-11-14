import { type ChangeEvent, type CSSProperties, Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import DOMPurify from 'dompurify'
import { marked} from 'marked'
import './App.css'
import { type AcknowledgementRow, acknowledgementsFromCsv, CsvError, type PlayerRow, playersFromCsv } from './csvImport.ts'
import { createPrintPageTitleRule } from './printPageTitle.ts'
const markedParseOptions = { gfm: true, breaks: true }

// Raw HTML is allowed in Markdown, for footnotes and the like, so the output is
// sanitized: concert files can come from anyone, and Save for Web copies the
// preview onto a website. DOMPurify keeps classes but removes scripts, event
// handlers and javascript: links.
function renderMarkdown(text: string) {
  return DOMPurify.sanitize(marked.parse(text, markedParseOptions).toString())
}

// Movements: Markdown, whose lists number themselves in a column as wide as
// the list's widest number (see .program-movements in App.css). Each list
// gets that width in digits as --digits, from its start and its length.
// role="list": Safari stops announcing lists styled without markers.
function renderMovements(text: string) {
  const template = document.createElement('template')
  template.innerHTML = renderMarkdown(text)
  for (const list of template.content.querySelectorAll('ol, ul')) {
    list.setAttribute('role', 'list')
    if (!(list instanceof HTMLOListElement)) continue
    const last = list.start + list.querySelectorAll(':scope > li').length - 1
    list.style.setProperty('--digits', String(Math.max(String(list.start).length, String(last).length)))
  }
  return template.innerHTML
}

// The same for a one-line field shown inside an element of its own, such as a
// program note's byline: emphasis, links and inline HTML, without a <p>
function renderInlineMarkdown(text: string, { links = true } = {}) {
  // Without links, a link's text is kept but not the link
  return DOMPurify.sanitize(marked.parseInline(text, markedParseOptions).toString(), links ? {} : { FORBID_TAGS: ['a'] })
}

// A work's title: one <span> per line, with inline Markdown but no links,
// since in the program the whole title links to its note. The leader, if
// any, follows the last word, held to it by a word joiner
const titleLeader = '⁠<span class="program-leader" aria-hidden="true"></span>'

function getTitleLines(title: string) {
  return title.split('\n').map((line) => line.trim()).filter(Boolean)
}

function renderTitle(title: string, leader = false) {
  const lines = getTitleLines(title)
  if (lines.length === 0) return <>Untitled work{leader && <>{'⁠'}<span className="program-leader" aria-hidden="true" /></>}</>
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && ' '}
      <span dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(line, { links: false }) + (leader && index === lines.length - 1 ? titleLeader : '') }} />
    </Fragment>
  ))
}

// The title as plain text, for alt text
function getTitleText(title: string) {
  const element = document.createElement('div')
  return getTitleLines(title).map((line) => {
    element.innerHTML = renderInlineMarkdown(line, { links: false })
    return element.textContent ?? ''
  }).join(' ')
}

type ProgramItem = {
  id: number
  title: string
  movements: string
  composer: string
  featured: string
  programNote: string
  programNoteAuthor: string
  photo: string
  photoLayout: ImageLayout
  // Print the note from the top of a new page
  pageBreakBefore: boolean
}

type ConductorBiography = {
  id: number
  name: string
  bio: string
  photo: string
  photoLayout: ImageLayout
  pageBreakBefore: boolean
}

// How an image is sized, clipped and aligned. Blank fields keep the usual
// size and placement; the others are kept as typed, for the form
type ImageLayout = {
  // The image, in inches
  width: string
  height: string
  // The rectangle of it that shows, in inches
  clipWidth: string
  clipHeight: string
  // The point of the image kept at the same point of the clip, in percent
  focusX: string
  focusY: string
  align: string
}

type ImageLayoutField = keyof ImageLayout
type SavedImageLayout = Partial<Record<Exclude<ImageLayoutField, 'align'>, number>> & { align?: string }

const emptyImageLayout: ImageLayout = { width: '', height: '', clipWidth: '', clipHeight: '', focusX: '', focusY: '', align: '' }
const photoAlignments = [['', 'Left'], ['right', 'Right'], ['center', 'Centered']] as const
const coverAlignments = [['', 'Middle'], ['top', 'Top'], ['bottom', 'Bottom']] as const

// A layout field's number, or null when it's blank or out of range
function imageLayoutNumber(field: Exclude<ImageLayoutField, 'align'>, value: string) {
  if (value.trim() === '') return null
  const number = Number(value)
  const inRange = field.startsWith('focus') ? number >= 0 && number <= 100 : number > 0 && number <= 50
  return Number.isFinite(number) && inRange ? number : null
}

const imageLayoutNumberFields = ['width', 'height', 'clipWidth', 'clipHeight', 'focusX', 'focusY'] as const

function parseImageLayout(value: unknown, alignments: readonly (readonly [string, string])[]): ImageLayout | null {
  if (value === undefined) return { ...emptyImageLayout }
  if (!isRecord(value)) return null
  const layout = { ...emptyImageLayout }
  for (const field of imageLayoutNumberFields) {
    const raw = value[field]
    if (raw === undefined || raw === '') continue
    // YAML's failsafe schema reads numbers as strings
    const number = typeof raw === 'number' || typeof raw === 'string' ? imageLayoutNumber(field, String(raw)) : null
    if (number === null) return null
    layout[field] = String(number)
  }
  if (value.align !== undefined && value.align !== '') {
    if (!alignments.some(([align]) => align === value.align)) return null
    layout.align = value.align as string
  }
  return layout
}

// Only the fields that are set, so files without layouts stay as they were
function saveImageLayout(layout: ImageLayout): SavedImageLayout | undefined {
  const saved: SavedImageLayout = {}
  for (const field of imageLayoutNumberFields) {
    const number = imageLayoutNumber(field, layout[field])
    if (number !== null) saved[field] = number
  }
  if (layout.align) saved.align = layout.align
  return Object.keys(saved).length > 0 ? saved : undefined
}

// Whether the image keeps its usual size, clip and focus; alignment is a
// class on the image either way
function usesDefaultFraming(layout: ImageLayout) {
  return imageLayoutNumberFields.every((field) => imageLayoutNumber(field, layout[field]) === null)
}

type Size = [number, number]

// Works out an image's clip rectangle and the image inside it, in inches.
// Without a clip, the clip is the image, or the default rectangle when the
// image has no size either; with only one side of either, the other keeps the
// shape of the default clip or of the image. An image without a size covers
// the clip (photos) or fits inside it (the cover), as by default
function resolveImageLayout(layout: ImageLayout, natural: Size, defaultClip: Size, fit: 'cover' | 'contain') {
  const number = (field: Exclude<ImageLayoutField, 'align'>) => imageLayoutNumber(field, layout[field])
  const naturalRatio = natural[0] / natural[1]
  let [imageWidth, imageHeight] = [number('width'), number('height')]
  if (imageWidth !== null && imageHeight === null) imageHeight = imageWidth / naturalRatio
  if (imageHeight !== null && imageWidth === null) imageWidth = imageHeight * naturalRatio

  let [clipWidth, clipHeight] = [number('clipWidth'), number('clipHeight')]
  if (clipWidth === null && clipHeight === null) {
    ;[clipWidth, clipHeight] = imageWidth !== null && imageHeight !== null ? [imageWidth, imageHeight] : defaultClip
  } else {
    const clipRatio = imageWidth !== null && imageHeight !== null
      ? imageWidth / imageHeight
      : fit === 'cover' ? defaultClip[0] / defaultClip[1] : naturalRatio
    if (clipHeight === null) clipHeight = clipWidth! / clipRatio
    if (clipWidth === null) clipWidth = clipHeight * clipRatio
  }

  if (imageWidth === null || imageHeight === null) {
    const scale = (fit === 'cover' ? Math.max : Math.min)(clipWidth! / natural[0], clipHeight! / natural[1])
    ;[imageWidth, imageHeight] = [natural[0] * scale, natural[1] * scale]
  }

  return {
    clip: [clipWidth!, clipHeight!] as Size,
    image: [imageWidth, imageHeight] as Size,
    focus: [number('focusX') ?? 50, number('focusY') ?? 50] as Size,
  }
}

type EnsemblePlayer = {
  id: number
  name: string
  section: string
  title: string
  ensemble: string
}

type AcknowledgementName = {
  id: number
  name: string
  role: string
}

type Addendum = {
  id: number
  content: string
  class: string
  image: string
  imageDescription: string
  imageLayout: ImageLayout
  pageBreakBefore: boolean
}

// Classes an extra can take to choose the rule below it (App.css); without
// one, it gets the same rules as other entries
const addendumClasses = [
  ['', 'Automatic'],
  ['thin-rule', 'Thin rule'],
  ['section-rule', 'Section rule'],
  ['no-rule', 'No rule'],
] as const

// The cover page: an image as large as fits, with the Markdown text over it,
// and optionally the concert's heading below them instead of on the program
type CoverPage = {
  image: string
  imageDescription: string
  imageLayout: ImageLayout
  content: string
  headingOnCover: boolean
}

const emptyCover: CoverPage = { image: '', imageDescription: '', imageLayout: emptyImageLayout, content: '', headingOnCover: false }

// The program's colours, applied as --text, --heading, --accent and --line on
// the preview, so print and Save for Web follow; the editor has its own. The
// defaults match :root in App.css.
const colorNames = ['text', 'heading', 'accent', 'line'] as const
type ConcertColors = Record<(typeof colorNames)[number], string>
const defaultColors: ConcertColors = { text: '#1d2b27', heading: '#236e45', accent: '#57836c', line: '#dce3de' }

// WCAG 2 contrast ratio of a #rrggbb colour against the white page
function contrastWithWhite(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 1.05 / (0.2126 * red + 0.7152 * green + 0.0722 * blue + 0.05)
}

type ConcertData = {
  ensembleName: string
  concertTitle: string
  date: string
  location: string
  conductor: string
  cover: CoverPage
  // Print these sections from the top of a new page
  ensemblePlayersPageBreak: boolean
  acknowledgementsPageBreak: boolean
  // The acknowledgements are always on the web page; this leaves them out of print
  printAcknowledgements: boolean
  colors: ConcertColors
  biographies: ConductorBiography[]
  ensemblePlayers: EnsemblePlayer[]
  acknowledgementNames: AcknowledgementName[]
  extras: Addendum[]
  items: ProgramItem[]
}

type SavedConcert = {
  format: 'opus-and-octavo-concert'
  version: 1
  concert: Omit<
    ConcertData,
    'cover' | 'items' | 'biographies' | 'ensemblePlayers' | 'acknowledgementNames' | 'extras' | 'ensemblePlayersPageBreak' | 'acknowledgementsPageBreak' | 'printAcknowledgements'
  > & {
    ensemblePlayersPageBreak?: true
    acknowledgementsPageBreak?: true
    printAcknowledgements?: false
    cover: Omit<CoverPage, 'imageLayout' | 'headingOnCover'> & { imageLayout?: SavedImageLayout; headingOnCover?: true }
    biographies: (Omit<ConductorBiography, 'id' | 'photoLayout' | 'pageBreakBefore'> & { photoLayout?: SavedImageLayout; pageBreakBefore?: true })[]
    ensemblePlayers: {
      name: string
      section: string
      title: string
      ensemble: string
    }[]
    acknowledgementNames: Omit<AcknowledgementName, 'id'>[]
    extras: (Omit<Addendum, 'id' | 'imageLayout' | 'pageBreakBefore'> & { imageLayout?: SavedImageLayout; pageBreakBefore?: true })[]
    items: (Omit<ProgramItem, 'id' | 'photoLayout' | 'pageBreakBefore'> & { photoLayout?: SavedImageLayout; pageBreakBefore?: true })[]
  }
}

// A layout under its key, or nothing when it's all defaults
function savedImageLayout<Key extends string>(key: Key, layout: ImageLayout) {
  const saved = saveImageLayout(layout)
  return saved ? ({ [key]: saved } as Record<Key, SavedImageLayout>) : {}
}

// Whether an entry starts a new printed page; YAML's failsafe schema reads
// true and false as text. Null when it's neither
function parsePageBreak(value: unknown): boolean | null {
  if (value === undefined || value === false || value === 'false' || value === '') return false
  if (value === true || value === 'true') return true
  return null
}

// Saved only when set, so files without page breaks stay as they were
function savedPageBreak(pageBreakBefore: boolean) {
  return pageBreakBefore ? { pageBreakBefore: true as const } : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPhotoDataUrl(value: string) {
  return value === '' || /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(value)
}

function readImageDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not read image file'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image file'))
    reader.readAsDataURL(file)
  })
}

function isYamlFile(file: File) {
  return /\.ya?ml$/i.test(file.name)
}

async function readConcertFile(file: File): Promise<unknown> {
  const text = await file.text()
  if (!isYamlFile(file)) return JSON.parse(text)

  // Loaded on demand so JSON-only use doesn't pay for the YAML parser. The
  // failsafe schema reads every value as text exactly as written, so values
  // like 007, true or an empty field stay strings instead of becoming numbers,
  // booleans or null; only the format version is numeric.
  const { parse } = await import('yaml')
  const value: unknown = parse(text, { schema: 'failsafe' })
  if (isRecord(value) && typeof value.version === 'string' && /^\d+$/.test(value.version)) {
    return { ...value, version: Number(value.version) }
  }
  return value
}

function parseSavedConcert(value: unknown): ConcertData | null {
  if (!isRecord(value) || value.format !== 'opus-and-octavo-concert' || value.version !== 1) {
    return null
  }

  const data = value.concert
  if (
    !isRecord(data) ||
    (data.ensembleName !== undefined && typeof data.ensembleName !== 'string') ||
    typeof data.concertTitle !== 'string' ||
    typeof data.date !== 'string' ||
    typeof data.location !== 'string' ||
    typeof data.conductor !== 'string' ||
    !Array.isArray(data.items)
  ) {
    return null
  }

  const biographyData = data.biographies === undefined ? [] : data.biographies
  if (!Array.isArray(biographyData)) {
    return null
  }

  const ensemblePlayerData = data.ensemblePlayers === undefined ? [] : data.ensemblePlayers
  if (!Array.isArray(ensemblePlayerData)) {
    return null
  }

  const acknowledgementData = data.acknowledgementNames === undefined ? [] : data.acknowledgementNames
  if (!Array.isArray(acknowledgementData)) {
    return null
  }

  const colorData = data.colors === undefined ? {} : data.colors
  if (!isRecord(colorData)) {
    return null
  }

  const colors = { ...defaultColors }
  for (const name of colorNames) {
    const value = colorData[name]
    // Blank, as an unquoted #rrggbb in YAML reads, keeps the default
    if (value === undefined || value === '') continue
    // Only plain hex colours: any other CSS value could load outside files
    // into the program and its web page
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
      return null
    }
    colors[name] = value.toLowerCase()
  }

  const ensemblePlayersPageBreak = parsePageBreak(data.ensemblePlayersPageBreak)
  const acknowledgementsPageBreak = parsePageBreak(data.acknowledgementsPageBreak)
  if (ensemblePlayersPageBreak === null || acknowledgementsPageBreak === null) {
    return null
  }
  // Printed unless the file says otherwise: blank, as YAML reads an empty
  // value, keeps the default, as it does for a page break
  const printAcknowledgements = data.printAcknowledgements === undefined || data.printAcknowledgements === '' ? true : parsePageBreak(data.printAcknowledgements)
  if (printAcknowledgements === null) {
    return null
  }

  const coverData = data.cover === undefined ? {} : data.cover
  if (
    !isRecord(coverData) ||
    (coverData.image !== undefined && (typeof coverData.image !== 'string' || !isPhotoDataUrl(coverData.image))) ||
    (coverData.imageDescription !== undefined && typeof coverData.imageDescription !== 'string') ||
    (coverData.content !== undefined && typeof coverData.content !== 'string') ||
    (coverData.headingOnCover !== undefined && typeof coverData.headingOnCover !== 'boolean')
  ) {
    return null
  }

  const coverImageLayout = parseImageLayout(coverData.imageLayout, coverAlignments)
  if (!coverImageLayout) {
    return null
  }

  const cover: CoverPage = {
    image: typeof coverData.image === 'string' ? coverData.image : '',
    imageDescription: typeof coverData.imageDescription === 'string' ? coverData.imageDescription : '',
    imageLayout: coverImageLayout,
    content: typeof coverData.content === 'string' ? coverData.content : '',
    headingOnCover: coverData.headingOnCover === true,
  }

  const extraData = data.extras === undefined ? [] : data.extras
  if (!Array.isArray(extraData)) {
    return null
  }

  const biographies: ConductorBiography[] = []
  for (const [index, biography] of biographyData.entries()) {
    if (
      !isRecord(biography) ||
      (biography.name !== undefined && typeof biography.name !== 'string') ||
      (biography.bio !== undefined && typeof biography.bio !== 'string') ||
      (biography.photo !== undefined && (typeof biography.photo !== 'string' || !isPhotoDataUrl(biography.photo)))
    ) {
      return null
    }

    const photoLayout = parseImageLayout(biography.photoLayout, photoAlignments)
    const pageBreakBefore = parsePageBreak(biography.pageBreakBefore)
    if (!photoLayout || pageBreakBefore === null) {
      return null
    }

    biographies.push({
      id: index + 1,
      name: typeof biography.name === 'string' ? biography.name : '',
      bio: typeof biography.bio === 'string' ? biography.bio : '',
      photo: typeof biography.photo === 'string' ? biography.photo : '',
      photoLayout,
      pageBreakBefore,
    })
  }

  const ensemblePlayers: EnsemblePlayer[] = []
  for (const [playerIndex, player] of ensemblePlayerData.entries()) {
    if (
      !isRecord(player) ||
      (player.name !== undefined && typeof player.name !== 'string') ||
      (player.section !== undefined && typeof player.section !== 'string')
      // it's okay if the title and/or ensemble is left blank.
    ) {
      return null
    }

    ensemblePlayers.push({
      id: playerIndex + 1,
      name: typeof player.name === 'string' ? player.name : '',
      section: typeof player.section === 'string' ? player.section : '',
      title: typeof player.title === 'string' ? player.title : '',
      ensemble: typeof player.ensemble === 'string' ? player.ensemble : '',
    })
  }

  const extras: Addendum[] = []
  for (const [index, extra] of extraData.entries()) {
    // Older files saved each extra as its Markdown alone
    if (typeof extra === 'string') {
      extras.push({ id: index + 1, content: extra, class: '', image: '', imageDescription: '', imageLayout: emptyImageLayout, pageBreakBefore: false })
      continue
    }

    if (
      !isRecord(extra) ||
      (extra.content !== undefined && typeof extra.content !== 'string') ||
      (extra.class !== undefined && typeof extra.class !== 'string') ||
      (extra.image !== undefined && (typeof extra.image !== 'string' || !isPhotoDataUrl(extra.image))) ||
      (extra.imageDescription !== undefined && typeof extra.imageDescription !== 'string')
    ) {
      return null
    }

    const imageLayout = parseImageLayout(extra.imageLayout, photoAlignments)
    const pageBreakBefore = parsePageBreak(extra.pageBreakBefore)
    if (!imageLayout || pageBreakBefore === null) {
      return null
    }

    extras.push({
      id: index + 1,
      content: typeof extra.content === 'string' ? extra.content : '',
      class: typeof extra.class === 'string' ? extra.class : '',
      image: typeof extra.image === 'string' ? extra.image : '',
      imageDescription: typeof extra.imageDescription === 'string' ? extra.imageDescription : '',
      imageLayout,
      pageBreakBefore,
    })
  }

  const acknowledgementNames: AcknowledgementName[] = []
  for (const [index, acknowledgement] of acknowledgementData.entries()) {
    if (
      !isRecord(acknowledgement) ||
      (acknowledgement.name !== undefined && typeof acknowledgement.name !== 'string') ||
      (acknowledgement.role !== undefined && typeof acknowledgement.role !== 'string')
    ) {
      return null
    }

    acknowledgementNames.push({
      id: index + 1,
      name: typeof acknowledgement.name === 'string' ? acknowledgement.name : '',
      role: typeof acknowledgement.role === 'string' ? acknowledgement.role : '',
    })
  }

  const items: ProgramItem[] = []
  for (const [index, item] of data.items.entries()) {
    if (
      !isRecord(item) ||
      typeof item.title !== 'string' ||
      (item.movements !== undefined && typeof item.movements !== 'string') ||
      typeof item.composer !== 'string' ||
      // it's okay not to have a featured field
      // typeof item.featured !== 'string' ||
      typeof item.programNote !== 'string' ||
      (item.programNoteAuthor !== undefined && typeof item.programNoteAuthor !== 'string') ||
      (item.photo !== undefined && (typeof item.photo !== 'string' || !isPhotoDataUrl(item.photo)))
    ) {
      return null
    }

    const photoLayout = parseImageLayout(item.photoLayout, photoAlignments)
    const pageBreakBefore = parsePageBreak(item.pageBreakBefore)
    if (!photoLayout || pageBreakBefore === null) {
      return null
    }

    items.push({
      id: index + 1,
      title: item.title,
      movements: typeof item.movements === 'string' ? item.movements : '',
      composer: item.composer,
      featured: typeof item.featured === 'string' ? item.featured : '',
      programNote: item.programNote,
      programNoteAuthor: typeof item.programNoteAuthor === 'string' ? item.programNoteAuthor : '',
      photo: item.photo !== undefined && typeof item.photo === 'string' ? item.photo : '',
      photoLayout,
      pageBreakBefore,
    })
  }

  return {
    ensembleName: typeof data.ensembleName === 'string' ? data.ensembleName : '',
    concertTitle: data.concertTitle,
    date: data.date,
    location: data.location,
    conductor: data.conductor,
    cover,
    ensemblePlayersPageBreak,
    acknowledgementsPageBreak,
    printAcknowledgements,
    colors,
    biographies,
    ensemblePlayers,
    acknowledgementNames,
    extras,
    items,
  }
}

// A stub of the Sage City Symphony's October 10, 1974 concert, which included
// the premiere of Ptaszyńska's concerto. The player is invented.
const initialConcert: ConcertData = {
  ensembleName: '',
  concertTitle: 'The Sage City Symphony',
  date: '1974-10-10',
  location: 'Bennington, Vermont',
  conductor: 'Louis Calabro',
  cover: emptyCover,
  ensemblePlayersPageBreak: false,
  acknowledgementsPageBreak: false,
  printAcknowledgements: true,
  colors: defaultColors,
  biographies: [
    {
      id: 1,
      name: 'Louis Calabro, Conductor',
      bio: 'Louis Calabro is a composer, conductor, and percussionist who has taught music at Bennington College since 1955. He studied piano and composition at the Juilliard School of Music, where his principal teacher was Vincent Persichetti. With his wife, Christine Graham, he founded the Sage City Symphony, a community orchestra in southwestern Vermont that commissions and performs new works alongside the standard repertoire.',
      photo: '',
      photoLayout: emptyImageLayout,
      pageBreakBefore: false,
    },
  ],
  ensemblePlayers: [
    { id: 1, name: 'Theodora Wilcoxen', section: 'Percussion', title: '', ensemble: '' },
  ],
  acknowledgementNames: [
    {
      id: 1,
      name: 'John Doe',
      role: 'Supporter',
    }
  ],
  extras: [
    {
      id: 1,
      class: '',
      image: '',
      imageDescription: '',
      imageLayout: emptyImageLayout,
      pageBreakBefore: false,
      content: '## About the Orchestra\n\nRead about the Sage City Symphony’s fiftieth anniversary in the Bennington Banner: [Sage City Symphony to celebrate 50th anniversary](https://www.benningtonbanner.com/arts-and-culture/sage-city-symphony-to-celebrate-50th-anniversary/2994848) (May 8, 2023).',
    },
  ],
  items: [
    {
      id: 1,
      title: 'Concerto for Percussion Quartet and Orchestra',
      movements: '',
      composer: 'Marta Ptaszyńska\n(b. 1943)',
      featured: '',
      programNote: 'Commissioned by the Sage City Symphony and premiered by the orchestra under Louis Calabro on this program. Marta Ptaszyńska, a Polish composer and percussionist, taught percussion and composition at Bennington College in 1973–74.',
      programNoteAuthor: '',
      photo: '',
      photoLayout: emptyImageLayout,
      pageBreakBefore: false,
    },
  ],
}

type OrderedPlayerEntry = {
  id: string
  name: string
  title: string
  ensemble: string
}

type EnsemblePlayerSection = {
  name: string
  entries: OrderedPlayerEntry[]
}

type Ensemble = {
  name: string
  entries: EnsemblePlayerSection[]
}

const ensembleOrder = [
  'scs',
  '',
  'chorus'
]

function getEnsembleOrder(ensemble: string) {
  const order = ensembleOrder.indexOf(ensemble.trim().toLocaleLowerCase())
  return order === -1 ? ensembleOrder.length : order
}

const orchestralInstrumentOrder = [
  'piccolo',
  'flute',
  'oboe',
  'english horn',
  'clarinet',
  'bass clarinet',
  'bassoon',
  'contra-bassoon',
  'french horn',
  'horn',
  'trumpet',
  'cornet',
  'trombone',
  'bass trombone',
  'tuba',
  'timpani',
  'percussion',
  'snare drum',
  'bass drum',
  'cymbals',
  'triangle',
  'tambourine',
  'glockenspiel',
  'xylophone',
  'vibraphone',
  'harp',
  'piano',
  'celesta',
  'celeste',
  'organ',
  'violin i',
  'violin ii',
  'viola',
  'cello',
  'double bass',
  'soprano',
  'tenor',
  'alto',
  'bass'
]

function getOrchestralInstrumentOrder(instrument: string) {
  const order = orchestralInstrumentOrder.indexOf(instrument.trim().toLocaleLowerCase())
  return order === -1 ? orchestralInstrumentOrder.length : order
}

// Titles listed first in a section, in this order. A title matches whatever
// marks or note follow it, such as "Principal*+" or "Principal (BC)"; among
// the same title, fewer marks come first, then the full title decides.
// Players with any other title come next, then those with none.
const orchestralTitleOrder = [
  'concert master',
  'concertmaster',
  'concert mistress',
  'concertmistress',
  'asst. concert master',
  'asst. concertmaster',
  'assistant concertmaster',
  'assistant concert master',
  'asst. concert mistress',
  'asst. concertmistress',
  'assistant concertmistress',
  'assistant concert mistress',
  'principal',
]

// A note in parentheses after a name, such as a group within the ensemble
// "(BC & BCCS)", isn't part of the name for sorting; an unclosed one runs to
// the end. A name that is only a note is sorted as it is.
function getNameForSorting(name: string) {
  return name.replace(/\([^)]*(\)|$)/g, ' ').replace(/\s+/g, ' ').trim() || name.trim()
}

// Marks after a title, such as * or +, usually keyed to a note elsewhere
const titleMarks = /[*+†‡§#]/g

// A title's rank: its place in the list, then any other title, then none.
// A title that is only marks or a note, such as "*" or "(BC)", is none.
const otherTitleOrder = orchestralTitleOrder.length
const noTitleOrder = orchestralTitleOrder.length + 1

function getOrchestralTitleOrder(title: string) {
  const lowerTitle = title.replace(/\([^)]*(\)|$)/g, ' ').replace(titleMarks, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  if (!lowerTitle) return noTitleOrder
  const order = orchestralTitleOrder.indexOf(lowerTitle)
  return order === -1 ? otherTitleOrder : order
}

// Marks inside a note in parentheses don't count
function getTitleMarkCount(title: string) {
  return getNameForSorting(title).match(titleMarks)?.length ?? 0
}

// Players with no ensemble of their own, or the concert's own ensemble name,
// are listed together under the concert's ensemble (the '' group)
function getEnsemblePlayerSections(players: EnsemblePlayer[], ensembleName: string): Ensemble[] { //PlayerSection[] {
  const mainEnsemble = ensembleName.trim().toLocaleLowerCase()
  const assignments = players.flatMap((player) => {
      const section = player.section.trim()
      const title = player.title.trim()
      const name = player.name.trim()
      const ensemble = player.ensemble.trim().toLocaleLowerCase() === mainEnsemble ? '' : player.ensemble.trim()
      if (!section || !name) return []

      return [{
        id: `${player.id}`,
        section: `${section}`,
        title: `${title}`, 
        name: `${name}`,
        ensemble: `${ensemble}`,
      }]
    }
  )

  assignments.sort((first, second) => {
    const ensembleOrderDifference = getEnsembleOrder(first.ensemble) - getEnsembleOrder(second.ensemble)
    if (ensembleOrderDifference !== 0) return ensembleOrderDifference

    const sectionOrderDifference = getOrchestralInstrumentOrder(first.section) - getOrchestralInstrumentOrder(second.section)
    if (sectionOrderDifference !== 0) return sectionOrderDifference

    const sectionNameDifference = first.section.localeCompare(second.section, undefined, { sensitivity: 'base' })
    if (sectionNameDifference !== 0) return sectionNameDifference

    const titleOrder = getOrchestralTitleOrder(first.title)
    const titleOrderDifference = titleOrder - getOrchestralTitleOrder(second.title)
    if (titleOrderDifference !== 0) return titleOrderDifference

    // Players without a title go by name alone, whatever marks or note they have
    if (titleOrder !== noTitleOrder) {
      const titleMarkDifference = getTitleMarkCount(first.title) - getTitleMarkCount(second.title)
      if (titleMarkDifference !== 0) return titleMarkDifference

      const titleNameDifference = first.title.localeCompare(second.title, undefined, { sensitivity: 'base' })
      if (titleNameDifference !== 0) return titleNameDifference
    }

    /* if all else is equal, sort by last name, then first name */
    const firstName = getNameForSorting(first.name)
    const secondName = getNameForSorting(second.name)
    const firstNameParts = firstName.split(/\s+/)
    const secondNameParts = secondName.split(/\s+/)
    const lastNameDifference = firstNameParts[firstNameParts.length - 1].localeCompare(secondNameParts[secondNameParts.length - 1], undefined, { sensitivity: 'base' })
    if (lastNameDifference !== 0) return lastNameDifference
    const nameDifference = firstName.localeCompare(secondName, undefined, { sensitivity: 'base' })
    if (nameDifference !== 0) return nameDifference
    return first.name.localeCompare(second.name, undefined, { sensitivity: 'base' })
  })

  const ensembles: Ensemble[] = []
  for (const assignment of assignments) {
    let ensemble = ensembles.find((e) => e.name.toLocaleLowerCase() === assignment.ensemble.toLocaleLowerCase())
    if (!ensemble) {
      ensemble = { name: assignment.ensemble, entries: [] }
      ensembles.push(ensemble)
    }
    let group = ensemble.entries.find((section) => section.name.toLocaleLowerCase() === assignment.section.toLocaleLowerCase())
    if (!group) {
      group = { name: assignment.section, entries: [] }
      ensemble.entries.push(group)
    }
    group.entries.push({
      id: assignment.id,
      name: assignment.name,
      title: assignment.title,
      ensemble: assignment.ensemble,
    })
  }

  return ensembles
}

function formatDate(value: string) {
  if (!value) return ''

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function getConcertFilename(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'concert-program'
}

// Identifies the specific concert, for the browser tab, the PDF's title and page
// headers, and the web export's title, e.g. "The Sage City Symphony – May 20, 2026"
function getDocumentTitle(concert: Pick<ConcertData, 'ensembleName' | 'concertTitle' | 'date'>) {
  const title = concert.concertTitle.trim()
  const ensemble = concert.ensembleName.trim()
  const parts = [
    title,
    ensemble && !title.toLocaleLowerCase().includes(ensemble.toLocaleLowerCase()) ? ensemble : '',
    formatDate(concert.date),
  ].filter(Boolean)
  return parts.join(' – ')
}

function countOf(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// A CSV loaded into a list that already has entries, waiting for the reader
// to choose whether it replaces them or is added to the end
type PendingCsv =
  | { list: 'ensemblePlayers'; rows: PlayerRow[]; filename: string }
  | { list: 'acknowledgementNames'; rows: AcknowledgementRow[]; filename: string }

type FormSectionId = 'details' | 'cover' | 'biographies' | 'program' | 'ensemblePlayers' | 'extras' | 'acknowledgementNames' | 'colors'

const defaultOpenFormSections: Record<FormSectionId, boolean> = {
  details: true,
  cover: false,
  biographies: false,
  program: false,
  ensemblePlayers: false,
  extras: false,
  acknowledgementNames: false,
  colors: false,
}

function FormSection({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: FormSectionId
  title: string
  summary?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const toggleId = `form-section-toggle-${id}`
  const panelId = `form-section-panel-${id}`

  return (
    <div className="form-section">
      <h2 className="form-section-heading">
        <button
          id={toggleId}
          className="form-section-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span className="form-section-title">{title}</span>
          {summary && <span className="form-section-summary">{summary}</span>}
        </button>
      </h2>
      <div className="form-section-panel" id={panelId} role="region" aria-labelledby={toggleId} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

// The natural size of an image, once it has loaded
function useNaturalSize(src: string): Size | null {
  const [loaded, setLoaded] = useState<{ src: string; size: Size } | null>(null)
  useEffect(() => {
    if (!src) return
    const image = new Image()
    image.onload = () => setLoaded({ src, size: [image.naturalWidth, image.naturalHeight] })
    image.src = src
    return () => {
      image.onload = null
    }
  }, [src])
  return loaded?.src === src ? loaded.size : null
}

// The usual photo: 8.8rem wide at 4:5, with 10px to a rem and 96px to an inch
const defaultPhotoClip: Size = [88 / 96, 110 / 96]
// The cover page's content area (App.css)
const coverArea: Size = [4.9, 7.9]

// The image's size and position in percent of its clip, so it all scales
// together when the clip is narrowed to fit
function imageInClip(clip: Size, image: Size, focus: Size): CSSProperties {
  return {
    width: `${(image[0] / clip[0]) * 100}%`,
    height: `${(image[1] / clip[1]) * 100}%`,
    left: `${focus[0]}%`,
    top: `${focus[1]}%`,
    translate: `${-focus[0]}% ${-focus[1]}%`,
  }
}

// A biography or program note photo. With the usual size it's the plain
// image; otherwise the image is set inside a clip at most the column's width
function DocumentPhoto({ className, src, alt, hidden, layout }: {
  className: string
  src: string
  alt: string
  hidden?: boolean
  layout: ImageLayout
}) {
  const natural = useNaturalSize(src)
  const classes = layout.align ? `${className} align-${layout.align}` : className
  if (usesDefaultFraming(layout) || !natural) {
    return <img className={classes} src={src} alt={alt} aria-hidden={hidden || undefined} />
  }

  const { clip, image, focus } = resolveImageLayout(layout, natural, defaultPhotoClip, 'cover')
  return (
    <span className={`${classes} image-clip`} style={{ width: `min(${clip[0]}in, 100%)`, aspectRatio: `${clip[0]} / ${clip[1]}` }}>
      <img src={src} alt={alt} aria-hidden={hidden || undefined} style={imageInClip(clip, image, focus)} />
    </span>
  )
}

// The cover image: by default as large as fits the cover; otherwise in a clip
// that fits the cover, centred across it and placed by its alignment
function CoverImage({ src, alt, layout }: { src: string; alt: string; layout: ImageLayout }) {
  const natural = useNaturalSize(src)
  const alignClass = layout.align ? ` align-${layout.align}` : ''
  if (usesDefaultFraming(layout) || !natural) {
    return <img className={`document-cover-image${alignClass}`} src={src} alt={alt} />
  }

  const { clip, image, focus } = resolveImageLayout(layout, natural, coverArea, 'contain')
  const scale = Math.min(1, coverArea[0] / clip[0], coverArea[1] / clip[1])
  return (
    <span
      className={`document-cover-clip${alignClass}`}
      // No wider than fits the cover, and no taller than the space left above
      // a heading on the cover (its container's height, in cqh)
      style={{ width: `min(${((clip[0] * scale) / coverArea[0]) * 100}%, ${(clip[0] / clip[1]) * 100}cqh)`, aspectRatio: `${clip[0]} / ${clip[1]}` }}
    >
      <img src={src} alt={alt} style={imageInClip(clip, image, focus)} />
    </span>
  )
}

function ImageLayoutFields({ id, layout, alignments, onChange }: {
  id: string
  layout: ImageLayout
  alignments: readonly (readonly [string, string])[]
  onChange: (layout: ImageLayout) => void
}) {
  const numberField = (field: Exclude<ImageLayoutField, 'align'>, label: string, unit: 'in' | '%') => (
    <div className="image-layout-field">
      <label className="field-label" htmlFor={`${id}-${field}`}>
        {label} <span className="label-note">{unit}</span>
      </label>
      <input
        id={`${id}-${field}`}
        name={`${id}-${field}`}
        type="number"
        inputMode="decimal"
        min={unit === '%' ? 0 : 0.05}
        max={unit === '%' ? 100 : 50}
        step={unit === '%' ? 1 : 0.05}
        value={layout[field]}
        onChange={(event) => onChange({ ...layout, [field]: event.target.value })}
      />
    </div>
  )

  return (
    <fieldset className="image-layout" aria-describedby={`${id}-hint`}>
      <legend className="field-label">Size and position</legend>
      <p className="image-layout-hint" id={`${id}-hint`}>
        Blank fields keep the usual size and placement. The clip is the part of the image that shows, and the focus
        picks which part, from 0 (left or top) to 100 (right or bottom).
      </p>
      <div className="image-layout-grid">
        {numberField('width', 'Image width', 'in')}
        {numberField('height', 'Image height', 'in')}
        {numberField('clipWidth', 'Clip width', 'in')}
        {numberField('clipHeight', 'Clip height', 'in')}
        {numberField('focusX', 'Focus across', '%')}
        {numberField('focusY', 'Focus down', '%')}
      </div>
      <label className="field-label" htmlFor={`${id}-align`}>Alignment</label>
      <select
        id={`${id}-align`}
        name={`${id}-align`}
        value={layout.align}
        onChange={(event) => onChange({ ...layout, align: event.target.value })}
      >
        {alignments.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <button className="remove-button" type="button" onClick={() => onChange(emptyImageLayout)}>
        Reset size and position
      </button>
    </fieldset>
  )
}

type PageBreakEntry = { id: number; pageBreakBefore: boolean }

function withPageBreak<Entry extends PageBreakEntry>(entries: Entry[], id: number, pageBreakBefore: boolean) {
  return entries.map((entry) => (entry.id === id ? { ...entry, pageBreakBefore } : entry))
}

// The class for an entry printed from the top of a new page. For a section's
// first shown entry the section takes the break instead (sectionPageBreak), so
// its spacing and heading come along
function entryPageBreak(entry: PageBreakEntry, first: PageBreakEntry | undefined) {
  return entry.pageBreakBefore && entry !== first ? ' page-break-before' : ''
}

// An ensemble's heading: its name, capitalized, or for the players with no
// ensemble of their own, the concert's ensemble name; blank if neither is set
function ensembleHeading(name: string, concertEnsembleName: string) {
  return name.charAt(0).toUpperCase() + name.slice(1) || concertEnsembleName.trim()
}

function sectionPageBreak(first: PageBreakEntry | undefined) {
  return first?.pageBreakBefore ? ' page-break-before' : ''
}

function PageBreakField({ id, checked, disabled = false, label, onChange }: {
  id: string
  checked: boolean
  disabled?: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="checkbox-field" htmlFor={id}>
      <input id={id} name={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label} <span className="label-note">in print</span>
    </label>
  )
}

function App() {
  const [concert, setConcert] = useState(initialConcert)
  const [nextItemId, setNextItemId] = useState(initialConcert.items.length + 1)
  const [nextBiographyId, setNextBiographyId] = useState(initialConcert.biographies.length + 1)
  const [nextExtraId, setNextExtraId] = useState(initialConcert.extras.length + 1)
  const [nextEnsemblePlayerId, setNextEnsemblePlayerId] = useState(initialConcert.ensemblePlayers.length + 1)
  const [nextAcknowledgementId, setNextAcknowledgementId] = useState(initialConcert.acknowledgementNames.length + 1)
  const [status, setStatus] = useState('Preview updates as you type.')
  const [openFormSections, setOpenFormSections] = useState(defaultOpenFormSections)
  const [editorCollapsed, setEditorCollapsed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bookletInputRef = useRef<HTMLInputElement>(null)
  const documentPreviewRef = useRef<HTMLElement>(null)
  const topbarRef = useRef<HTMLElement>(null)
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const saveMenuRef = useRef<HTMLDivElement>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const playersCsvInputRef = useRef<HTMLInputElement>(null)
  const acknowledgementsCsvInputRef = useRef<HTMLInputElement>(null)
  const [pendingCsv, setPendingCsv] = useState<PendingCsv | null>(null)
  const csvDialogRef = useRef<HTMLDialogElement>(null)
  const csvCancelRef = useRef<HTMLButtonElement>(null)
  const ensemblePlayerEnsembles = getEnsemblePlayerSections(concert.ensemblePlayers, concert.ensembleName)
  // Like players, an acknowledgement needs a name to be listed
  const acknowledgements = concert.acknowledgementNames
    .map((acknowledgement) => ({ ...acknowledgement, name: acknowledgement.name.trim(), role: acknowledgement.role.trim() }))
    .filter((acknowledgement) => acknowledgement.name)

  const documentTitle = getDocumentTitle(concert)
  const coverContent = renderMarkdown(concert.cover.content)
  const hasCover = Boolean(concert.cover.image || coverContent)
  const headingOnCover = hasCover && concert.cover.headingOnCover
  // The concert's title, conductor, date and place: above the program, or on
  // the cover below its image
  const documentHeading = (
    <header className="document-heading">
      {/* The document's own h1, so a PDF printed from the app has one */}
      <h1 className="document-title">{concert.concertTitle || 'Untitled concert'}</h1>
      {concert.conductor && <p className="document-conductor">{concert.conductor}, conducting</p>}

      <dl className="concert-details">
        {concert.date && (
          <div>
            <dt className="visually-hidden">Date</dt>
            <dd className="document-date">{formatDate(concert.date)}</dd>
          </div>
        )}
        {concert.location && (
          <div>
            <dt className="visually-hidden">Location</dt>
            <dd className="document-location">{concert.location}</dd>
          </div>
        )}
      </dl>
    </header>
  )

  // The first entry each section shows, which decides where its page break goes
  const firstBiography = concert.biographies.find((biography) => biography.name || biography.bio || biography.photo)
  const firstProgramNote = concert.items.find((item) => renderMarkdown(item.programNote))
  const firstExtra = concert.extras.find((entry) => entry.content.trim() || entry.image)
  const colorsAreDefault = colorNames.every((name) => concert.colors[name] === defaultColors[name])
  const documentColors = {
    '--text': concert.colors.text,
    '--heading': concert.colors.heading,
    '--accent': concert.colors.accent,
    '--line': concert.colors.line,
  } as CSSProperties
  const printTitle = documentTitle || 'Untitled concert'

  useEffect(() => {
    document.title = documentTitle || 'Opus & Octavo — Concert program builder'
  }, [documentTitle])

  // The top bar's height varies as its buttons wrap; scroll-padding-top in
  // App.css uses it to keep scrolled-to and focused content clear of the bar
  // on phones, where the page scrolls under it
  useEffect(() => {
    const topbar = topbarRef.current
    if (!topbar) return

    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--topbar-height', `${topbar.offsetHeight}px`)
    })
    observer.observe(topbar)
    return () => observer.disconnect()
  }, [])

  // Close the save menu when a click or keyboard focus lands outside it.
  // Focus is watched where it arrives rather than where it leaves: Safari
  // doesn't focus buttons on click, so closing on blur would hide the menu
  // before a click on one of its options registered.
  useEffect(() => {
    if (!saveMenuOpen) return

    function closeIfOutside(event: Event) {
      if (!saveMenuRef.current?.contains(event.target as Node)) setSaveMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeIfOutside)
    document.addEventListener('focusin', closeIfOutside)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside)
      document.removeEventListener('focusin', closeIfOutside)
    }
  }, [saveMenuOpen])

  useEffect(() => {
    const printTitleStyle = document.createElement('style')
    printTitleStyle.media = 'print'
    printTitleStyle.textContent = createPrintPageTitleRule(printTitle, concert.colors.text)
    document.head.append(printTitleStyle)

    return () => printTitleStyle.remove()
  }, [printTitle, concert.colors.text])

  async function loadConcertFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    try {
      const parsed = parseSavedConcert(await readConcertFile(file))
      if (!parsed) throw new Error('Invalid concert data')

      setConcert(parsed)
      setNextItemId(parsed.items.length + 1)
      setNextBiographyId(parsed.biographies.length + 1)
      setNextExtraId(parsed.extras.length + 1)
      setNextEnsemblePlayerId(parsed.ensemblePlayers.length + 1)
      setNextAcknowledgementId(parsed.acknowledgementNames.length + 1)
      setOpenFormSections(defaultOpenFormSections)
      setStatus(`Loaded ${file.name}.`)
    } catch {
      setStatus(`Could not load ${file.name}. Choose a valid Opus & Octavo JSON or YAML file.`)
    } finally {
      input.value = ''
    }
  }

  function toggleFormSection(id: FormSectionId) {
    setOpenFormSections((current) => ({ ...current, [id]: !current[id] }))
  }

  function downloadFile(contents: BlobPart, type: string, filename: string) {
    const url = URL.createObjectURL(new Blob([contents], { type }))
    const download = document.createElement('a')
    download.href = url
    download.download = filename
    download.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  function getSavedConcert(): SavedConcert {
    return {
      format: 'opus-and-octavo-concert',
      version: 1,
      concert: {
        concertTitle: concert.concertTitle,
        ensembleName: concert.ensembleName,
        date: concert.date,
        location: concert.location,
        conductor: concert.conductor,
        cover: {
          image: concert.cover.image,
          imageDescription: concert.cover.imageDescription,
          ...savedImageLayout('imageLayout', concert.cover.imageLayout),
          content: concert.cover.content,
          ...(concert.cover.headingOnCover ? { headingOnCover: true as const } : {}),
        },
        colors: { ...concert.colors },
        biographies: concert.biographies.map(({ name, bio, photo, photoLayout, pageBreakBefore }) => ({
          name,
          bio,
          photo,
          ...savedImageLayout('photoLayout', photoLayout),
          ...savedPageBreak(pageBreakBefore),
        })),
        ensemblePlayers: concert.ensemblePlayers.map(({ section, name, title, ensemble }) => ({
          section,
          name,
          title,
          ensemble,
        })),
        ...(concert.ensemblePlayersPageBreak ? { ensemblePlayersPageBreak: true as const } : {}),
        acknowledgementNames: concert.acknowledgementNames.map(({ name, role }) => ({ name, role })),
        ...(concert.acknowledgementsPageBreak ? { acknowledgementsPageBreak: true as const } : {}),
        ...(concert.printAcknowledgements ? {} : { printAcknowledgements: false as const }),
        extras: concert.extras.map(({ content, class: className, image, imageDescription, imageLayout, pageBreakBefore }) => ({
          content,
          class: className,
          image,
          imageDescription,
          ...savedImageLayout('imageLayout', imageLayout),
          ...savedPageBreak(pageBreakBefore),
        })),
        items: concert.items.map(({ title, movements, composer, featured, programNote, programNoteAuthor, photo, photoLayout, pageBreakBefore }) => ({
          title,
          movements,
          composer,
          featured,
          programNote,
          programNoteAuthor,
          photo,
          ...savedImageLayout('photoLayout', photoLayout),
          ...savedPageBreak(pageBreakBefore),
        })),
      },
    }
  }

  function chooseSaveFormat(save: () => void) {
    setSaveMenuOpen(false)
    saveButtonRef.current?.focus()
    save()
  }

  function saveConcertFile() {
    const filename = getConcertFilename(concert.concertTitle)
    downloadFile(JSON.stringify(getSavedConcert(), null, 2), 'application/json', `${filename}.json`)
    setStatus(`Downloaded ${filename}.json.`)
  }

  async function saveConcertYamlFile() {
    const filename = getConcertFilename(concert.concertTitle)
    try {
      const { stringify } = await import('yaml')
      // Literal blocks keep multi-line text readable, and no line folding
      // keeps each paragraph on one line
      const yaml = stringify(getSavedConcert(), { blockQuote: 'literal', lineWidth: 0 })
      downloadFile(yaml, 'application/yaml', `${filename}.yaml`)
      setStatus(`Downloaded ${filename}.yaml.`)
    } catch {
      setStatus(`Could not save ${filename}.yaml. Try again.`)
    }
  }

  async function saveWebFile() {
    const preview = documentPreviewRef.current
    if (!preview) return

    // In the app the document is labelled as a preview; as a page of its own it
    // needs no label. Copied before loading the exporter, so the page matches
    // the preview when the button was pressed
    const exported = preview.cloneNode(true) as HTMLElement
    exported.removeAttribute('aria-label')

    // Loaded only when needed: it carries the stylesheet and both fonts
    let webExport: typeof import('./webExport.ts')
    try {
      webExport = await import('./webExport.ts')
    } catch {
      setStatus("Couldn't prepare the web page. Check your connection and try again.")
      return
    }

    const filename = getConcertFilename(concert.concertTitle)
    const html = webExport.createStaticWebPage(printTitle, exported, concert.colors.text)
    downloadFile(html, 'text/html', `${filename}.html`)
    setStatus(`Downloaded ${filename}.html for web.`)
  }

  async function makeBookletFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    setStatus(`Making a booklet from ${file.name}…`)
    // Loaded only when needed: it carries two PDF libraries
    let booklet: typeof import('./booklet.ts')
    try {
      booklet = await import('./booklet.ts')
    } catch {
      setStatus("Couldn't prepare the booklet maker. Check your connection and try again.")
      return
    }

    try {
      const made = await booklet.makeBooklet(await file.arrayBuffer(), file.name)
      const filename = `${file.name.replace(/\.pdf$/i, '')}-booklet.pdf`
      downloadFile(made.bytes, 'application/pdf', filename)
      setStatus(booklet.describeBooklet(made, filename))
    } catch (error) {
      setStatus(error instanceof booklet.BookletError ? error.message : `Couldn't make a booklet from ${file.name}. Try again.`)
    }
  }

  function addProgramItem() {
    const id = nextItemId
    setNextItemId((currentId) => currentId + 1)
    setConcert((currentConcert) => ({
      ...currentConcert,
      items: [
        ...currentConcert.items,
        { id, title: '', movements: '', composer: '', featured: '', programNote: '', programNoteAuthor: '', photo: '', photoLayout: emptyImageLayout, pageBreakBefore: false },
      ],
    }))
    setStatus('Program item added.')
  }

  function addBiography() {
    const id = nextBiographyId
    setNextBiographyId((currentId) => currentId + 1)
    setConcert((currentConcert) => ({
      ...currentConcert,
      biographies: [...currentConcert.biographies, { id, name: '', bio: '', photo: '', photoLayout: emptyImageLayout, pageBreakBefore: false }],
    }))
    setStatus('Biography added.')
  }

  function removeBiography(id: number) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      biographies: currentConcert.biographies.filter((biography) => biography.id !== id),
    }))
    setStatus('Biography removed.')
  }

  function updateBiography(id: number, field: 'name' | 'bio' | 'photo', value: string) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      biographies: currentConcert.biographies.map((biography) =>
        biography.id === id ? { ...biography, [field]: value } : biography,
      ),
    }))
  }

  function isValidPhoto(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setStatus('Choose a PNG, JPEG, WebP, or GIF image.')
      return false
    }

    if (file.size > 5 * 1024 * 1024) {
      setStatus('Images must be 5 MB or smaller.')
      return false
    }
    return true
  }

  async function loadBiographyPhoto(id: number, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    if (!isValidPhoto(file)) {
      input.value = ''
      return
    }

    // if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
    //   setStatus('Choose a PNG, JPEG, WebP, or GIF image.')
    //   input.value = ''
    //   return
    // }

    // if (file.size > 5 * 1024 * 1024) {
    //   setStatus('Biography photographs must be 5 MB or smaller.')
    //   input.value = ''
    //   return
    // }

    try {
      updateBiography(id, 'photo', await readImageDataUrl(file))
      setStatus('Biography photograph added.')
    } catch {
      setStatus('Could not read that photograph.')
    } finally {
      input.value = ''
    }
  }

  function addEnsemblePlayer() {
    const id = nextEnsemblePlayerId
    setNextEnsemblePlayerId((currentId) => currentId + 1)
    // The Add button is above the list, so go to the new entry at the end
    flushSync(() => setConcert((currentConcert) => ({
      ...currentConcert,
      ensemblePlayers: [...currentConcert.ensemblePlayers, { id, name: '', section: '', title: '', ensemble: '' }],
    })))
    document.getElementById(`ensemble-player-name-${id}`)?.focus()
    setStatus('Ensemble player added.')
  }

  async function loadListCsv(list: PendingCsv['list'], event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    let pending: PendingCsv
    try {
      const text = await file.text()
      pending = list === 'ensemblePlayers'
        ? { list, rows: playersFromCsv(text, file.name), filename: file.name }
        : { list, rows: acknowledgementsFromCsv(text, file.name), filename: file.name }
    } catch (error) {
      setStatus(error instanceof CsvError ? error.message : `Could not read ${file.name}.`)
      return
    }
    if (concert[list].length) setPendingCsv(pending)
    else applyCsv(pending, 'load')
  }

  function applyCsv(pending: PendingCsv, mode: 'load' | 'replace' | 'append') {
    const count = pending.list === 'ensemblePlayers' ? countOf(pending.rows.length, 'player') : countOf(pending.rows.length, 'acknowledgement')
    if (pending.list === 'ensemblePlayers') {
      const firstId = nextEnsemblePlayerId
      setNextEnsemblePlayerId(firstId + pending.rows.length)
      const players = pending.rows.map((row, index) => ({ id: firstId + index, ...row }))
      setConcert((current) => ({ ...current, ensemblePlayers: mode === 'append' ? [...current.ensemblePlayers, ...players] : players }))
    } else {
      const firstId = nextAcknowledgementId
      setNextAcknowledgementId(firstId + pending.rows.length)
      const names = pending.rows.map((row, index) => ({ id: firstId + index, ...row }))
      setConcert((current) => ({ ...current, acknowledgementNames: mode === 'append' ? [...current.acknowledgementNames, ...names] : names }))
    }
    setStatus({
      load: `Loaded ${count} from ${pending.filename}.`,
      replace: `Replaced the list with ${count} from ${pending.filename}.`,
      append: `Added ${count} from ${pending.filename} to the end of the list.`,
    }[mode])
  }

  // Opened for a pending CSV, with focus on Cancel, the choice that changes nothing
  useEffect(() => {
    const dialog = csvDialogRef.current
    if (!pendingCsv || !dialog || dialog.open) return
    dialog.returnValue = ''
    dialog.showModal()
    csvCancelRef.current?.focus()
  }, [pendingCsv])

  function finishCsvDialog(choice: string) {
    if (!pendingCsv) return
    if (choice === 'replace' || choice === 'append') applyCsv(pendingCsv, choice)
    else setStatus(`Nothing loaded from ${pendingCsv.filename}.`)
    setPendingCsv(null)
  }

  function removeEnsemblePlayer(id: number) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      ensemblePlayers: currentConcert.ensemblePlayers.filter((player) => player.id !== id),
    }))
    setStatus('Ensemble player removed.')
  }

  // function updateEnsemblePlayerName(id: number, name: string) {
  //   setConcert((currentConcert) => ({
  //     ...currentConcert,
  //     ensemblePlayers: currentConcert.ensemblePlayers.map((player) =>
  //       player.id === id ? { ...player, name } : player,
  //     ),
  //   }))
  // }

  function updateEnsemblePlayer(
    playerId: number,
    field: 'name' | 'section' | 'title' | 'ensemble',
    value: string,
  ) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      ensemblePlayers: currentConcert.ensemblePlayers.map((player) =>
        player.id === playerId ? { ...player, [field]: value }
          : player,
      ),
    }))
  }
  
  function addAcknowledgement() {
    const id = nextAcknowledgementId
    setNextAcknowledgementId((currentId) => currentId + 1)
    flushSync(() => setConcert((currentConcert) => ({
      ...currentConcert,
      acknowledgementNames: [...currentConcert.acknowledgementNames, { id, name: '', role: '' }],
    })))
    document.getElementById(`acknowledgement-name-${id}`)?.focus()
    setStatus('Acknowledgement added.')
  }

  function removeAcknowledgement(id: number) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      acknowledgementNames: currentConcert.acknowledgementNames.filter((acknowledgement) => acknowledgement.id !== id),
    }))
    setStatus('Acknowledgement removed.')
  }

  function updateAcknowledgement(id: number, field: 'name' | 'role', value: string) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      acknowledgementNames: currentConcert.acknowledgementNames.map((acknowledgement) =>
        acknowledgement.id === id ? { ...acknowledgement, [field]: value } : acknowledgement,
      ),
    }))
  }

  function updateColor(name: keyof ConcertColors, value: string) {
    setConcert((currentConcert) => ({ ...currentConcert, colors: { ...currentConcert.colors, [name]: value } }))
  }

  function resetColors() {
    setConcert((currentConcert) => ({ ...currentConcert, colors: defaultColors }))
    setStatus('Colors reset to defaults.')
  }

  function addExtra() {
    const id = nextExtraId
    setNextExtraId((currentId) => currentId + 1)
    setConcert((currentConcert) => ({
      ...currentConcert,
      extras: [...currentConcert.extras, { id, content: '', class: '', image: '', imageDescription: '', imageLayout: emptyImageLayout, pageBreakBefore: false }],
    }))
    setStatus('Extra added.')
  }

  function removeExtra(id: number) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      extras: currentConcert.extras.filter((entry) => entry.id !== id),
    }))
    setStatus('Extra removed.')
  }

  function updateExtra(id: number, field: 'content' | 'class' | 'image' | 'imageDescription', value: string) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      extras: currentConcert.extras.map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry,
      ),
    }))
  }

  function setExtraImageLayout(id: number, imageLayout: ImageLayout) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      extras: currentConcert.extras.map((entry) => (entry.id === id ? { ...entry, imageLayout } : entry)),
    }))
  }

  async function loadExtraImage(id: number, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (!isValidPhoto(file)) {
      input.value = ''
      return
    }

    try {
      updateExtra(id, 'image', await readImageDataUrl(file))
      setStatus('Extra image added.')
    } catch {
      setStatus('Could not read that image.')
    } finally {
      input.value = ''
    }
  }

  function removeProgramItem(id: number) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      items: currentConcert.items.filter((item) => item.id !== id),
    }))
    setStatus('Program item removed.')
  }

  function updateProgramItem(
    id: number,
    field: 'title' | 'movements' | 'composer' | 'featured' | 'programNote' | 'programNoteAuthor' | 'photo',
    value: string,
  ) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      items: currentConcert.items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    }))
  }

  function setCoverImageLayout(imageLayout: ImageLayout) {
    setConcert((currentConcert) => ({ ...currentConcert, cover: { ...currentConcert.cover, imageLayout } }))
  }

  function setBiographyPhotoLayout(id: number, photoLayout: ImageLayout) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      biographies: currentConcert.biographies.map((biography) => (biography.id === id ? { ...biography, photoLayout } : biography)),
    }))
  }

  function setProgramNotePhotoLayout(id: number, photoLayout: ImageLayout) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      items: currentConcert.items.map((item) => (item.id === id ? { ...item, photoLayout } : item)),
    }))
  }

  function updateCover(field: Exclude<keyof CoverPage, 'imageLayout' | 'headingOnCover'>, value: string) {
    setConcert((currentConcert) => ({ ...currentConcert, cover: { ...currentConcert.cover, [field]: value } }))
  }

  async function loadCoverImage(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (!isValidPhoto(file)) {
      input.value = ''
      return
    }

    try {
      updateCover('image', await readImageDataUrl(file))
      setStatus('Cover image added.')
    } catch {
      setStatus('Could not read that image.')
    } finally {
      input.value = ''
    }
  }

  async function loadProgramNotePhoto(id: number, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (!isValidPhoto(file)) {
      input.value = ''
      return
    }
    
    try {
      updateProgramItem(id, 'photo', await readImageDataUrl(file))
      setStatus('Program note photograph added.')
    } catch {
      setStatus('Could not read that photograph.')
    } finally {
      input.value = ''
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar" ref={topbarRef}>
        <a className="brand" href="#main-content" aria-label="Opus and Octavo home">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span>OPUS <span className="brand-amp">&</span> OCTAVO</span>
        </a>
        <div className="topbar-actions">
          <span className="save-state"><span aria-hidden="true" /> Live preview</span>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml"
            aria-hidden="true"
            tabIndex={-1}
            onChange={loadConcertFile}
          />
          <input
            ref={bookletInputRef}
            className="visually-hidden"
            type="file"
            accept=".pdf,application/pdf"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => void makeBookletFile(event)}
          />
          <button className="file-button" type="button" onClick={() => fileInputRef.current?.click()}>
            Load File
          </button>
          <div
            className="save-menu"
            ref={saveMenuRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && saveMenuOpen) {
                setSaveMenuOpen(false)
                saveButtonRef.current?.focus()
              }
            }}
          >
            <button
              ref={saveButtonRef}
              className="file-button save-menu-button"
              type="button"
              aria-expanded={saveMenuOpen}
              aria-controls="save-menu-options"
              onClick={() => setSaveMenuOpen((open) => !open)}
            >
              Save
            </button>
            <div className="save-menu-options" id="save-menu-options" hidden={!saveMenuOpen}>
              <button type="button" onClick={() => chooseSaveFormat(saveConcertFile)}>
                Save as JSON
              </button>
              <button type="button" onClick={() => chooseSaveFormat(() => void saveConcertYamlFile())}>
                Save as YAML
              </button>
              <button
                type="button"
                onClick={() =>
                  chooseSaveFormat(() => {
                    setStatus('Choose the half-letter PDF saved from Print / Save PDF.')
                    bookletInputRef.current?.click()
                  })
                }
              >
                Booklet from PDF…
              </button>
            </div>
          </div>
          <button className="file-button" type="button" onClick={() => void saveWebFile()}>
            Save for Web
          </button>
          <button className="print-button" type="button" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </header>

      <main className={editorCollapsed ? 'workspace editor-collapsed' : 'workspace'}>
        <aside className="editor-panel" aria-labelledby="editor-title">
          <div className="editor-rail">
            <button
              className="editor-toggle"
              type="button"
              aria-label="Editor panel"
              aria-expanded={!editorCollapsed}
              aria-controls="editor-content"
              title={editorCollapsed ? 'Expand editor' : 'Collapse editor'}
              onClick={() => setEditorCollapsed((collapsed) => !collapsed)}
            />
          </div>
          <div className="editor-content" id="editor-content">
            {/* The brand link's target: inside the editor panel, so following it
                scrolls the panel back to the top on wider screens */}
            <div className="editor-heading" id="main-content">
              <p className="eyebrow">DOCUMENT BUILDER <span>01 / 01</span></p>
              <h1 id="editor-title">Shape your<br />document.</h1>
              <p className="editor-intro">Enter your content below. The accessible document updates alongside it.</p>
            </div>

            <form className="document-form" onSubmit={(event) => event.preventDefault()}>
              <FormSection
                id="details"
                title="Concert details"
                open={openFormSections.details}
                onToggle={() => toggleFormSection('details')}
              >
                <fieldset className="form-group metadata-group">
                  <legend className="visually-hidden">Concert details</legend>
                  <label className="field-label" htmlFor="ensemble-name">Ensemble Name</label>
                  <input
                    id="ensemble-name"
                    name="ensembleName"
                    type="text"
                    value={concert.ensembleName}
                    onChange={(event) => setConcert({ ...concert, ensembleName: event.target.value })}
                  />

                  <label className="field-label" htmlFor="concert-title">Concert Title</label>
                  <input
                    id="concert-title"
                    name="concertTitle"
                    type="text"
                    value={concert.concertTitle}
                    onChange={(event) => setConcert({ ...concert, concertTitle: event.target.value })}
                  />

                  <div className="field-row">
                    <div className="field-control">
                      <label className="field-label" htmlFor="concert-date">Date</label>
                      <input
                        id="concert-date"
                        name="date"
                        type="date"
                        value={concert.date}
                        onChange={(event) => setConcert({ ...concert, date: event.target.value })}
                      />
                    </div>
                    <div className="field-control">
                      <label className="field-label" htmlFor="location">Location</label>
                      <input
                        id="location"
                        name="location"
                        type="text"
                        value={concert.location}
                        onChange={(event) => setConcert({ ...concert, location: event.target.value })}
                      />
                    </div>
                  </div>

                  <label className="field-label" htmlFor="conductor">Conductor</label>
                  <input
                    id="conductor"
                    name="conductor"
                    type="text"
                    value={concert.conductor}
                    onChange={(event) => setConcert({ ...concert, conductor: event.target.value })}
                  />
                </fieldset>
              </FormSection>

              <FormSection
                id="cover"
                title="Cover"
                summary={concert.cover.image ? (coverContent ? 'Image and text' : 'Image') : coverContent ? 'Text' : 'None'}
                open={openFormSections.cover}
                onToggle={() => toggleFormSection('cover')}
              >
                <fieldset className="form-group">
                  <legend className="visually-hidden">Cover page</legend>
                  <label className="field-label" htmlFor="cover-image">
                    Image <span className="label-note">optional, max 5 MB; shown as large as fits the page</span>
                  </label>
                  <input
                    id="cover-image"
                    name="coverImage"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => void loadCoverImage(event)}
                  />
                  {concert.cover.image && (
                    <div className="biography-photo-preview">
                      <img className="editor-cover-image" src={concert.cover.image} alt="Selected cover image" />
                      <button
                        className="remove-button"
                        type="button"
                        onClick={() => {
                          updateCover('image', '')
                          setStatus('Cover image removed.')
                        }}
                      >
                        Remove image
                      </button>
                    </div>
                  )}
                  {concert.cover.image && (
                    <ImageLayoutFields
                      id="cover-image-layout"
                      layout={concert.cover.imageLayout}
                      alignments={coverAlignments}
                      onChange={(layout) => setCoverImageLayout(layout)}
                    />
                  )}
                  <label className="field-label" htmlFor="cover-image-description">
                    Image description <span className="label-note">for screen readers; leave blank if the image is decoration</span>
                  </label>
                  <input
                    id="cover-image-description"
                    name="coverImageDescription"
                    type="text"
                    value={concert.cover.imageDescription}
                    onChange={(event) => updateCover('imageDescription', event.target.value)}
                  />
                  <label className="field-label" htmlFor="cover-content">
                    Text <span className="label-note">Markdown or HTML, shown over the image</span>
                  </label>
                  <textarea
                    id="cover-content"
                    name="coverContent"
                    rows={4}
                    value={concert.cover.content}
                    onChange={(event) => updateCover('content', event.target.value)}
                  />
                  {hasCover && (
                    <label className="checkbox-field" htmlFor="cover-heading">
                      <input
                        id="cover-heading"
                        name="coverHeading"
                        type="checkbox"
                        checked={concert.cover.headingOnCover}
                        onChange={(event) => {
                          const headingOnCover = event.target.checked
                          setConcert((currentConcert) => ({ ...currentConcert, cover: { ...currentConcert.cover, headingOnCover } }))
                        }}
                      />
                      Concert heading on the cover <span className="label-note">below the image, instead of above the program</span>
                    </label>
                  )}
                </fieldset>
              </FormSection>

              <FormSection
                id="biographies"
                title="Biographies"
                summary={`${concert.biographies.length} ${concert.biographies.length === 1 ? 'entry' : 'entries'}`}
                open={openFormSections.biographies}
                onToggle={() => toggleFormSection('biographies')}
              >
                {concert.biographies.map((biography, index) => (
                  <fieldset className="form-group section-group" key={biography.id}>
                    <legend className="visually-hidden">Biography {index + 1}</legend>
                    <div className="section-title-row">
                      <span className="section-number">{String(index + 1).padStart(2, '0')}</span>
                      <label className="field-label" htmlFor={`biography-name-${biography.id}`}>Name</label>
                      <button
                        className="remove-button"
                        type="button"
                        aria-label={`Remove biography ${index + 1}`}
                        onClick={() => removeBiography(biography.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      id={`biography-name-${biography.id}`}
                      name={`biographyName-${biography.id}`}
                      type="text"
                      value={biography.name}
                      onChange={(event) => updateBiography(biography.id, 'name', event.target.value)}
                    />
                    <label className="field-label" htmlFor={`biography-text-${biography.id}`}>Biography</label>
                    <textarea
                      id={`biography-text-${biography.id}`}
                      name={`biographyText-${biography.id}`}
                      rows={4}
                      value={biography.bio}
                      onChange={(event) => updateBiography(biography.id, 'bio', event.target.value)}
                    />
                    <PageBreakField
                      id={`biography-page-break-${biography.id}`}
                      checked={biography.pageBreakBefore}
                      label="Start a new page before this biography"
                      onChange={(checked) => setConcert((current) => ({ ...current, biographies: withPageBreak(current.biographies, biography.id, checked) }))}
                    />
                    <label className="field-label" htmlFor={`biography-photo-${biography.id}`}>
                      Photograph <span className="label-note">optional, max 5 MB</span>
                    </label>
                    <input
                      id={`biography-photo-${biography.id}`}
                      name={`biographyPhoto-${biography.id}`}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(event) => void loadBiographyPhoto(biography.id, event)}
                    />
                    {biography.photo && (
                      <div className="biography-photo-preview">
                        <img
                          className="editor-biography-photo"
                          src={biography.photo}
                          alt={`Selected photograph of ${biography.name || `biography ${index + 1}`}`}
                        />
                        <button
                          className="remove-button"
                          type="button"
                          onClick={() => {
                            updateBiography(biography.id, 'photo', '')
                            setStatus('Biography photograph removed.')
                          }}
                        >
                          Remove photograph
                        </button>
                      </div>
                    )}
                    {biography.photo && (
                      <ImageLayoutFields
                        id={`biography-photo-${biography.id}-layout`}
                        layout={biography.photoLayout}
                        alignments={photoAlignments}
                        onChange={(layout) => setBiographyPhotoLayout(biography.id, layout)}
                      />
                    )}
                  </fieldset>
                ))}

                <button className="add-section-button" type="button" onClick={addBiography}>
                  <span aria-hidden="true">+</span> Add a biography
                </button>
              </FormSection>

              <FormSection
                id="program"
                title="Program"
                summary={`${concert.items.length} ${concert.items.length === 1 ? 'work' : 'works'}`}
                open={openFormSections.program}
                onToggle={() => toggleFormSection('program')}
              >
                {concert.items.map((item, index) => (
                  <fieldset className="form-group section-group" key={item.id}>
                    <legend className="visually-hidden">Program item {index + 1}</legend>
                    <div className="section-title-row">
                      <span className="section-number">{String(index + 1).padStart(2, '0')}</span>
                      <label className="field-label" htmlFor={`program-title-${item.id}`}>Title</label>
                      <button
                        className="remove-button"
                        type="button"
                        aria-label={`Remove program item ${index + 1}`}
                        onClick={() => removeProgramItem(item.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <textarea 
                      id={`program-title-${item.id}`}
                      name={`title-${item.id}`}
                      rows={4}
                      value={item.title}
                      onChange={(event) => updateProgramItem(item.id, 'title', event.target.value)}
                    />

                    <label className="field-label" htmlFor={`movements-${item.id}`}>
                      Movements <span className="label-note">one per line</span>
                    </label>
                    <textarea
                      id={`movements-${item.id}`}
                      name={`movements-${item.id}`}
                      rows={4}
                      value={item.movements}
                      onChange={(event) => updateProgramItem(item.id, 'movements', event.target.value)}
                    />

                    <label className="field-label" htmlFor={`composer-${item.id}`}>Composer</label>
                    <textarea 
                      id={`composer-${item.id}`}
                      name={`composer-${item.id}`}
                      rows={4}
                      value={item.composer}
                      onChange={(event) => updateProgramItem(item.id, 'composer', event.target.value)}
                    />

                    <label className="field-label" htmlFor={`featured-${item.id}`}>Featured Information</label>
                    <textarea
                      id={`featured-${item.id}`}
                      name={`featured-${item.id}`}
                      rows={4}
                      value={item.featured}
                      onChange={(event) => updateProgramItem(item.id, 'featured', event.target.value)}
                    />

                    {/* program-note-N belongs to the note's heading in the preview, which program titles link to */}
                    <label className="field-label" htmlFor={`program-note-text-${item.id}`}>Program Note</label>
                    <textarea
                      id={`program-note-text-${item.id}`}
                      name={`programNote-${item.id}`}
                      rows={4}
                      value={item.programNote}
                      onChange={(event) => updateProgramItem(item.id, 'programNote', event.target.value)}
                    />
                    <label className="field-label" htmlFor={`program-note-author-${item.id}`}>
                      Program Note Author <span className="label-note">optional</span>
                    </label>
                    <input
                      id={`program-note-author-${item.id}`}
                      name={`programNoteAuthor-${item.id}`}
                      type="text"
                      value={item.programNoteAuthor}
                      onChange={(event) => updateProgramItem(item.id, 'programNoteAuthor', event.target.value)}
                    />
                    <PageBreakField
                      id={`program-note-page-break-${item.id}`}
                      checked={item.pageBreakBefore}
                      label="Start a new page before this note"
                      onChange={(checked) => setConcert((current) => ({ ...current, items: withPageBreak(current.items, item.id, checked) }))}
                    />
                    <label className="field-label" htmlFor={`program-note-photo-${item.id}`}>
                      Photograph <span className="label-note">optional, max 5 MB</span>
                    </label>
                    <input
                      id={`program-note-photo-${item.id}`}
                      name={`programNotePhoto-${item.id}`}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(event) => void loadProgramNotePhoto(item.id, event)}
                    />
                    {item.photo && (
                      <div className="program-note-photo-preview">
                        <img
                          className="editor-program-note-photo"
                          src={item.photo}
                          alt={`Selected photograph of ${getTitleText(item.title) || 'program note'}`}

                        />
                        <button
                          className="remove-button"
                          type="button"
                          onClick={() => {
                            updateProgramItem(item.id, 'photo', '')
                            setStatus('Program note photograph removed.')
                          }}
                        >
                          Remove photograph
                        </button>
                      </div>)}
                    {item.photo && (
                      <ImageLayoutFields
                        id={`program-note-photo-${item.id}-layout`}
                        layout={item.photoLayout}
                        alignments={photoAlignments}
                        onChange={(layout) => setProgramNotePhotoLayout(item.id, layout)}
                      />
                    )}
                  </fieldset>
                ))}

                <button className="add-section-button" type="button" onClick={addProgramItem}>
                  <span aria-hidden="true">+</span> Add a program item
                </button>
              </FormSection>

              <FormSection
                id="ensemblePlayers"
                title="Ensemble Players"
                summary={`${concert.ensemblePlayers.length} ${concert.ensemblePlayers.length === 1 ? 'player' : 'players'}`}
                open={openFormSections.ensemblePlayers}
                onToggle={() => toggleFormSection('ensemblePlayers')}
              >
                <div className="form-group">
                  <PageBreakField
                    id="ensemble-players-page-break"
                    checked={concert.ensemblePlayersPageBreak}
                    label="Start the ensemble players on a new page"
                    onChange={(checked) => setConcert((current) => ({ ...current, ensemblePlayersPageBreak: checked }))}
                  />
                </div>
                <div className="list-actions">
                  <button className="add-section-button" type="button" onClick={addEnsemblePlayer}>
                    <span aria-hidden="true">+</span> Add an ensemble player
                  </button>
                  <button className="file-button" type="button" onClick={() => playersCsvInputRef.current?.click()}>
                    Load players from CSV…
                  </button>
                </div>
                {concert.ensemblePlayers.map((player, playerIndex) => (
                  <fieldset className="form-group section-group ensemble-player-group" key={player.id}>
                    <legend className="visually-hidden">Ensemble player {playerIndex + 1}</legend>
                    <div className="section-title-row">
                      <span className="section-number">{String(playerIndex + 1).padStart(2, '0')}</span>
                      <label className="field-label" htmlFor={`ensemble-player-name-${player.id}`}>Name</label>
                      <button
                        className="remove-button"
                        type="button"
                        aria-label={`Remove ensemble player ${playerIndex + 1}`}
                        onClick={() => removeEnsemblePlayer(player.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      id={`ensemble-player-name-${player.id}`}
                      name={`ensemblePlayerName-${player.id}`}
                      type="text"
                      value={player.name}
                      onChange={(event) => updateEnsemblePlayer(player.id, 'name', event.target.value)}
                    />
                    <label className="field-label" htmlFor={`player-section-${player.id}`}>Section</label>
                    <input
                      id={`player-section-${player.id}`}
                      name={`playerSection-${player.id}`}
                      type="text"
                      value={player.section}
                      onChange={(event) => updateEnsemblePlayer(player.id, 'section', event.target.value)}
                    />
                    <label className="field-label" htmlFor={`player-title-${player.id}`}>title</label>
                    <input
                      id={`player-title-${player.id}`}
                      name={`playerTitle-${player.id}`}
                      type="text"
                      value={player.title}
                      onChange={(event) => updateEnsemblePlayer(player.id, 'title', event.target.value)}
                    />
                    <label className="field-label" htmlFor={`player-ensemble-${player.id}`}>Ensemble</label>
                    <input
                      id={`player-ensemble-${player.id}`}
                      name={`playerEnsemble-${player.id}`}
                      type="text"
                      value={player.ensemble}
                      onChange={(event) => updateEnsemblePlayer(player.id, 'ensemble', event.target.value)}
                    />
                  </fieldset>
                ))}
              </FormSection>

              <FormSection
                id="extras"
                title="Extras"
                summary={`${concert.extras.length} ${concert.extras.length === 1 ? 'entry' : 'entries'}`}
                open={openFormSections.extras}
                onToggle={() => toggleFormSection('extras')}
              >
                {concert.extras.map((entry, index) => (
                  <fieldset className="form-group section-group extra-group" key={entry.id}>
                    <legend className="visually-hidden">Extra {index + 1}</legend>
                    <div className="section-title-row">
                      <span className="section-number">{String(index + 1).padStart(2, '0')}</span>
                      <label className="field-label" htmlFor={`extra-${entry.id}`}>Freeform markdown text</label>
                      <button
                        className="remove-button"
                        type="button"
                        aria-label={`Remove extra ${index + 1}`}
                        onClick={() => removeExtra(entry.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <textarea
                      id={`extra-${entry.id}`}
                      name={`extra-${entry.id}`}
                      rows={4}
                      value={entry.content}
                      onChange={(event) => updateExtra(entry.id, 'content', event.target.value)}
                    />
                    <PageBreakField
                      id={`extra-page-break-${entry.id}`}
                      checked={entry.pageBreakBefore}
                      label="Start a new page before this extra"
                      onChange={(checked) => setConcert((current) => ({ ...current, extras: withPageBreak(current.extras, entry.id, checked) }))}
                    />
                    <label className="field-label" htmlFor={`extra-image-${entry.id}`}>
                      Image <span className="label-note">optional, max 5 MB</span>
                    </label>
                    <input
                      id={`extra-image-${entry.id}`}
                      name={`extraImage-${entry.id}`}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={(event) => void loadExtraImage(entry.id, event)}
                    />
                    {entry.image && (
                      <>
                        <div className="biography-photo-preview">
                          <img className="editor-biography-photo" src={entry.image} alt={`Selected image for extra ${index + 1}`} />
                          <button
                            className="remove-button"
                            type="button"
                            onClick={() => {
                              updateExtra(entry.id, 'image', '')
                              setStatus('Extra image removed.')
                            }}
                          >
                            Remove image
                          </button>
                        </div>
                        <ImageLayoutFields
                          id={`extra-image-${entry.id}-layout`}
                          layout={entry.imageLayout}
                          alignments={photoAlignments}
                          onChange={(layout) => setExtraImageLayout(entry.id, layout)}
                        />
                        <label className="field-label" htmlFor={`extra-image-description-${entry.id}`}>
                          Image description <span className="label-note">for screen readers; leave blank if the image is decoration</span>
                        </label>
                        <input
                          id={`extra-image-description-${entry.id}`}
                          name={`extraImageDescription-${entry.id}`}
                          type="text"
                          value={entry.imageDescription}
                          onChange={(event) => updateExtra(entry.id, 'imageDescription', event.target.value)}
                        />
                      </>
                    )}
                    <label className="field-label" htmlFor={`extra-class-${entry.id}`}>Rule below</label>
                    <select
                      id={`extra-class-${entry.id}`}
                      name={`extraClass-${entry.id}`}
                      value={entry.class}
                      onChange={(event) => updateExtra(entry.id, 'class', event.target.value)}
                    >
                      {addendumClasses.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                      {/* Keep a class from a loaded file that isn't one of the choices */}
                      {!addendumClasses.some(([value]) => value === entry.class) && (
                        <option value={entry.class}>Other: {entry.class}</option>
                      )}
                    </select>
                  </fieldset>
                ))}

                <button className="add-section-button" type="button" onClick={addExtra}>
                  <span aria-hidden="true">+</span> Add an extra
                </button>
              </FormSection>

              <FormSection
                id="acknowledgementNames"
                title="Acknowledgements"
                summary={`${concert.acknowledgementNames.length} ${concert.acknowledgementNames.length === 1 ? 'acknowledgement' : 'acknowledgements'}`}
                open={openFormSections.acknowledgementNames}
                onToggle={() => toggleFormSection('acknowledgementNames')}
              >
                <div className="form-group">
                  <label className="checkbox-field" htmlFor="print-acknowledgements">
                    <input
                      id="print-acknowledgements"
                      name="printAcknowledgements"
                      type="checkbox"
                      checked={concert.printAcknowledgements}
                      onChange={(event) => setConcert((current) => ({ ...current, printAcknowledgements: event.target.checked }))}
                    />
                    {/* One run of text, so the note wraps after the label rather than beside it */}
                    <span>
                      Include the acknowledgements in print <span className="label-note">always on the web page</span>
                    </span>
                  </label>
                  <PageBreakField
                    id="acknowledgements-page-break"
                    checked={concert.acknowledgementsPageBreak}
                    disabled={!concert.printAcknowledgements}
                    label="Start the acknowledgements on a new page"
                    onChange={(checked) => setConcert((current) => ({ ...current, acknowledgementsPageBreak: checked }))}
                  />
                </div>
                <div className="list-actions">
                  <button className="add-section-button" type="button" onClick={addAcknowledgement}>
                    <span aria-hidden="true">+</span> Add an acknowledgement
                  </button>
                  <button className="file-button" type="button" onClick={() => acknowledgementsCsvInputRef.current?.click()}>
                    Load acknowledgements from CSV…
                  </button>
                </div>
                {concert.acknowledgementNames.map((acknowledgement, ackIndex) => (
                  <fieldset className="form-group section-group acknowledgement-group" key={acknowledgement.id}>
                    <legend className="visually-hidden">Acknowledgement {ackIndex + 1}</legend>
                    <div className="section-title-row">
                      <span className="section-number">{String(ackIndex + 1).padStart(2, '0')}</span>
                      <label className="field-label" htmlFor={`acknowledgement-name-${acknowledgement.id}`}>Name</label>
                      <button
                        className="remove-button"
                        type="button"
                        aria-label={`Remove acknowledgement ${ackIndex + 1}`}
                        onClick={() => removeAcknowledgement(acknowledgement.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      id={`acknowledgement-name-${acknowledgement.id}`}
                      name={`acknowledgementName-${acknowledgement.id}`}
                      type="text"
                      value={acknowledgement.name}
                      onChange={(event) => updateAcknowledgement(acknowledgement.id, 'name', event.target.value)}
                    />
                    <label className="field-label" htmlFor={`acknowledgement-role-${acknowledgement.id}`}>
                      Role <span className="label-note">optional</span>
                    </label>
                    <input
                      id={`acknowledgement-role-${acknowledgement.id}`}
                      name={`acknowledgementRole-${acknowledgement.id}`}
                      type="text"
                      value={acknowledgement.role}
                      onChange={(event) => updateAcknowledgement(acknowledgement.id, 'role', event.target.value)}
                    />
                  </fieldset>
                ))}
              </FormSection>

              <FormSection
                id="colors"
                title="Colors"
                summary={colorsAreDefault ? 'Default' : 'Custom'}
                open={openFormSections.colors}
                onToggle={() => toggleFormSection('colors')}
              >
                <fieldset className="form-group color-group">
                  <legend className="visually-hidden">Program colors</legend>
                  {([
                    ['text', 'Text', 'body text and the dotted lines in the program', 'Text needs'],
                    ['heading', 'Headings', 'titles, headings and links', 'Headings need'],
                    ['accent', 'Accent', 'main rules between sections', ''],
                    ['line', 'Rules', 'thin lines between entries', ''],
                  ] as const).map(([name, label, note, needs]) => {
                    const contrast = contrastWithWhite(concert.colors[name])
                    const lowContrast = needs !== '' && contrast < 4.5
                    return (
                      <div className="color-field" key={name}>
                        <label className="field-label" htmlFor={`color-${name}`}>
                          {label} {note && <span className="label-note">{note}</span>}
                        </label>
                        <div className="color-control">
                          <input
                            id={`color-${name}`}
                            name={`color-${name}`}
                            type="color"
                            value={concert.colors[name]}
                            aria-describedby={lowContrast ? `color-${name}-contrast` : undefined}
                            onChange={(event) => updateColor(name, event.target.value)}
                          />
                          <span className="color-value" aria-hidden="true">{concert.colors[name]}</span>
                        </div>
                        {lowContrast && (
                          <p className="color-warning" id={`color-${name}-contrast`}>
                            {/* Rounded down, so 4.49 never reads as 4.5 */}
                            Contrast with the white page is {(Math.floor(contrast * 10) / 10).toFixed(1)}:1.{' '}
                            {needs} at least 4.5:1 to be easy to read.
                          </p>
                        )}
                      </div>
                    )
                  })}
                  <button className="remove-button color-reset" type="button" onClick={resetColors}>
                    Reset to default colors
                  </button>
                </fieldset>
              </FormSection>
            </form>
          </div>
          <p className="editor-status" role="status">{status}</p>
        </aside>

        <section className="preview-panel" aria-labelledby="preview-label" tabIndex={0}>
          <div className="preview-toolbar">
            <div>
              <p className="eyebrow" id="preview-label">CONCERT PROGRAM</p>
              <p className="preview-description">Screen + print · US Half-Letter</p>
            </div>
            <span className="page-size">5.5 × 8.5 in</span>
          </div>

          <article ref={documentPreviewRef} className="document-paper" style={documentColors} aria-label="Formatted document preview">
            {/* Class names here avoid words that reader modes treat as page
                chrome (header, extra, meta, author, ...), which they drop */}
            {hasCover && (
              <section className={`document-cover${headingOnCover ? ' has-heading' : ''}`}>
                {/* The image and its text, in whatever height the heading leaves */}
                <div className="document-cover-art">
                  {concert.cover.image && (
                    <CoverImage src={concert.cover.image} alt={concert.cover.imageDescription.trim()} layout={concert.cover.imageLayout} />
                  )}
                  {coverContent && <div className="document-cover-content" dangerouslySetInnerHTML={{ __html: coverContent }} />}
                </div>
                {headingOnCover && documentHeading}
              </section>
            )}

            {!headingOnCover && documentHeading}

            <h2 className="visually-hidden">Program</h2>
            {/* role="list": Safari stops announcing lists styled without bullets */}
            <ol className="program-list" role="list">
              {concert.items.map((item) => {
                const programNote = item.programNote
                const composerLines = item.composer.split('\n').map((line) => line.trim()).filter(Boolean)
                const movements = item.movements.trim() ? renderMovements(item.movements) : ''
                const featured = typeof item.featured === 'string' ? renderMarkdown(item.featured) : ''
                if (!item.title && !movements && !item.composer && !programNote && !featured.length) return null
                const title = renderTitle(item.title, Boolean(item.composer))
                return (
                  <li className="program-item" key={item.id} aria-labelledby={`program-item-title-${item.id}`}>
                    {/* A header rather than a div: reader modes drop divs that
                        are mostly link text, which a linked title is */}
                    <header className={`program-item-heading${item.composer ? ' has-composer' : ''}`}>
                      <h3 id={`program-item-title-${item.id}`}>
                        {programNote ? (
                          <a className="program-note-link" href={`#program-note-${item.id}`}>{title}</a>
                        ) : title}
                      </h3>
                      {item.composer && (
                        <p className="composer-line">
                          {composerLines.map((line, index) => (
                            <Fragment key={index}>
                              {index > 0 && ' '}
                              {/* The inner span's background hides the leader's dots behind the text */}
                              <span><span>{line}</span></span>
                            </Fragment>
                          ))}
                        </p>
                      )}
                    </header>
                    {featured && (
                      <div className="featured-line" dangerouslySetInnerHTML={{ __html: featured }} />
                    )}
                    {movements && (
                      <div className="program-movements" dangerouslySetInnerHTML={{ __html: movements }} />
                    )}
                  </li>
                )
              })}
            </ol>

            {concert.biographies.some((biography) => biography.name || biography.bio || biography.photo) && (
              <section className={`biographies-page${sectionPageBreak(firstBiography)}`}>
                {concert.biographies.map((biography) => {
                  if (!biography.name && !biography.bio && !biography.photo) return null
                  const parsedMarkdown = renderMarkdown(biography.bio)
                  return (
                    <article className={`document-biography${biography.photo ? ' has-photo' : ''}${entryPageBreak(biography, firstBiography)}`} key={biography.id}>
                      {biography.photo && (
                        <DocumentPhoto
                          className="document-biography-photo"
                          src={biography.photo}
                          alt={`Photograph of ${biography.name || 'biography subject'}`}
                          layout={biography.photoLayout}
                        />
                      )}
                        <h2>{biography.name || 'Biography'}</h2>
                        {biography.bio && (
                          <div className="document-biography-bio" dangerouslySetInnerHTML={{ __html: parsedMarkdown }} />
                        )}
                    </article>
                  )
                })}
              </section>
            )}

            {concert.items.some((item) => item.programNote) && (
              <section className={`program-notes-page${sectionPageBreak(firstProgramNote)}`} aria-labelledby="program-notes-heading">
                <h2 id="program-notes-heading">Program Notes</h2>
                {concert.items.map((item) => {
                  const parsedMarkdown = renderMarkdown(item.programNote)
                  if (!parsedMarkdown) return null

                  return (
                    <article className={`program-note-entry${item.photo ? ' has-photo' : ''}${entryPageBreak(item, firstProgramNote)}`} key={item.id}>
                      {item.photo && (
                        <DocumentPhoto
                          className="program-note-photo"
                          src={item.photo}
                          alt={`Image representing ${getTitleText(item.title) || 'program note'}`}
                          hidden
                          layout={item.photoLayout}
                        />
                      )}
                      <div className="program-note-entry-copy">
                        <h3 id={`program-note-${item.id}`}>{renderTitle(item.title)}</h3>
                        {item.composer && <p className="program-note-composer">{item.composer}</p>}
                        {parsedMarkdown && (
                          <div className="program-note" dangerouslySetInnerHTML={{ __html: parsedMarkdown }} />
                        )}
                        {item.programNoteAuthor && (
                          <p className="program-note-credit" dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(item.programNoteAuthor) }} />
                        )}
                      </div>
                    </article>
                  )
                })}
              </section>
            )}

            {ensemblePlayerEnsembles.length > 0 && (
              <section className={`ensemble-players${concert.ensemblePlayersPageBreak ? ' page-break-before' : ''}`}>
                {ensemblePlayerEnsembles.map((ensemble, ensembleIndex) => (
                  <article aria-labelledby={`ensemble-players-heading-${ensembleIndex}`} key={ensemble.name.toLocaleLowerCase()}>
                    {/* With no ensemble name there's no heading to see, so it takes no
                        space; screen readers still get one, so the sections below
                        aren't read as part of the section before */}
                    {ensembleHeading(ensemble.name, concert.ensembleName) ? (
                      <h2 id={`ensemble-players-heading-${ensembleIndex}`}>{ensembleHeading(ensemble.name, concert.ensembleName)}</h2>
                    ) : (
                      <h2 id={`ensemble-players-heading-${ensembleIndex}`} className="visually-hidden">Players</h2>
                    )}
                    {ensemble.entries.length > 0 && (
                      <div className="ensemble-player-columns">
                        {ensemble.entries.map((section) => (
                          <section className="ensemble-player-section" key={section.name.toLocaleLowerCase()}>
                            <h3>{section.name}</h3>
                            <ul role="list">
                              {section.entries.map((entry) => (
                                <li key={entry.id}>
                                  <span className="ensemble-player-name">{entry.name}</span>
                                  {' '}
                                  <span className="ensemble-player-title">{entry.title}</span>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </section>
            )}

            {concert.extras.some((entry) => entry.content.trim() || entry.image) && (
              <section className={`document-addenda${sectionPageBreak(firstExtra)}`}>
                {concert.extras.map((entry) => {
                  const parsedMarkdown = renderMarkdown(entry.content)
                  if (!parsedMarkdown && !entry.image) return null
                  const classes = [entry.class.trim(), entry.image && 'has-photo', entryPageBreak(entry, firstExtra).trim()].filter(Boolean).join(' ')
                  return (
                    <article key={entry.id} className={classes || undefined}>
                      {entry.image && (
                        <DocumentPhoto
                          className="addendum-photo"
                          src={entry.image}
                          alt={entry.imageDescription.trim()}
                          layout={entry.imageLayout}
                        />
                      )}
                      {parsedMarkdown && <div className="addendum-content" dangerouslySetInnerHTML={{ __html: parsedMarkdown }} />}
                    </article>
                  )
                })}
              </section>
            )}

            {acknowledgements.length > 0 && (
              <section className={`acknowledgements${concert.acknowledgementsPageBreak ? ' page-break-before' : ''}${concert.printAcknowledgements ? '' : ' do-not-print'}`} aria-labelledby="acknowledgements-heading">
                <article>
                  <h2 id="acknowledgements-heading">Acknowledgements</h2>
                  <ul className="acknowledgement-columns" role="list">
                    {acknowledgements.map((acknowledgement) => (
                      <li key={acknowledgement.id}>
                        <span className="acknowledgement-name">{acknowledgement.name}</span>
                        {acknowledgement.role && (
                          <>
                            {' '}
                            <span className="acknowledgement-role">{acknowledgement.role}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </article>
              </section>
            )}
          </article>
        </section>
      </main>

      {/* The CSV file inputs, opened by their buttons in the editor, and the
          dialog, which has a form of its own: all outside the editor's form */}
      {([['ensemblePlayers', playersCsvInputRef], ['acknowledgementNames', acknowledgementsCsvInputRef]] as const).map(([list, ref]) => (
        <input
          key={list}
          ref={ref}
          className="visually-hidden"
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => void loadListCsv(list, event)}
        />
      ))}
      {pendingCsv && (
        <dialog
          ref={csvDialogRef}
          className="csv-dialog"
          aria-labelledby="csv-dialog-title"
          aria-describedby="csv-dialog-description"
          onClose={(event) => finishCsvDialog(event.currentTarget.returnValue)}
        >
          <h2 id="csv-dialog-title">
            Load {pendingCsv.list === 'ensemblePlayers' ? countOf(pendingCsv.rows.length, 'player') : countOf(pendingCsv.rows.length, 'acknowledgement')} from {pendingCsv.filename}?
          </h2>
          <p id="csv-dialog-description">
            The list already has{' '}
            {pendingCsv.list === 'ensemblePlayers' ? countOf(concert.ensemblePlayers.length, 'player') : countOf(concert.acknowledgementNames.length, 'acknowledgement')}.
            Replace them with the ones from the file, or add the file's to the end?
          </p>
          <form method="dialog" className="csv-dialog-actions">
            <button className="print-button" value="replace">Replace the list</button>
            <button className="file-button" value="append">Add to the end</button>
            <button className="remove-button" value="cancel" ref={csvCancelRef}>Cancel</button>
          </form>
        </dialog>
      )}
    </div>
  )
}

export default App
