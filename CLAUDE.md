# CLAUDE.md

Opus & Octavo is a browser-only React + Vite app for building accessible,
print-ready concert programs. See README.md for what it does from a user's
point of view.

## Commands

```sh
npm run dev      # development server
npm run build    # tsc -b, then vite build into dist/
npm run lint     # oxlint
```

Run `npm run lint` and `npm run build` after a change; the deploy workflow runs
both and stops on failure.

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
  `App.css` and the Atkinson Hyperlegible Next fonts as data URLs.
- `src/App.css`: screen and print styles. `@media print` sets US half-letter
  pages (5.5 × 8.5 in) with left/right page rules.
- `public/`: sample concerts and their exported HTML and PDF.

## How it works

- State is one `ConcertData` object in `App`. Each list (items, biographies,
  players, extras) has its own `next…Id` counter; ids are not saved.
- Saved files use `{ format: 'opus-and-octavo-concert', version: 1, concert }`.
  `parseSavedConcert` validates loaded JSON or YAML and returns `null` for
  anything invalid. If you change the format, update the save code and the
  parser together, and keep older files loading.
- YAML is parsed with the `failsafe` schema, so every value comes in as a
  string. The `yaml` package is imported on demand.
- Biographies, program notes, featured credits and extras are Markdown,
  rendered with `marked` (`gfm`, `breaks`) and inserted with
  `dangerouslySetInnerHTML`. `<p class="footnote">` gives a footnote style.
- Players are grouped by ensemble and section, then sorted in orchestral score
  order (`orchestralInstrumentOrder`, `orchestralTitleOrder`), then by name.
- Save for Web clones the preview element, so whatever the preview renders is
  what gets exported. The concert title, ensemble name and date make the
  document title and the printed page header.
- Photos are stored as data URLs (PNG, JPEG, WebP, GIF, up to 5 MB) and saved
  inside the concert file.
- `vite.config.ts` uses `base: './'` so the build works at any path.

## Conventions

- Accessibility matters: visible labels, semantic elements in the preview,
  visible focus, high-contrast print. Keep Markdown headings no larger than h2
  so the document's heading structure holds.
- Keep comments sparse; use them to explain why, not what.
- Commit messages: a short sentence ending with a period, a blank line, then a
  paragraph explaining what changed and why.
- After style changes that affect output, the samples in `public/` (HTML and
  PDF) may need to be regenerated from the app.
