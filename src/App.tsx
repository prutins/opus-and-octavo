import { type ChangeEvent, Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { marked} from 'marked'
import './App.css'
import { createPrintPageTitleRule, createStaticWebPage } from './webExport.ts'
const markedParseOptions = { gfm: true, breaks: true }

type ProgramItem = {
  id: number
  title: string
  movements: string
  composer: string
  featured: string
  programNote: string
  programNoteAuthor: string
  photo: string
}

type ConductorBiography = {
  id: number
  name: string
  bio: string
  photo: string
}

type EnsemblePlayer = {
  id: number
  name: string
  section: string
  title: string
  ensemble: string
}

type ConcertData = {
  ensembleName: string
  concertTitle: string
  date: string
  location: string
  conductor: string
  biographies: ConductorBiography[]
  ensemblePlayers: EnsemblePlayer[]
  extras: { id: number; name: string }[]
  items: ProgramItem[]
}

type SavedConcert = {
  format: 'opus-and-octavo-concert'
  version: 1
  concert: Omit<ConcertData, 'items' | 'biographies' | 'ensemblePlayers' | 'extras'> & {
    biographies: Omit<ConductorBiography, 'id'>[]
    ensemblePlayers: {
      name: string
      section: string
      title: string
      ensemble: string
    }[]
    extras: string[]
    items: Omit<ProgramItem, 'id'>[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBiographyPhotoDataUrl(value: string) {
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

  const extraData = data.extras === undefined ? [] : data.extras
  if (!Array.isArray(extraData) || !extraData.every((name) => typeof name === 'string')) {
    return null
  }

  const biographies: ConductorBiography[] = []
  for (const [index, biography] of biographyData.entries()) {
    if (
      !isRecord(biography) ||
      (biography.name !== undefined && typeof biography.name !== 'string') ||
      (biography.bio !== undefined && typeof biography.bio !== 'string') ||
      (biography.photo !== undefined && (typeof biography.photo !== 'string' || !isBiographyPhotoDataUrl(biography.photo)))
    ) {
      return null
    }

    biographies.push({
      id: index + 1,
      name: typeof biography.name === 'string' ? biography.name : '',
      bio: typeof biography.bio === 'string' ? biography.bio : '',
      photo: typeof biography.photo === 'string' ? biography.photo : '',
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
      (item.photo !== undefined && typeof item.photo !== 'string')
    ) {
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
    })
  }

  return {
    ensembleName: typeof data.ensembleName === 'string' ? data.ensembleName : '',
    concertTitle: data.concertTitle,
    date: data.date,
    location: data.location,
    conductor: data.conductor,
    biographies,
    ensemblePlayers,
    extras: extraData.map((name, index) => ({ id: index + 1, name })),
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
  biographies: [
    {
      id: 1,
      name: 'Louis Calabro, Conductor',
      bio: 'Louis Calabro is a composer, conductor, and percussionist who has taught music at Bennington College since 1955. He studied piano and composition at the Juilliard School of Music, where his principal teacher was Vincent Persichetti. With his wife, Christine Graham, he founded the Sage City Symphony, a community orchestra in southwestern Vermont that commissions and performs new works alongside the standard repertoire.',
      photo: '',
    },
  ],
  ensemblePlayers: [
    { id: 1, name: 'Theodora Wilcoxen', section: 'Percussion', title: '', ensemble: '' },
  ],
  extras: [
    {
      id: 1,
      name: '## About the Orchestra\n\nRead about the Sage City Symphony’s fiftieth anniversary in the Bennington Banner: [Sage City Symphony to celebrate 50th anniversary](https://www.benningtonbanner.com/arts-and-culture/sage-city-symphony-to-celebrate-50th-anniversary/2994848) (May 8, 2023).',
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
  'contrabassoon',
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

const orchestralTitleOrder = [
  'concert master',
  'concertmaster',
  'concert mistress',
  'concertmistress',
  'concert master *',
  'concertmaster *',
  'concert mistress *',
  'concertmistress *',
  'concert master +',
  'concertmaster +',
  'concertmistress +',
  'concert mistress +',
  'concert master *+',
  'concertmaster *+',
  'concert mistress *+',
  'concertmistress *+',
  'asst. concert master',
  'asst. concertmaster',
  'assistant concert master',
  'asst. concert mistress',
  'asst. concertmistress',
  'assistant concert mistress',
  'principal',
  'principal*',
  'principal *',
  'principal*+',
  'principal *+'
]
  
function getOrchestralTitleOrder(title: string) {
  const lowerTitle = title.trim().toLocaleLowerCase()
  const order = orchestralTitleOrder.indexOf(lowerTitle)
  return order === -1 ? orchestralTitleOrder.length : order
}

function getEnsemblePlayerSections(players: EnsemblePlayer[]): Ensemble[] { //PlayerSection[] {
  const assignments = players.flatMap((player) => {
      const section = player.section.trim()
      const title = player.title.trim()
      const name = player.name.trim()
      const ensemble = player.ensemble.trim()
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

    const titleOrderDifference = getOrchestralTitleOrder(first.title) - getOrchestralTitleOrder(second.title)
    if (titleOrderDifference !== 0) return titleOrderDifference

    const titleNameDifference = first.title.localeCompare(second.title, undefined, { sensitivity: 'base' })
    if (titleNameDifference !== 0) return titleNameDifference

    /* if all else is equal, sort by last name, then first name */
    const firstNameParts = first.name.trim().split(/\s+/)
    const secondNameParts = second.name.trim().split(/\s+/)
    return firstNameParts[firstNameParts.length - 1].localeCompare(secondNameParts[secondNameParts.length - 1], undefined, { sensitivity: 'base' })
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

function getPrintTitle(concert: Pick<ConcertData, 'ensembleName' | 'concertTitle'>) {
  return concert.ensembleName.trim() || concert.concertTitle.trim() || 'Untitled concert'
}

type FormSectionId = 'details' | 'biographies' | 'program' | 'ensemblePlayers' | 'extras'

const defaultOpenFormSections: Record<FormSectionId, boolean> = {
  details: true,
  biographies: false,
  program: false,
  ensemblePlayers: false,
  extras: false,
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

function App() {
  const [concert, setConcert] = useState(initialConcert)
  const [nextItemId, setNextItemId] = useState(initialConcert.items.length + 1)
  const [nextBiographyId, setNextBiographyId] = useState(initialConcert.biographies.length + 1)
  const [nextExtraId, setNextExtraId] = useState(initialConcert.extras.length + 1)
  const [nextEnsemblePlayerId, setNextEnsemblePlayerId] = useState(initialConcert.ensemblePlayers.length + 1)
  const [status, setStatus] = useState('Preview updates as you type.')
  const [openFormSections, setOpenFormSections] = useState(defaultOpenFormSections)
  const [editorCollapsed, setEditorCollapsed] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const documentPreviewRef = useRef<HTMLElement>(null)
  const topbarRef = useRef<HTMLElement>(null)
  const [saveMenuOpen, setSaveMenuOpen] = useState(false)
  const saveMenuRef = useRef<HTMLDivElement>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const printTitle = getPrintTitle(concert)
  const ensemblePlayerEnsembles = getEnsemblePlayerSections(concert.ensemblePlayers)

  useEffect(() => {
    document.title = concert.ensembleName.trim() || 'Opus & Octavo — Concert program builder'
  }, [concert.ensembleName])

  // The top bar's height varies as its buttons wrap; scroll-padding-top in
  // App.css uses it to keep scrolled-to and focused content clear of the bar
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
    printTitleStyle.textContent = createPrintPageTitleRule(printTitle)
    document.head.append(printTitleStyle)

    return () => printTitleStyle.remove()
  }, [printTitle])

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

  function downloadFile(contents: string, type: string, filename: string) {
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
        biographies: concert.biographies.map(({ name, bio, photo }) => ({ name, bio, photo })),
        ensemblePlayers: concert.ensemblePlayers.map(({ section, name, title, ensemble }) => ({
          section,
          name,
          title,
          ensemble,
        })),
        extras: concert.extras.map(({ name }) => name),
        items: concert.items.map(({ title, movements, composer, featured, programNote, programNoteAuthor, photo }) => ({
          title,
          movements,
          composer,
          featured,
          programNote,
          programNoteAuthor,
          photo,
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

  function saveWebFile() {
    const preview = documentPreviewRef.current
    if (!preview) return

    // In the app the document sits under the editor's h1 and is labelled as a
    // preview; as a page of its own its title is the h1 and it needs no label
    const exported = preview.cloneNode(true) as HTMLElement
    exported.removeAttribute('aria-label')
    const title = exported.querySelector('.document-title')
    if (title) {
      const heading = document.createElement('h1')
      heading.className = title.className
      heading.append(...title.childNodes)
      title.replaceWith(heading)
    }

    const filename = getConcertFilename(concert.concertTitle)
    const html = createStaticWebPage(
      getPrintTitle(concert),
      exported.outerHTML,
      getPrintTitle(concert),
    )
    downloadFile(html, 'text/html', `${filename}.html`)
    setStatus(`Downloaded ${filename}.html for web.`)
  }

  function addProgramItem() {
    const id = nextItemId
    setNextItemId((currentId) => currentId + 1)
    setConcert((currentConcert) => ({
      ...currentConcert,
      items: [
        ...currentConcert.items,
        { id, title: '', movements: '', composer: '', featured: '', programNote: '', programNoteAuthor: '', photo: '' },
      ],
    }))
    setStatus('Program item added.')
  }

  function addBiography() {
    const id = nextBiographyId
    setNextBiographyId((currentId) => currentId + 1)
    setConcert((currentConcert) => ({
      ...currentConcert,
      biographies: [...currentConcert.biographies, { id, name: '', bio: '', photo: '' }],
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
      setStatus('Biography photographs must be 5 MB or smaller.')
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
    setConcert((currentConcert) => ({
      ...currentConcert,
      ensemblePlayers: [...currentConcert.ensemblePlayers, { id, name: '', section: '', title: '', ensemble: '' }],
    }))
    setStatus('Ensemble player added.')
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
  
  function addExtra() {
    const id = nextExtraId
    setNextExtraId((currentId) => currentId + 1)
    setConcert((currentConcert) => ({
      ...currentConcert,
      extras: [...currentConcert.extras, { id, name: '' }],
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

  function updateExtra(id: number, name: string) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      extras: currentConcert.extras.map((entry) =>
        entry.id === id ? { ...entry, name } : entry,
      ),
    }))
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
            </div>
          </div>
          <button className="file-button" type="button" onClick={saveWebFile}>
            Save for Web
          </button>
          <button className="print-button" type="button" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </header>

      <main className={editorCollapsed ? 'workspace editor-collapsed' : 'workspace'} id="main-content">
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
            <div className="editor-heading">
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

                    <label className="field-label" htmlFor={`program-note-${item.id}`}>Program Note</label>
                    <textarea
                      id={`program-note-${item.id}`}
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
                          alt={`Selected photograph of ${item.title || 'program note'}`}

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

                <button className="add-section-button" type="button" onClick={addEnsemblePlayer}>
                  <span aria-hidden="true">+</span> Add an ensemble player
                </button>
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
                      value={entry.name}
                      onChange={(event) => updateExtra(entry.id, event.target.value)}
                    />
                  </fieldset>
                ))}

                <button className="add-section-button" type="button" onClick={addExtra}>
                  <span aria-hidden="true">+</span> Add an extra
                </button>
              </FormSection>
            </form>
          </div>
          <p className="editor-status" role="status">{status}</p>
        </aside>

        <section className="preview-panel" aria-labelledby="preview-label">
          <div className="preview-toolbar">
            <div>
              <p className="eyebrow" id="preview-label">CONCERT PROGRAM</p>
              <p className="preview-description">Screen + print · US Half-Letter</p>
            </div>
            <span className="page-size">5.5 × 8.5 in</span>
          </div>

          <article ref={documentPreviewRef} className="document-paper" aria-label="Formatted document preview">
            {/* Class names here avoid words that reader modes treat as page
                chrome (header, extra, meta, author, ...), which they drop */}
            <header className="document-heading">
              <h2 className="document-title">{concert.concertTitle || 'Untitled concert'}</h2>
              {concert.conductor && (
                  <p className="document-conductor">
                    {concert.conductor}, conducting
                  </p>
                )}

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

            <h2 className="visually-hidden">Program</h2>
            <ol className="program-list">
              {concert.items.map((item) => {
                const titleLines = item.title.split('\n').map((line) => line.trim()).filter(Boolean)
                const programNote = item.programNote
                const composerLines = item.composer.split('\n').map((line) => line.trim()).filter(Boolean)
                const movements = item.movements.split('\n').map((movement) => movement.trim()).filter(Boolean)
                const featured = typeof item.featured === 'string' ? marked.parse(item.featured, markedParseOptions).toString() : ''
                if (!item.title && !movements.length && !item.composer && !programNote && !featured.length) return null
                // The word joiner keeps the leader on the same line as the title's final word
                const leader = item.composer && <>{'⁠'}<span className="program-leader" aria-hidden="true" /></>
                return (
                  <li className="program-item" key={item.id} aria-labelledby={`program-item-title-${item.id}`}>
                    {/* A header rather than a div: reader modes drop divs that
                        are mostly link text, which a linked title is */}
                    <header className={`program-item-heading${item.composer ? ' has-composer' : ''}`}>
                      <h3 id={`program-item-title-${item.id}`}>
                        {programNote ? (
                          <a className="program-note-link" href={`#program-note-${item.id}`}>
                            {titleLines.length > 0 ? titleLines.map((line, index) => (
                              <Fragment key={index}>
                                {index > 0 && ' '}
                                <span>{line}{index === titleLines.length - 1 && leader}</span>
                              </Fragment>
                            )) : <>Untitled work{leader}</>}
                          </a>
                        ) : (
                          <>{item.title || 'Untitled work'}{leader}</>
                        )}
                      </h3>
                      {item.composer && (
                        <p className="composer-line">
                          {composerLines.map((line, index) => (
                            <Fragment key={index}>
                              {index > 0 && ' '}
                              <span>{line}</span>
                            </Fragment>
                          ))}
                        </p>
                      )}
                    </header>
                    {featured && (
                      <div className="featured-line" dangerouslySetInnerHTML={{ __html: featured }} />
                    )}
                    {movements.length > 0 && (
                      <ol className="program-movements">
                        {movements.map((movement, movementIndex) => (
                          <li key={`${item.id}-movement-${movementIndex}`}>{movement}</li>
                        ))}
                      </ol>
                    )}
                  </li>
                )
              })}
            </ol>

            {concert.biographies.some((biography) => biography.name || biography.bio || biography.photo) && (
              <section className="biographies-page">
                {concert.biographies.map((biography) => {
                  if (!biography.name && !biography.bio && !biography.photo) return null
                  const parsedMarkdown = marked.parse(biography.bio, markedParseOptions).toString()
                  return (
                    <article className={`document-biography${biography.photo ? ' has-photo' : ''}`} key={biography.id}>
                      {biography.photo && (
                        <img
                          className="document-biography-photo"
                          src={biography.photo}
                          alt={`Photograph of ${biography.name || 'biography subject'}`}
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
              <section className="program-notes-page" aria-labelledby="program-notes-heading">
                <h2 id="program-notes-heading">Program Notes</h2>
                {concert.items.map((item) => {
                  const parsedMarkdown = marked.parse(item.programNote, markedParseOptions).toString()
                  const titleLines = item.title.split('\n').map((line) => line.trim()).filter(Boolean)
                  if (!parsedMarkdown) return null

                  return (
                    <article className={`program-note-entry${item.photo ? ' has-photo' : ''}`} key={item.id}>
                      {item.photo && (
                        <img
                          className="program-note-photo"
                          src={item.photo}
                          alt={`Image representing ${item.title || 'program note'}`}
                          aria-hidden="true"
                        />
                      )}
                      <div className="program-note-entry-copy">
                        <h3 id={`program-note-${item.id}`}>{titleLines.length > 0 ? titleLines.map((line, index) => (
                          <Fragment key={index}>
                            {index > 0 && ' '}
                            <span>{line}</span>
                          </Fragment>
                        )) : 'Untitled work'}</h3>
                        {item.composer && <p className="program-note-composer">{item.composer}</p>}
                        {parsedMarkdown && (
                          <div className="program-note" dangerouslySetInnerHTML={{ __html: parsedMarkdown }} />
                        )}
                        {item.programNoteAuthor && (
                          <p className="program-note-credit">{item.programNoteAuthor}</p>
                        )}
                      </div>
                    </article>
                  )
                })}
              </section>
            )}

            {ensemblePlayerEnsembles.map((ensemble, ensembleIndex) => (
              <section
                className="ensemble-players"
                aria-labelledby={`ensemble-players-heading-${ensembleIndex}`}
                key={ensemble.name.toLocaleLowerCase()}
              >
                <h2 id={`ensemble-players-heading-${ensembleIndex}`}>{ensemble.name.charAt(0).toUpperCase() + ensemble.name.slice(1) || concert.ensembleName }</h2>
                {ensemble.entries.length > 0 && (
                  <div className="ensemble-player-columns">
                    {ensemble.entries.map((section) => (
                      <section className="ensemble-player-section" key={section.name.toLocaleLowerCase()}>
                        <h3>{section.name}</h3>
                        <ul>
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
              </section>
            ))}

            {concert.extras.some((entry) => entry.name.trim()) && (
              <section className="document-addenda">
                <ul>
                  {concert.extras.map((entry) => {
                    const parsedMarkdown = marked.parse(entry.name, markedParseOptions).toString()
                    return parsedMarkdown ? <li key={entry.id} dangerouslySetInnerHTML={{ __html: parsedMarkdown }} /> : null
                  })}
                </ul>
              </section>
            )}
          </article>
        </section>
      </main>
    </div>
  )
}

export default App
