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

export function createStaticWebPage(title: string, articleHtml: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${documentStyles}</style>
</head>
<body>
${articleHtml}
</body>
</html>
`
}