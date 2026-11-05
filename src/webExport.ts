import appStyles from './App.css?inline'
import atkinsonItalic from './assets/AtkinsonHyperlegibleNext-RegularItalic.woff2?inline'
import atkinsonRegular from './assets/AtkinsonHyperlegibleNextVF-Variable.woff2?inline'
import { createPrintPageTitleRule } from './printPageTitle.ts'

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

type ContentsLink = { id: string; label: string }

// The parts of the program the contents link to, in document order. Each is
// labelled by its first heading, except the program's heading (the concert
// title, date and so on, with the running order below it) and the
// biographies (each has a name, but the section has no heading), which get
// fixed labels; an extra is listed only if it has a heading.
const contentsParts = '.document-heading, .biographies-page, .program-notes-page, .ensemble-players > article, .document-addenda > article, .acknowledgements'

function contentsLabel(part: Element) {
  if (part.matches('.document-heading')) return 'Program'
  if (part.matches('.biographies-page')) return 'Biographies'
  const heading = part.querySelector('h1, h2')?.textContent?.trim() ?? ''
  // An ensemble's heading can be empty when no ensemble name is set
  return heading || (part.matches('.ensemble-players > article') ? 'Players' : '')
}

// Gives each part an id made from its label (#program-notes), so the links
// read well when shared, and returns the links
function addContentsTargets(article: HTMLElement): ContentsLink[] {
  const used = new Set([...article.querySelectorAll('[id]')].map((element) => element.id).concat('top'))
  const links: ContentsLink[] = []
  for (const part of article.querySelectorAll(contentsParts)) {
    const label = contentsLabel(part)
    if (!label) continue
    const base = label.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'
    let id = base
    for (let count = 2; used.has(id); count++) id = `${base}-${count}`
    used.add(id)
    part.id = id
    links.push({ id, label })
  }
  return links
}

const backToTopIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export function createStaticWebPage(title: string, article: HTMLElement, textColor: string, printTitle = title) {
  const links = addContentsTargets(article)
  // A single link isn't worth a contents list
  const contents = links.length > 1
    ? `<nav class="web-contents" aria-label="Contents">
<ul role="list">
${links.map((link) => `<li><a href="#${link.id}">${escapeHtml(link.label)}</a></li>`).join('\n')}
</ul>
</nav>
`
    : ''
  // The concert's colours, for the contents and the back-to-top link too
  const colors = article.getAttribute('style') ?? ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${documentStyles}${createPrintPageTitleRule(printTitle, textColor)}</style>
</head>
<body>
<div class="web-page" id="top"${colors ? ` style="${escapeHtml(colors)}"` : ''}>
${contents}<main>
${article.outerHTML}
</main>
<div class="back-to-top-track"><a class="back-to-top" href="#top">${backToTopIcon}<span class="visually-hidden">Back to top</span></a></div>
</div>
</body>
</html>
`
}