# CLAUDE.md

Opus & Octavo is a browser-only React + Vite app for building accessible,
print-ready concert programs. See README.md for what it does from a user's
point of view.

## Commands

```sh
npm run dev      # development server
npm run build    # tsc -b, then vite build into dist/
npm run lint     # oxlint
npm test         # Playwright browser tests (tests/), on a dev server at :4174
```

Run `npm run lint`, `npm run build` and `npm test` after a change; the deploy
workflow runs lint and build and stops on failure.

Tests use the anonymized sample in `public/` and fictional concerts in
`tests/fixtures/`; never point tests at files in `private/`, and keep fixture
names invented. Shared helpers (loading files, saving downloads, a check that
fails any test on console errors) are in `tests/helpers.ts`. Known bugs are
tests marked `test.fail()` with a comment; when you fix one, remove the marker.
Functional tests run at desktop width only; `layout` and `text-spacing` also
run at phone width.

## Privacy: this repo is public

The GitHub repo is public, and every push to `main` deploys `dist/` to GitHub
Pages (`.github/workflows/deploy.yml`). Everything in `public/` is published
with it.

- Real concert data (player names, source PDFs, working JSON/YAML) lives in
  `private/`, which `.gitignore` excludes. Never copy anything from `private/`
  into `src/`, `public/`, a commit, or a commit message.
- Samples in `public/` use fictional player names. Conductors, the music
  director, soloists, the Board, choir directors and donor thanks keep their
  real names on purpose (see the README's Sample Data section).
- The mapping from real to fictional player names is kept outside the repo.
  Don't bring it in.
- Before committing, check that no real player names are in the diff.
- Don't edit files in `private/` unless the user names the file.

## Layout

- `src/App.tsx`: almost the whole app — data types, file loading and
  validation, player ordering, the editor form, and the document preview.
- `src/webExport.ts`: builds the standalone HTML for **Save for Web**, inlining
  `App.css` and the Atkinson Hyperlegible Next fonts as data URLs. It's loaded
  only when Save for Web is used (`import()` in `saveWebFile`), which keeps
  those ~160 kB out of the main bundle, so don't import it statically.
- `src/printPageTitle.ts`: `createPrintPageTitleRule`, the printed page
  header, used by both the app and Save for Web.
- `src/booklet.ts`: **Booklet from PDF**, loaded on demand. It reads the
  half-letter PDF from Print / Save PDF with pdf-lib (rejecting other page
  sizes), finds where the acknowledgements start with pdf.js (their heading
  is the first line below the 0.7in top margin, which must match `@page` in
  App.css), pads to a multiple of 4 with blanks there (or at the end), and
  draws the pages two-up, saddle-stitched, on 11 × 8.5in sheets at 100%.
  Each library is a separate `import()`, so each gets its own chunk;
  nothing may import `booklet.ts` statically, or it joins the main bundle.
- `src/App.css`: screen and print styles. `@media print` sets US half-letter
  pages (5.5 × 8.5 in) with left/right page rules.
- `src/csvImport.ts`: **Load from CSV** for the player and acknowledgement
  lists. Its own RFC 4180 parser (quotes, BOM, `,`/`;`/tab chosen from the
  header row) and header matching through the alias lists at the top of the
  file. Errors are `CsvError`s with messages for the status line. App.tsx
  holds the Replace / Add to the end `<dialog>`, which is mounted only while
  a CSV is waiting, and the hidden file inputs, which stay outside the
  editor's form.
- `public/`: sample concerts and their exported HTML and PDF.

## How it works

- State is one `ConcertData` object in `App`. Each list (items, biographies,
  players, acknowledgements, extras) has its own `next…Id` counter; ids are
  not saved.
- Saved files use `{ format: 'opus-and-octavo-concert', version: 1, concert }`.
  `parseSavedConcert` validates loaded JSON or YAML and returns `null` for
  anything invalid. If you change the format, update the save code and the
  parser together, and keep older files loading.
- YAML is parsed with the `failsafe` schema, so every value comes in as a
  string. The `yaml` package is imported on demand.
- Biographies, program notes, featured credits and extras are Markdown,
  rendered by `renderMarkdown` (`marked` with `gfm` and `breaks`, then
  DOMPurify) and inserted with `dangerouslySetInnerHTML`. Always go through
  `renderMarkdown`: raw HTML is allowed, so unsanitized output could run
  scripts from a loaded file. `<p class="footnote">` gives a footnote style.
- Players are grouped by ensemble and section, then sorted in orchestral score
  order (`orchestralInstrumentOrder`, `orchestralTitleOrder`), then by name.
  A player whose ensemble is blank or matches the concert's ensemble name
  (ignoring case and spaces) is in the concert's own ensemble, the `''` group.
- Each section of the preview holds its entries in `<article>`s: thin
  `--line` rules separate articles, the last article in a section gets the
  `--accent` rule, and the last one in the document gets none. Add new
  sections the same way rather than giving them borders of their own. An
  extra can override its rule with the class `thin-rule`, `section-rule` or
  `no-rule` (`addendumClasses`). Extras are saved as `{ content, class, image,
  imageDescription, imageLayout }`; older files saved plain strings, which
  still load. An extra's Markdown is in `.addendum-content`, beside its image.
- Save for Web clones the preview element, so whatever the preview renders is
  what gets exported. The concert title, ensemble name and date make the
  document title and the printed page header.
- Photos are stored as data URLs (PNG, JPEG, WebP, GIF, up to 5 MB) and saved
  inside the concert file.
- The cover (`concert.cover`: `image`, `imageDescription`, `content`) comes
  first in the preview. Its image is absolutely positioned behind the text
  with `object-fit: contain`. In print it's on the named page `cover`, sized
  to that page's content area (0.3in margins, so 4.9 × 7.9in). Chrome lays
  out every page at the first page's width, so all pages have 0.3in side
  margins and `.document-paper` adds 0.4in of side padding in print, which the
  cover cancels with negative margins. Its margin boxes are all set to
  `content: ''`, not `none`: with no margin boxes, Chrome prints its own
  date, title, URL and page count there. `@top-center` also needs
  `!important`, because the title rule from `createPrintPageTitleRule` is
  added later and would otherwise win.
- Every image (biography, program note and extra photos, the cover) has an
  `ImageLayout`: image and clip sizes in inches, a focus point in percent,
  and an alignment, kept as strings for the form ('' = default) and saved as
  numbers, with only the fields that are set. With no size or focus set, the
  image renders exactly as before (`usesDefaultFraming`); otherwise
  `resolveImageLayout` works out the clip and image, and the image is placed
  in the clip in percent of it, so a clip narrowed to the column scales as a
  whole.
- Biographies, program items (for their notes) and extras have
  `pageBreakBefore`, saved only when true; YAML reads it back as the text
  `"true"`, which `parsePageBreak` accepts. It becomes the class
  `page-break-before` (a forced break in print). For a section's first shown
  entry the section gets the class instead (`sectionPageBreak`), so its
  heading and spacing move with it. The player list and acknowledgements
  have one flag each on the concert (`ensemblePlayersPageBreak`,
  `acknowledgementsPageBreak`), also saved only when true. The dashed marker
  is scoped to `.preview-panel`, so the Save for Web page doesn't show it.
- Screen layout: above 760px `.app-shell` is exactly the window's height and
  `.editor-panel` and `.preview-panel` are the scroll containers; the window
  itself doesn't scroll. At 760px and below the page scrolls as one under a
  sticky top bar, which is what `--topbar-height` and `scroll-padding-top`
  are for. A sticky box inside a panel keeps clear of the panel's padding
  as well as its edge (hence the negative `top` on `.editor-toggle`). The
  brand link's target, `#main-content`, is the editor heading, inside the
  editor panel, so following it scrolls that panel back up. Print resets
  the heights and overflow.
- `vite.config.ts` uses `base: './'` so the build works at any path.
- Colours: the editor uses `--editor-text`, `--editor-heading` and
  `--editor-line`; the program (preview, print and Save for Web) uses
  `--text`, `--heading`, `--accent` and `--line`. Each concert saves its own
  `colors`, which are set as those variables on the preview's `<article>`, so
  print and Save for Web follow. The printed page header can't see them, so
  `createPrintPageTitleRule` is given the text colour. Keep the two sets
  apart. Loaded colours must be `#rrggbb`: any other CSS value could pull
  outside files into the exported page.

## Conventions

- Accessibility matters: visible labels, semantic elements in the preview,
  visible focus, high-contrast print. Keep Markdown headings no larger than h2
  so the document's heading structure holds.
- Keep comments sparse; use them to explain why, not what.
- Commit messages: a short sentence ending with a period, a blank line, then a
  paragraph explaining what changed and why.
- After style changes that affect output, the samples in `public/` (HTML and
  PDF) may need to be regenerated from the app.
