# Opus & Octavo

Opus & Octavo creates accessible, print-ready concert programs. Enter the ensemble name, concert title, date, location, and conductor; add biographies with optional photos for the conductor or guests; build a variable-length running order with a title, movements, composer, featured credit, program note, and optional note author for each work; add ensemble players with section and title; list extras; and close with acknowledgements, each a name with an optional role, set in columns like the players. Players are grouped by section and sorted in orchestral score order, then alphabetically by name. The concert title, ensemble name, and date become the browser, PDF, and exported HTML title, and the printed page header. The semantic preview updates immediately.

Under **Colors**, choose the program's text, heading, accent (the main rules between sections), and thin rule colors; they're saved with the concert and used in print and the HTML export, while the editor keeps its own. The app warns when the text or heading color has less than 4.5:1 contrast with the white page. In a hand-written YAML file, quote colors (`heading: '#7a1f3d'`), since an unquoted `#` starts a comment.

Under **Cover**, add a cover page: an image, shown as large as fits within the page margins without cropping, and text in Markdown or HTML, shown in front of the image when there is both. The cover prints on a page of its own, without the running header or page number. Give the image a description unless it's only decoration, and avoid headings in the cover text, since the cover comes before the program's title.

Each extra can also have an optional image, with a description for screen readers.

Biographies, program notes, and extras each have a **Start a new page before this…** checkbox for printed copies. Ticked on the first entry, the whole section starts on a new page, so the Program Notes heading stays with its first note. The Ensemble Players and Acknowledgements sections each have a single checkbox to start the section on a new page. The app's preview marks each break with a dashed line; the HTML export doesn't show the marks, but keeps the breaks when it's printed.

Each image has optional **Size and position** fields: the image's width and height in inches, a clip rectangle in inches (the part of the image that shows, never wider than the text column), a focus point in percent that picks which part shows, and an alignment (left, right, or centered for photos; top, middle, or bottom for the cover). Blank fields keep the usual size and placement.

All images accept PNG, JPEG, WebP, and GIF files up to 5 MB. Photos are saved with the concert JSON and embedded in the standalone HTML export.

Biographies, program notes, featured credits, and extras accept Markdown. For a footnote, write the paragraph as `<p class="footnote">…</p>`; it's set slightly smaller, below a short rule. Other HTML is allowed too, but scripts, event handlers, and `javascript:` links are removed. Headings within markdown data should be no larger than h2, to maintain page structure. Each extra can also choose the rule below it: a thin rule, a section rule, or none, instead of the automatic rules the other sections use.

## Use it online

Opus & Octavo runs at **https://prutins.github.io/opus-and-octavo/**. Everything happens in your browser: concert files you load and the programs you build are never uploaded. The site is redeployed automatically by GitHub Actions on every push to `main`.

## Run locally

```sh
npm install
npm run dev
```

The development server prints its local URL. Use **Save** (then JSON or YAML) to download the current concert data, **Load File** to restore a previously saved program from JSON or YAML (`.yaml`/`.yml`, with the same structure as the saved JSON; YAML values are always read as plain text), or **Save for Web** to download a standalone HTML file with embedded styles and fonts. The HTML export can be placed on a static website without the editor or external stylesheet. Use **Print / Save PDF** to open the browser's print dialog; the print stylesheet produces US half-letter pages (5.5 × 8.5 in) and excludes the editor controls. To print two pages per sheet, choose landscape letter paper, 2 pages per sheet, and 100% (actual size) scaling; for a folded booklet, use your PDF viewer's or printer's booklet printing.

## Checks

```sh
npm run build
npm run lint
npm test
```

`npm test` runs browser tests with Playwright against a development server it starts on port 4174. They cover the editor and live preview, player ordering, saving and loading JSON and YAML, photos, Save for Web, printing, layout at desktop and phone widths, and accessibility, including WCAG 2.1 SC 1.4.12 (Text Spacing). They use the anonymized Sage City sample and the fictional concerts in `tests/fixtures/`. Tests marked `test.fail()` describe known bugs; they pass while the bug exists and fail once it's fixed, as a reminder to remove the marker. The tests use `CHROMIUM_PATH` or a system Chromium if one is installed; otherwise run `npx playwright install chromium` once first.

## Accessibility

Inputs have visible labels and stable names, and the preview uses semantic article, heading, paragraph, and list elements. The interface includes keyboard focus indicators and responsive layouts. Print output uses high-contrast text and pagination rules. This tooling supports accessible documents but does not certify ADA or WCAG compliance; review the generated content and test the finished site and printed/PDF output with appropriate accessibility checks.

## Sample Data

Two sample concert data files are included in /public.  The Sage City Symphony is a real community orchestra and the names of the Conductors, Music Director, soloists, and special mentions, to which we are very grateful have all been preserved as a means of public thanks for their generosity and service to our organization.  However, other names have been changed to protect the privacy of our players.  The actual program can be found at https://sagecitysymphony.org.