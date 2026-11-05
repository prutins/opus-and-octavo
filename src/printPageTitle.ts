// The printed page header: the concert's title in the running header, set by
// a rule the app adds to the page and Save for Web adds to its own copy
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
