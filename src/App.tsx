import { type ChangeEvent, useRef, useState } from 'react'
import './App.css'
import { createStaticWebPage } from './webExport.ts'

type ProgramItem = {
  id: number
  title: string
  movements: string
  composer: string
  featured: string
  programNote: string
}

type ConductorBiography = {
  id: number
  name: string
  bio: string
  photo: string
}

type ConcertData = {
  concertTitle: string
  date: string
  location: string
  conductor: string
  biographies: ConductorBiography[]
  acknowledgements: { id: number; name: string }[]
  items: ProgramItem[]
}

type SavedConcert = {
  format: 'form-and-folio-concert'
  version: 1
  concert: Omit<ConcertData, 'items' | 'biographies' | 'acknowledgements'> & {
    biographies: Omit<ConductorBiography, 'id'>[]
    acknowledgements: string[]
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

function parseSavedConcert(value: unknown): ConcertData | null {
  if (!isRecord(value) || value.format !== 'form-and-folio-concert' || value.version !== 1) {
    return null
  }

  const data = value.concert
  if (
    !isRecord(data) ||
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

  const acknowledgementData = data.acknowledgements === undefined ? [] : data.acknowledgements
  if (!Array.isArray(acknowledgementData) || !acknowledgementData.every((name) => typeof name === 'string')) {
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

  const items: ProgramItem[] = []
  for (const [index, item] of data.items.entries()) {
    if (
      !isRecord(item) ||
      typeof item.title !== 'string' ||
      (item.movements !== undefined && typeof item.movements !== 'string') ||
      typeof item.composer !== 'string' ||
      typeof item.featured !== 'string' ||
      typeof item.programNote !== 'string'
    ) {
      return null
    }

    items.push({
      id: index + 1,
      title: item.title,
      movements: typeof item.movements === 'string' ? item.movements : '',
      composer: item.composer,
      featured: item.featured,
      programNote: item.programNote,
    })
  }

  return {
    concertTitle: data.concertTitle,
    date: data.date,
    location: data.location,
    conductor: data.conductor,
    biographies,
    acknowledgements: acknowledgementData.map((name, index) => ({ id: index + 1, name })),
    items,
  }
}

const initialConcert: ConcertData = {
  concertTitle: 'An Evening of Symphonies',
  date: '2026-10-20',
  location: 'Riverside Concert Hall',
  conductor: 'Elena Marquez',
  biographies: [
    { id: 1, name: 'Elena Marquez', bio: 'Renowned conductor and composer.', photo: '' },
    { id: 2, name: '', bio: '', photo: '' },
  ],
  acknowledgements: [],
  items: [
    {
      id: 1,
      title: 'Symphony No. 7 in A major, Op. 92',
      movements: 'I. Poco sostenuto - Vivace\nII. Allegretto\nIII. Presto\nIV. Allegro con brio',
      composer: 'Ludwig van Beethoven',
      featured: '',
      programNote:
        'Driven by an unrelenting rhythmic energy, Beethoven called this symphony one of his finest works. Its dance-like momentum carries from the opening movement through the celebrated Allegretto.',
    },
    {
      id: 2,
      title: 'Violin Concerto in E minor, Op. 64',
      movements: 'I. Allegro molto appassionato\nII. Andante\nIII. Allegretto non troppo - Allegro molto vivace',
      composer: 'Felix Mendelssohn',
      featured: '',
      programNote:
        'Mendelssohn places the solo violin at the heart of the work from its first measure. The concerto is admired for its lyricism, clarity, and seamless dialogue between soloist and orchestra.',
    },
  ],
}

function getParagraphs(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
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

function App() {
  const [concert, setConcert] = useState(initialConcert)
  const [nextItemId, setNextItemId] = useState(3)
  const [nextBiographyId, setNextBiographyId] = useState(3)
  const [nextAcknowledgementId, setNextAcknowledgementId] = useState(1)
  const [status, setStatus] = useState('Preview updates as you type.')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const documentPreviewRef = useRef<HTMLElement>(null)

  async function loadConcertFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    try {
      const parsed = parseSavedConcert(JSON.parse(await file.text()) as unknown)
      if (!parsed) throw new Error('Invalid concert data')

      setConcert(parsed)
      setNextItemId(parsed.items.length + 1)
      setNextBiographyId(parsed.biographies.length + 1)
      setNextAcknowledgementId(parsed.acknowledgements.length + 1)
      setStatus(`Loaded ${file.name}.`)
    } catch {
      setStatus(`Could not load ${file.name}. Choose a valid Form & Folio JSON file.`)
    } finally {
      input.value = ''
    }
  }

  function saveConcertFile() {
    const savedConcert: SavedConcert = {
      format: 'form-and-folio-concert',
      version: 1,
      concert: {
        concertTitle: concert.concertTitle,
        date: concert.date,
        location: concert.location,
        conductor: concert.conductor,
        biographies: concert.biographies.map(({ name, bio, photo }) => ({ name, bio, photo })),
        acknowledgements: concert.acknowledgements.map(({ name }) => name),
        items: concert.items.map(({ title, movements, composer, featured, programNote }) => ({
          title,
          movements,
          composer,
          featured,
          programNote,
        })),
      },
    }
    const filename = getConcertFilename(concert.concertTitle)
    const blob = new Blob([JSON.stringify(savedConcert, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const download = document.createElement('a')
    download.href = url
    download.download = `${filename}.json`
    download.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setStatus(`Downloaded ${filename}.json.`)
  }

  function saveWebFile() {
    const preview = documentPreviewRef.current
    if (!preview) return

    const filename = getConcertFilename(concert.concertTitle)
    const html = createStaticWebPage(
      concert.concertTitle || 'Concert Program',
      preview.outerHTML,
    )
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const download = document.createElement('a')
    download.href = url
    download.download = `${filename}.html`
    download.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setStatus(`Downloaded ${filename}.html for web.`)
  }

  function addProgramItem() {
    const id = nextItemId
    setNextItemId((currentId) => currentId + 1)
    setConcert((currentConcert) => ({
      ...currentConcert,
      items: [
        ...currentConcert.items,
        { id, title: '', movements: '', composer: '', featured: '', programNote: '' },
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

  async function loadBiographyPhoto(id: number, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setStatus('Choose a PNG, JPEG, WebP, or GIF image.')
      input.value = ''
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setStatus('Biography photographs must be 5 MB or smaller.')
      input.value = ''
      return
    }

    try {
      updateBiography(id, 'photo', await readImageDataUrl(file))
      setStatus('Biography photograph added.')
    } catch {
      setStatus('Could not read that photograph.')
    } finally {
      input.value = ''
    }
  }

  function addAcknowledgement() {
    const id = nextAcknowledgementId
    setNextAcknowledgementId((currentId) => currentId + 1)
    setConcert((currentConcert) => ({
      ...currentConcert,
      acknowledgements: [...currentConcert.acknowledgements, { id, name: '' }],
    }))
    setStatus('Acknowledgement added.')
  }

  function removeAcknowledgement(id: number) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      acknowledgements: currentConcert.acknowledgements.filter((entry) => entry.id !== id),
    }))
    setStatus('Acknowledgement removed.')
  }

  function updateAcknowledgement(id: number, name: string) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      acknowledgements: currentConcert.acknowledgements.map((entry) =>
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
    field: 'title' | 'movements' | 'composer' | 'featured' | 'programNote',
    value: string,
  ) {
    setConcert((currentConcert) => ({
      ...currentConcert,
      items: currentConcert.items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    }))
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="Form and Folio home">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>FORM <span className="brand-amp">&</span> FOLIO</span>
        </a>
        <div className="topbar-actions">
          <span className="save-state"><span aria-hidden="true" /> Live preview</span>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            aria-hidden="true"
            tabIndex={-1}
            onChange={loadConcertFile}
          />
          <button className="file-button" type="button" onClick={() => fileInputRef.current?.click()}>
            Load JSON
          </button>
          <button className="file-button" type="button" onClick={saveConcertFile}>
            Save JSON
          </button>
          <button className="file-button" type="button" onClick={saveWebFile}>
            Save for Web
          </button>
          <button className="print-button" type="button" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </header>

      <main className="workspace" id="main-content">
        <aside className="editor-panel" aria-labelledby="editor-title">
          <div className="editor-heading">
            <p className="eyebrow">DOCUMENT BUILDER <span>01 / 01</span></p>
            <h1 id="editor-title">Shape your<br />document.</h1>
            <p className="editor-intro">Enter your content below. The accessible document updates alongside it.</p>
          </div>

          <form className="document-form" onSubmit={(event) => event.preventDefault()}>
            <fieldset className="form-group metadata-group">
              <legend>Concert details</legend>
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

            <div className="section-editor-heading">
              <h2>Biographies</h2>
              <span>{concert.biographies.length} {concert.biographies.length === 1 ? 'entry' : 'entries'}</span>
            </div>

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

            <div className="section-editor-heading">
              <h2>Program</h2>
              <span>{concert.items.length} {concert.items.length === 1 ? 'work' : 'works'}</span>
            </div>

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
                <input
                  id={`program-title-${item.id}`}
                  name={`title-${item.id}`}
                  type="text"
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
                <input
                  id={`composer-${item.id}`}
                  name={`composer-${item.id}`}
                  type="text"
                  value={item.composer}
                  onChange={(event) => updateProgramItem(item.id, 'composer', event.target.value)}
                />

                <label className="field-label" htmlFor={`featured-${item.id}`}>Featured</label>
                <input
                  id={`featured-${item.id}`}
                  name={`featured-${item.id}`}
                  type="text"
                  placeholder="Soloist or guest conductor"
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
              </fieldset>
            ))}

            <button className="add-section-button" type="button" onClick={addProgramItem}>
              <span aria-hidden="true">+</span> Add a program item
            </button>

            <div className="section-editor-heading">
              <h2>Acknowledgements</h2>
              <span>{concert.acknowledgements.length} {concert.acknowledgements.length === 1 ? 'entry' : 'entries'}</span>
            </div>

            {concert.acknowledgements.map((entry, index) => (
              <fieldset className="form-group section-group acknowledgement-group" key={entry.id}>
                <legend className="visually-hidden">Acknowledgement {index + 1}</legend>
                <div className="section-title-row">
                  <span className="section-number">{String(index + 1).padStart(2, '0')}</span>
                  <label className="field-label" htmlFor={`acknowledgement-${entry.id}`}>Person or company</label>
                  <button
                    className="remove-button"
                    type="button"
                    aria-label={`Remove acknowledgement ${index + 1}`}
                    onClick={() => removeAcknowledgement(entry.id)}
                  >
                    Remove
                  </button>
                </div>
                <input
                  id={`acknowledgement-${entry.id}`}
                  name={`acknowledgement-${entry.id}`}
                  type="text"
                  value={entry.name}
                  onChange={(event) => updateAcknowledgement(entry.id, event.target.value)}
                />
              </fieldset>
            ))}

            <button className="add-section-button" type="button" onClick={addAcknowledgement}>
              <span aria-hidden="true">+</span> Add an acknowledgement
            </button>
          </form>
          <p className="editor-status" role="status">{status}</p>
        </aside>

        <section className="preview-panel" aria-labelledby="preview-label">
          <div className="preview-toolbar">
            <div>
              <p className="eyebrow" id="preview-label">CONCERT PROGRAM</p>
              <p className="preview-description">Screen + print · US Letter</p>
            </div>
            <span className="page-size">8.5 × 11 in</span>
          </div>

          <article ref={documentPreviewRef} className="document-paper" aria-label="Formatted document preview">
            <header className="document-header">
              <h2 className="document-title">{concert.concertTitle || 'Untitled concert'}</h2>
              {concert.conductor && (
                  <h3 className="document-conductor">
                    {concert.conductor}, conducting
                  </h3>
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

            <ol className="program-list">
              {concert.items.map((item) => {
                const paragraphs = getParagraphs(item.programNote)
                const movements = item.movements.split('\n').map((movement) => movement.trim()).filter(Boolean)
                if (!item.title && !movements.length && !item.composer && !paragraphs.length && !item.featured) return null
                return (
                  <li className="program-item" key={item.id} aria-labelledby={`program-item-title-${item.id}`}>
                    <div className={`program-item-heading${item.composer ? ' has-composer' : ''}`}>
                      <h3 id={`program-item-title-${item.id}`}>
                        {paragraphs.length > 0 ? (
                          <a className="program-note-link" href={`#program-note-${item.id}`}>
                            {item.title || 'Untitled work'}
                          </a>
                        ) : (
                          item.title || 'Untitled work'
                        )}
                      </h3>
                      {item.composer && <span className="program-leader" aria-hidden="true" />}
                      {item.composer && (
                        <div className="program-item-meta">
                          <p className="composer-line">{item.composer}</p>
                        </div>
                      )}
                    </div>
                    {item.featured && <p className="featured-line">{item.featured}</p>}
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
              <section className="document-biographies" aria-labelledby="biographies-heading">
                <h3 id="biographies-heading">Biographies</h3>
                {concert.biographies.map((biography) => {
                  if (!biography.name && !biography.bio && !biography.photo) return null
                  return (
                    <article className={`document-biography${biography.photo ? ' has-photo' : ''}`} key={biography.id}>
                      {biography.photo && (
                        <img
                          className="document-biography-photo"
                          src={biography.photo}
                          alt={`Photograph of ${biography.name || 'biography subject'}`}
                        />
                      )}
                      <div className="document-biography-copy">
                        <h4>{biography.name || 'Biography'}</h4>
                        {biography.bio && <p>{biography.bio}</p>}
                      </div>
                    </article>
                  )
                })}
              </section>
            )}

            {concert.items.some((item) => getParagraphs(item.programNote).length > 0) && (
              <section className="program-notes-page" aria-labelledby="program-notes-heading">
                <h2 id="program-notes-heading">Program Notes</h2>
                {concert.items.map((item) => {
                  const paragraphs = getParagraphs(item.programNote)
                  if (!paragraphs.length) return null

                  return (
                    <article className="program-note-entry" key={item.id}>
                      <h3 id={`program-note-${item.id}`}>{item.title || 'Untitled work'}</h3>
                      {item.composer && <p className="program-note-composer">{item.composer}</p>}
                      {paragraphs.map((paragraph, paragraphIndex) => (
                        <p className="program-note" key={`${item.id}-paragraph-${paragraphIndex}`}>
                          {paragraph}
                        </p>
                      ))}
                    </article>
                  )
                })}
              </section>
            )}

            {concert.acknowledgements.some((entry) => entry.name.trim()) && (
              <section className="document-acknowledgements" aria-labelledby="acknowledgements-heading">
                <h3 id="acknowledgements-heading">Acknowledgements</h3>
                <ul>
                  {concert.acknowledgements.map((entry) => {
                    const name = entry.name.trim()
                    return name ? <li key={entry.id}>{name}</li> : null
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
