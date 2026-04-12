type Mark = { type: string }
type TextNode = { type: 'text'; text: string; marks?: Mark[] }
type HardBreakNode = { type: 'hardBreak' }
type ParagraphNode = { type: 'paragraph'; content?: (TextNode | HardBreakNode)[] }
type DocNode = { type: 'doc'; content: ParagraphNode[] }

export type TipTapDoc = DocNode

export function textToTipTapDoc(text: string): TipTapDoc {
  const paragraphs = text.split(/\n\n+/)
  return {
    type: 'doc',
    content: paragraphs.map((para) => {
      const trimmed = para.trim()
      if (!trimmed) return { type: 'paragraph' } as ParagraphNode

      const lines = trimmed.split('\n')
      const content: (TextNode | HardBreakNode)[] = []
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) content.push({ type: 'hardBreak' })
        if (lines[i]) content.push({ type: 'text', text: lines[i] })
      }
      return { type: 'paragraph', content } as ParagraphNode
    })
  }
}

export function tipTapDocToText(doc: Record<string, unknown>): string {
  const content = doc.content as ParagraphNode[] | undefined
  if (!content) return ''

  return content
    .map((block) => {
      if (!block.content) return ''
      return block.content
        .map((node) => {
          if (node.type === 'text') return (node as TextNode).text
          if (node.type === 'hardBreak') return '\n'
          return ''
        })
        .join('')
    })
    .join('\n\n')
}

export function textToTipTapDocWithTitle(title: string, body: string): TipTapDoc {
  const titleParagraph: ParagraphNode = {
    type: 'paragraph',
    content: [{ type: 'text', text: title, marks: [{ type: 'bold' }] }]
  }
  const bodyDoc = textToTipTapDoc(body)
  return {
    type: 'doc',
    content: [titleParagraph, ...bodyDoc.content]
  }
}

export function appendToTipTapDoc(
  doc: Record<string, unknown>,
  text: string
): TipTapDoc {
  const existing = doc as TipTapDoc
  const addition = textToTipTapDoc(text)
  return {
    type: 'doc',
    content: [...(existing.content ?? []), ...addition.content]
  }
}
