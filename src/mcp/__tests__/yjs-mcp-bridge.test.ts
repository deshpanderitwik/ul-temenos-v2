import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { applyContentReplacement, docToTipTapJSON } from '../yjs-mcp-bridge'

describe('applyContentReplacement', () => {
  it('populates an empty doc with new content', () => {
    const doc = new Y.Doc()
    const update = applyContentReplacement(doc, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hello' }]
        }
      ]
    })
    expect(update.byteLength).toBeGreaterThan(0)
    const json = docToTipTapJSON(doc) as {
      content: Array<{ content: Array<{ text: string }> }>
    }
    expect(json.content[0].content[0].text).toBe('hello')
  })

  it('replaces (not concatenates) when called a second time on a doc viewed locally', () => {
    const doc = new Y.Doc()

    const u1 = applyContentReplacement(doc, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'first' }] }
      ]
    })
    const u2 = applyContentReplacement(doc, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'second' }] }
      ]
    })
    expect(u1.byteLength).toBeGreaterThan(0)
    expect(u2.byteLength).toBeGreaterThan(0)

    const json = docToTipTapJSON(doc) as {
      content: Array<{ content: Array<{ text: string }> }>
    }
    // Locally, after replacement, only the new content shows.
    const allText = json.content
      .flatMap((p) => p.content?.map((n) => n.text) ?? [])
      .join('|')
    expect(allText).toBe('second')
  })

  it('a fresh doc applying the chained updates reaches the same final state', () => {
    // Simulate: another device pulls all updates and reconstructs.
    const writer = new Y.Doc()
    const u1 = applyContentReplacement(writer, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }]
    })
    const u2 = applyContentReplacement(writer, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }]
    })

    const reader = new Y.Doc()
    Y.applyUpdate(reader, u1)
    Y.applyUpdate(reader, u2)

    const json = docToTipTapJSON(reader) as {
      content: Array<{ content: Array<{ text: string }> }>
    }
    const allText = json.content
      .flatMap((p) => p.content?.map((n) => n.text) ?? [])
      .join('|')
    expect(allText).toBe('second')
  })
})
