# Opus & Octavo

Opus & Octavo creates accessible, print-ready concert programs. Enter the ensemble name, concert title, date, location, and conductor; add biographies with optional photos for the conductor or guests; build a variable-length running order with a title, movements, composer, featured credit, program note, and optional note author for each work; add ensemble players with section and title; and list extras at the end of the program. Players are grouped by section and sorted in orchestral score order, then alphabetically by name. The concert title, ensemble name, and date become the browser, PDF, and exported HTML title, and the printed page header. The semantic preview updates immediately.

Biography photos accept PNG, JPEG, WebP, and GIF files up to 5 MB. Photos are saved with the concert JSON and embedded in the standalone HTML export.

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
```

## Accessibility

Inputs have visible labels and stable names, and the preview uses semantic article, heading, paragraph, and list elements. The interface includes keyboard focus indicators and responsive layouts. Print output uses high-contrast text and pagination rules. This tooling supports accessible documents but does not certify ADA or WCAG compliance; review the generated content and test the finished site and printed/PDF output with appropriate accessibility checks.

## Sample Data

Two sample concert data files are included in /public.  The Sage City Symphony is a real community orchestra and the names of the Conductors, Music Director, soloists, and special mentions, to which we are very grateful have all been preserved as a means of public thanks for their generosity and service to our organization.  However, other names have been changed to protect the privacy of our players.  The actual program can be found at https://sagecitysymphony.org.