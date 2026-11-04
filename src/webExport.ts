import appStyles from './App.css?inline'
import atkinsonItalic from './assets/AtkinsonHyperlegibleNext-RegularItalic.woff2?inline'
import atkinsonRegular from './assets/AtkinsonHyperlegibleNextVF-Variable.woff2?inline'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]
  })
}

const documentStyles = appStyles
  .replace(
    /url\([^)]*AtkinsonHyperlegibleNextVF-Variable[^)]*\)/g,
    `url('${atkinsonRegular}')`,
  )
  .replace(
    /url\([^)]*AtkinsonHyperlegibleNext-RegularItalic[^)]*\)/g,
    `url('${atkinsonItalic}')`,
  )

export function createPrintPageTitleRule(title: string, textColor: string) {
  const escapedTitle = title
    .replace(/[\r\n\f]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ')

  // The page header can't see the article's --text, so it gets the colour
  // here; colours are checked as #rrggbb when loaded
  return `@page { @top-center { content: "${escapedTitle}"; color: ${textColor}; } }`
}

export function createStaticWebPage(title: string, articleHtml: string, textColor: string, printTitle = title) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${documentStyles}${createPrintPageTitleRule(printTitle, textColor)}</style>
</head>
<body>
<main>
${articleHtml}
</main>
</body>
</html>
`
}