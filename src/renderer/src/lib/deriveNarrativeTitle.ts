import type { JSONContent } from '@tiptap/core'

const MAX_TITLE_LENGTH = 200

function hasBoldMark(marks?: JSONContent['marks']): boolean {
  return marks?.some((m) => m.type === 'bold') ?? false
}

function truncateTitle(s: string): string {
  if (s.length <= MAX_TITLE_LENGTH) return s
  return `${s.slice(0, MAX_TITLE_LENGTH - 1)}…`
}

/**
 * If the first non-empty paragraph’s first line (up to a hard break or end of
 * paragraph) is entirely bold, returns that line as the narrative title.
 * Otherwise returns null (caller should store "Untitled").
 */
export function deriveNarrativeTitleFromContent(doc: JSONContent): string | null {
  if (doc.type !== 'doc' || !doc.content?.length) return null

  for (const block of doc.content) {
    if (block.type !== 'paragraph') continue

    const inlines = block.content
    if (!inlines?.length) continue

    let line = ''
    let sawText = false
    let allBold = true

    for (const node of inlines) {
      if (node.type === 'hardBreak') break
      if (node.type === 'text' && node.text != null) {
        sawText = true
        line += node.text
        if (!hasBoldMark(node.marks)) allBold = false
      }
    }

    const trimmed = line.trim()
    if (trimmed.length === 0) continue

    if (!sawText || !allBold) return null

    return truncateTitle(trimmed)
  }

  return null
}
