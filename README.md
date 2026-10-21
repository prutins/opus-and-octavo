# Form & Folio

Form & Folio creates accessible, print-ready concert programs. Enter the concert title, date, location, and conductor; add biographies with optional photos for the conductor or guests; build a variable-length running order with a title, movements, composer, featured credit, and program note for each work; and list acknowledgements at the end of the program. The semantic preview updates immediately.

Biography photos accept PNG, JPEG, WebP, and GIF files up to 5 MB. Photos are saved with the concert JSON and embedded in the standalone HTML export.

## Run locally

```sh
npm install
npm run dev
```

The development server prints its local URL. Use **Save JSON** to download the current concert data, **Load JSON** to restore a previously saved program, or **Save for Web** to download a standalone HTML file with embedded styles and fonts. The HTML export can be placed on a static website without the editor or external stylesheet. Use **Print / Save PDF** to open the browser's print dialog; the print stylesheet targets US Letter paper and excludes the editor controls.

## Checks

```sh
npm run build
npm run lint
```

## Accessibility

Inputs have visible labels and stable names, and the preview uses semantic article, heading, paragraph, and list elements. The interface includes keyboard focus indicators and responsive layouts. Print output uses high-contrast text and pagination rules. This tooling supports accessible documents but does not certify ADA or WCAG compliance; review the generated content and test the finished site and printed/PDF output with appropriate accessibility checks.
