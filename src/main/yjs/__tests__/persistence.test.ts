import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, applySchema, closeDb } from '../db'
import {
  createNarrative,
  listNarratives,
  getNarrative,
  deleteNarrative,
  updateNarrativeMeta,
  appendUpdate,
  loadDoc,
  loadDocState,
  getUpdatesSince,
  getMaxSeq,
  getSyncState,
  setSyncState,
  applyRemoteUpdate,
  compactNarrative
} from '../persistence'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'temenos-test-'))
  const db = openDb(join(tmpDir, 'test.db'))
  applySchema(db)
})

afterEach(() => {
  closeDb()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('narrative metadata', () => {
  it('creates and lists', () => {
    const a = createNarrative({ title: 'first' })
    const b = createNarrative({ title: 'second', tags: ['draft'] })
    const list = listNarratives()
    expect(list).toHaveLength(2)
    const titles = list.map((n) => n.title).sort()
    expect(titles).toEqual(['first', 'second'])
    expect(getNarrative(b.id)?.tags).toEqual(['draft'])
  })

  it('updates meta', () => {
    const n = createNarrative({ title: 'old' })
    updateNarrativeMeta(n.id, { title: 'new', tags: ['x', 'y'] })
    const fresh = getNarrative(n.id)
    expect(fresh?.title).toBe('new')
    expect(fresh?.tags).toEqual(['x', 'y'])
  })

  it('cascades delete to updates', () => {
    const n = createNarrative({ title: 'doomed' })
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'hello')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    expect(getMaxSeq(n.id)).toBe(1)
    deleteNarrative(n.id)
    expect(getNarrative(n.id)).toBeNull()
    expect(getMaxSeq(n.id)).toBe(0)
  })
})

describe('Yjs round-trip', () => {
  it('round-trips a single update', () => {
    const n = createNarrative({ title: 't' })
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'hello world')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))

    const reloaded = loadDoc(n.id)
    expect(reloaded.getText('body').toString()).toBe('hello world')
  })

  it('round-trips a sequence of updates', () => {
    const n = createNarrative({ title: 't' })
    const doc = new Y.Doc()
    const text = doc.getText('body')

    text.insert(0, 'one ')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))

    const stateAfterOne = Y.encodeStateVector(doc)
    text.insert(text.length, 'two ')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc, stateAfterOne))

    const stateAfterTwo = Y.encodeStateVector(doc)
    text.insert(text.length, 'three')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc, stateAfterTwo))

    expect(getMaxSeq(n.id)).toBe(3)

    const reloaded = loadDoc(n.id)
    expect(reloaded.getText('body').toString()).toBe('one two three')
  })

  it('loadDocState produces a single update equivalent to the full state', () => {
    const n = createNarrative({ title: 't' })
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'alpha')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    doc.getText('body').insert(5, ' beta')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))

    const state = loadDocState(n.id)
    const fresh = new Y.Doc()
    Y.applyUpdate(fresh, state)
    expect(fresh.getText('body').toString()).toBe('alpha beta')
  })

  it('getUpdatesSince returns only updates after the given seq', () => {
    const n = createNarrative({ title: 't' })
    const doc = new Y.Doc()

    doc.getText('body').insert(0, 'a')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    doc.getText('body').insert(1, 'b')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    doc.getText('body').insert(2, 'c')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))

    expect(getUpdatesSince(n.id, 0)).toHaveLength(3)
    expect(getUpdatesSince(n.id, 1)).toHaveLength(2)
    expect(getUpdatesSince(n.id, 3)).toHaveLength(0)
  })

  it('appendUpdate fails for unknown narrative (FK enforcement)', () => {
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'orphan')
    expect(() =>
      appendUpdate('00000000-0000-0000-0000-000000000000', Y.encodeStateAsUpdate(doc))
    ).toThrow()
  })
})

describe('sync state', () => {
  it('returns zero defaults for an unknown narrative', () => {
    const s = getSyncState('00000000-0000-0000-0000-000000000000')
    expect(s.lastPushedSeq).toBe(0)
    expect(s.lastPulledRemoteId).toBe(0)
  })

  it('persists patches and uses max() to never regress', () => {
    const n = createNarrative({ title: 's' })
    setSyncState(n.id, { lastPushedSeq: 5, lastPulledRemoteId: 100 })
    let s = getSyncState(n.id)
    expect(s.lastPushedSeq).toBe(5)
    expect(s.lastPulledRemoteId).toBe(100)

    // A lower value should NOT regress.
    setSyncState(n.id, { lastPushedSeq: 3 })
    s = getSyncState(n.id)
    expect(s.lastPushedSeq).toBe(5)
    expect(s.lastPulledRemoteId).toBe(100)

    // A higher value should advance.
    setSyncState(n.id, { lastPushedSeq: 9 })
    expect(getSyncState(n.id).lastPushedSeq).toBe(9)
  })

  it('cascades on narrative delete', () => {
    const n = createNarrative({ title: 's' })
    setSyncState(n.id, { lastPushedSeq: 1, lastPulledRemoteId: 1 })
    deleteNarrative(n.id)
    const s = getSyncState(n.id)
    expect(s.lastPushedSeq).toBe(0)
    expect(s.lastPulledRemoteId).toBe(0)
  })
})

describe('applyRemoteUpdate', () => {
  it('appends locally and bumps lastPushedSeq so we do not push it back', () => {
    const n = createNarrative({ title: 'r' })
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'remote bytes')

    const seq = applyRemoteUpdate(n.id, Y.encodeStateAsUpdate(doc))

    expect(seq).toBe(1)
    expect(getMaxSeq(n.id)).toBe(1)
    expect(getSyncState(n.id).lastPushedSeq).toBe(seq)
  })
})

describe('compactNarrative', () => {
  it('returns nothing-to-compact when there is at most one update', () => {
    const n = createNarrative({ title: 'tiny' })
    const r1 = compactNarrative(n.id)
    expect(r1.skipped).toBe('nothing-to-compact')

    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'one')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    setSyncState(n.id, { lastPushedSeq: 1 })

    const r2 = compactNarrative(n.id)
    expect(r2.skipped).toBe('nothing-to-compact')
  })

  it('refuses to compact when local updates have not been pushed', () => {
    const n = createNarrative({ title: 'unsynced' })
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'a')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    doc.getText('body').insert(1, 'b')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))

    // lastPushedSeq is 0; max(seq) is 2.
    const r = compactNarrative(n.id)
    expect(r.skipped).toBe('unsynced-changes')
    expect(getMaxSeq(n.id)).toBe(2)
  })

  it('collapses many updates into a single seq-1 snapshot', () => {
    const n = createNarrative({ title: 'big' })
    const doc = new Y.Doc()
    for (let i = 0; i < 10; i++) {
      doc.getText('body').insert(doc.getText('body').length, `${i}`)
      appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    }
    expect(getMaxSeq(n.id)).toBe(10)
    setSyncState(n.id, { lastPushedSeq: 10 })

    const r = compactNarrative(n.id)
    expect(r.from).toBe(10)
    expect(r.to).toBe(1)
    expect(getMaxSeq(n.id)).toBe(1)

    // Reload from disk: state survives.
    const reloaded = loadDoc(n.id)
    expect(reloaded.getText('body').toString()).toBe('0123456789')
  })

  it('after compaction, a new edit gets seq 2 and is pushable', () => {
    const n = createNarrative({ title: 'extend' })
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'pre')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    doc.getText('body').insert(3, '-mid')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    setSyncState(n.id, { lastPushedSeq: 2 })

    compactNarrative(n.id)
    expect(getSyncState(n.id).lastPushedSeq).toBe(1)

    // New edit after compaction.
    doc.getText('body').insert(doc.getText('body').length, '-post')
    const newSeq = appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    expect(newSeq).toBe(2)

    const pending = getUpdatesSince(n.id, getSyncState(n.id).lastPushedSeq)
    expect(pending).toHaveLength(1)
    expect(pending[0].seq).toBe(2)
  })
})

describe('CRDT merge — concurrent editor + MCP write', () => {
  it('preserves both writers and converges to the same state on both devices', () => {
    // Initial state shared by both.
    const seedDoc = new Y.Doc()
    seedDoc.getText('body').insert(0, 'seed')
    const seedUpdate = Y.encodeStateAsUpdate(seedDoc)

    const userDoc = new Y.Doc()
    Y.applyUpdate(userDoc, seedUpdate)
    const mcpDoc = new Y.Doc()
    Y.applyUpdate(mcpDoc, seedUpdate)

    // Concurrent edits without seeing each other.
    const userBefore = Y.encodeStateVector(userDoc)
    const mcpBefore = Y.encodeStateVector(mcpDoc)

    userDoc.getText('body').insert(userDoc.getText('body').length, ' [user]')
    mcpDoc.getText('body').insert(0, '[mcp] ')

    const userDelta = Y.encodeStateAsUpdate(userDoc, userBefore)
    const mcpDelta = Y.encodeStateAsUpdate(mcpDoc, mcpBefore)

    // Cross-merge.
    Y.applyUpdate(userDoc, mcpDelta)
    Y.applyUpdate(mcpDoc, userDelta)

    const userText = userDoc.getText('body').toString()
    const mcpText = mcpDoc.getText('body').toString()
    expect(userText).toBe(mcpText)
    expect(userText).toContain('seed')
    expect(userText).toContain('[user]')
    expect(userText).toContain('[mcp]')
  })
})

describe('updated_at bookkeeping', () => {
  it('appendUpdate bumps updated_at on the parent narrative', async () => {
    const n = createNarrative({ title: 't' })
    const before = getNarrative(n.id)!.updatedAt
    await new Promise((r) => setTimeout(r, 5))
    const doc = new Y.Doc()
    doc.getText('body').insert(0, 'x')
    appendUpdate(n.id, Y.encodeStateAsUpdate(doc))
    const after = getNarrative(n.id)!.updatedAt
    expect(after > before).toBe(true)
  })
})
