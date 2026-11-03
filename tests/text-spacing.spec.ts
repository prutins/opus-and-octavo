// WCAG 2.1 SC 1.4.12 Text Spacing: the preview must not lose content when a
// reader overrides line, paragraph, letter, and word spacing to the minimums.
import type { Page } from '@playwright/test'
import { expect, loadConcert, sampleConcert, test } from './helpers.ts'

// The SC 1.4.12 minimums, applied the way the standard text-spacing
// bookmarklet does
const textSpacingOverride = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`

type Issue = { kind: string; element: string; text: string; detail: string }

// Runs in the page. Reports text in the preview that is clipped, truncated,
// pushed outside the page, or overlapping other text.
function findLostText(): Issue[] {
  const root = document.querySelector<HTMLElement>('article.document-paper')
  if (!root) throw new Error('Preview not found')

  const describe = (el: Element) =>
    el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].join('.') : '')
  const textOf = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 70)
  // Screen-reader-only labels are clipped on purpose
  const isVisible = (el: Element) => {
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden' && !el.closest('.visually-hidden')
  }
  const clippingAncestor = (el: Element) => {
    for (let current: Element | null = el; current && current !== root; current = current.parentElement) {
      if (getComputedStyle(current).clipPath !== 'none') return current
    }
    return null
  }
  const issues: Issue[] = []

  // Content larger than a box that hides or scrolls it. The preview's own
  // overflow-x: clip is skipped: the program leaders run past it by design,
  // and text is checked against its edges below.
  for (const el of root.querySelectorAll('*')) {
    if (!isVisible(el)) continue
    const style = getComputedStyle(el)
    const overX = el.scrollWidth - el.clientWidth
    const overY = el.scrollHeight - el.clientHeight
    if ((style.overflowX !== 'visible' && overX > 1) || (style.overflowY !== 'visible' && overY > 1)) {
      issues.push({ kind: 'clipped', element: describe(el), text: textOf(el), detail: `${overX}px × ${overY}px hidden` })
    }
    if (style.textOverflow === 'ellipsis' && overX > 1) {
      issues.push({ kind: 'truncated', element: describe(el), text: textOf(el), detail: 'ellipsis' })
    }
  }

  // Each rendered line of text, with the nearest clip-path box it must stay within
  const rootBox = root.getBoundingClientRect()
  const lines: { el: Element; box: DOMRect }[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement
    if (!el || !node.textContent?.trim() || !isVisible(el)) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const clipper = clippingAncestor(el)
    const clipBox = clipper?.getBoundingClientRect()
    for (const box of range.getClientRects()) {
      if (box.width < 1 || box.height < 1) continue
      lines.push({ el, box })
      const text = node.textContent.trim().slice(0, 70)
      if (box.right > rootBox.right + 1 || box.left < rootBox.left - 1) {
        issues.push({ kind: 'outside page', element: describe(el), text, detail: `${Math.round(box.right - rootBox.right)}px past the right edge` })
      }
      if (clipper && clipBox && box.right > clipBox.right + 0.5) {
        issues.push({ kind: 'clipped', element: describe(clipper), text, detail: `${Math.round(box.right - clipBox.right)}px past its clip-path` })
      }
    }
  }

  // Lines from different elements overlapping by more than a fifth of a line
  lines.sort((a, b) => a.box.top - b.box.top)
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]
    for (let j = i + 1; j < lines.length && lines[j].box.top < a.box.bottom; j++) {
      const b = lines[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const width = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left)
      const height = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top)
      if (width > 1 && height > 0.2 * Math.min(a.box.height, b.box.height)) {
        issues.push({ kind: 'overlap', element: describe(a.el), text: textOf(a.el), detail: `overlaps ${describe(b.el)} "${textOf(b.el)}"` })
      }
    }
  }

  const page = document.documentElement
  if (page.scrollWidth > page.clientWidth + 1) {
    issues.push({ kind: 'horizontal scroll', element: 'html', text: '', detail: `${page.scrollWidth - page.clientWidth}px` })
  }

  return issues
}

async function applyTextSpacing(page: Page) {
  await page.addStyleTag({ content: textSpacingOverride })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

test.describe('WCAG 1.4.12 text spacing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadConcert(page, sampleConcert)
  })

  test('the override reaches the preview text', async ({ page }) => {
    await applyTextSpacing(page)
    const spacing = await page.locator('article.document-paper p').first().evaluate((p) => {
      const style = getComputedStyle(p)
      const size = parseFloat(style.fontSize)
      return {
        lineHeight: parseFloat(style.lineHeight) / size,
        letterSpacing: parseFloat(style.letterSpacing) / size,
        wordSpacing: parseFloat(style.wordSpacing) / size,
        paragraphSpacing: parseFloat(style.marginBottom) / size,
      }
    })
    expect(spacing.lineHeight).toBeCloseTo(1.5)
    expect(spacing.letterSpacing).toBeCloseTo(0.12)
    expect(spacing.wordSpacing).toBeCloseTo(0.16)
    expect(spacing.paragraphSpacing).toBeCloseTo(2)
  })

  test('no preview text is lost with increased spacing', async ({ page }) => {
    const key = (issue: Issue) => JSON.stringify([issue.kind, issue.element, issue.text])
    const before = new Set((await page.evaluate(findLostText)).map(key))
    await applyTextSpacing(page)
    const introduced = (await page.evaluate(findLostText)).filter((issue) => !before.has(key(issue)))
    expect(introduced).toEqual([])
  })
})
