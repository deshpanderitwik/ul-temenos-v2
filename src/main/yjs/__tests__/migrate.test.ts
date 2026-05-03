import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { yDocToProsemirrorJSON } from 'y-prosemirror'
import { openDb, applySchema, closeDb } from '../db'
import { listNarratives, loadDoc, getNarrative } from '../persistence'
import { migrateLegacyNarratives } from '../migrate'

const COLLAB_FIELD = 'default'

let tmpRoot: string
let legacyDir: string

type FixtureNarrative = {
  id?: string
  title: string
  content?: unknown
  tags?: string[]
}

function makeFixture(narratives: FixtureNarrative[]): Array<{ id: string; title: string; content: unknown }> {
  mkdirSync(legacyDir, { recursive: true })
  return narratives.map((n) => {
    const id = n.id ?? randomUUID()
    const draftId = randomUUID()
    const ts = new Date().toISOString()
    const content =
      n.content ?? {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `body of ${n.title}` }]
          }
        ]
      }

    const dir = join(legacyDir, id)
    mkdirSync(join(dir, 'drafts'), { recursive: true })
    writeFileSync(
      join(dir, 'narrative.json'),
      JSON.stringify({
        id,
        title: n.title,
        activeDraftId: draftId,
        tags: n.tags ?? [],
        createdAt: ts,
        updatedAt: ts
      })
    )
    writeFileSync(
      join(dir, 'drafts', `${draftId}.json`),
      JSON.stringify({
        id: draftId,
        narrativeId: id,
        parentDraftId: null,
        label: null,
        content,
        createdAt: ts,
        updatedAt: ts
      })
    )
    return { id, title: n.title, content }
  })
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'temenos-migrate-'))
  legacyDir = join(tmpRoot, 'narratives')
  const db = openDb(join(tmpRoot, 'test.db'))
  applySchema(db)
})

afterEach(() => {
  closeDb()
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('migrateLegacyNarratives', () => {
  it('is a no-op when the legacy dir does not exist', () => {
    const report = migrateLegacyNarratives({ legacyDir: join(tmpRoot, 'does-not-exist') })
    expect(report.results).toHaveLength(0)
    expect(report.backupPath).toBeNull()
  })

  it('is a no-op when the legacy dir is empty', () => {
    mkdirSync(legacyDir, { recursive: true })
    const report = migrateLegacyNarratives({ legacyDir })
    expect(report.results).toHaveLength(0)
    expect(report.backupPath).toBeNull()
    // Empty dir is not renamed.
    expect(existsSync(legacyDir)).toBe(true)
  })

  it('migrates a single narrative and renames the legacy dir', () => {
    const [n] = makeFixture([{ title: 'My Novel' }])

    const report = migrateLegacyNarratives({ legacyDir })

    expect(report.results).toHaveLength(1)
    expect(report.results[0].status).toBe('migrated')
    expect(report.backupPath).not.toBeNull()
    expect(existsSync(legacyDir)).toBe(false)
    expect(existsSync(report.backupPath!)).toBe(true)

    // SQLite has the row.
    expect(getNarrative(n.id)?.title).toBe('My Novel')

    // The Y.Doc round-trips back to text.
    const yDoc = loadDoc(n.id)
    const json = yDocToProsemirrorJSON(yDoc, COLLAB_FIELD) as {
      content: Array<{ content: Array<{ text: string }> }>
    }
    expect(json.content[0].content[0].text).toBe('body of My Novel')
  })

  it('migrates multiple narratives, all in one pass', () => {
    const fx = makeFixture([
      { title: 'One' },
      { title: 'Two' },
      { title: 'Three' }
    ])

    const report = migrateLegacyNarratives({ legacyDir })

    const migrated = report.results.filter((r) => r.status === 'migrated')
    expect(migrated).toHaveLength(3)
    expect(listNarratives()).toHaveLength(3)

    for (const f of fx) {
      const yDoc = loadDoc(f.id)
      const json = yDocToProsemirrorJSON(yDoc, COLLAB_FIELD) as {
        content: Array<{ content: Array<{ text: string }> }>
      }
      expect(json.content[0].content[0].text).toBe(`body of ${f.title}`)
    }
  })

  it('is idempotent — re-running does nothing', () => {
    makeFixture([{ title: 'Idempotent' }])

    const first = migrateLegacyNarratives({ legacyDir })
    expect(first.results.filter((r) => r.status === 'migrated')).toHaveLength(1)

    // First run renamed legacyDir, so a re-run sees no source and is a no-op.
    const second = migrateLegacyNarratives({ legacyDir })
    expect(second.results).toHaveLength(0)
    expect(second.backupPath).toBeNull()
  })

  it('migrates content into pre-existing stub rows (e.g. from a remote pull)', () => {
    const [n] = makeFixture([{ title: 'preexisting' }])

    // Pre-seed SQLite with a STUB row (no Yjs updates) — simulates the case
    // where remote sync populated metadata before the migration ran.
    const db = openDb()
    db.prepare(
      'INSERT INTO narratives (id, title, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(n.id, 'remote-pulled', '[]', new Date().toISOString(), new Date().toISOString())

    const report = migrateLegacyNarratives({ legacyDir })

    const result = report.results.find((r) => r.id === n.id)
    expect(result?.status).toBe('migrated')

    // The Yjs content from the JSON fixture is now in SQLite.
    const yDoc = loadDoc(n.id)
    const json = yDocToProsemirrorJSON(yDoc, COLLAB_FIELD) as {
      content: Array<{ content: Array<{ text: string }> }>
    }
    expect(json.content[0].content[0].text).toBe('body of preexisting')
  })

  it('genuinely skips narratives that have already been fully migrated', () => {
    const [n] = makeFixture([{ title: 'fully-done' }])

    // Run once to fully migrate.
    const first = migrateLegacyNarratives({ legacyDir })
    expect(first.results[0].status).toBe('migrated')

    // The legacy dir is now renamed; restore the fixture's path for the
    // second run so we can re-attempt migration of the same id.
    // Simulate the state by recreating the fixture under the same id.
    makeFixture([{ id: n.id, title: 'fully-done' }])

    const second = migrateLegacyNarratives({ legacyDir })
    const result = second.results.find((r) => r.id === n.id)
    expect(result?.status).toBe('skipped')
  })

  it('preserves rich content (bold marks) through round-trip', () => {
    const richContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Title Line' }
          ]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body text.' }]
        }
      ]
    }
    const [n] = makeFixture([{ title: 'Rich', content: richContent }])

    const report = migrateLegacyNarratives({ legacyDir })
    expect(report.results[0].status).toBe('migrated')

    const yDoc = loadDoc(n.id)
    const json = yDocToProsemirrorJSON(yDoc, COLLAB_FIELD) as {
      content: Array<{ content: Array<{ marks?: Array<{ type: string }>; text: string }> }>
    }
    expect(json.content[0].content[0].text).toBe('Title Line')
    expect(json.content[0].content[0].marks?.[0]?.type).toBe('bold')
    expect(json.content[1].content[0].text).toBe('Body text.')
  })

  it('does NOT rename the legacy dir if any narrative fails', () => {
    const [good] = makeFixture([{ title: 'good' }])
    // Plant a narrative dir with a corrupt narrative.json so it fails.
    const badId = randomUUID()
    mkdirSync(join(legacyDir, badId, 'drafts'), { recursive: true })
    writeFileSync(join(legacyDir, badId, 'narrative.json'), '{ this is not json')

    const report = migrateLegacyNarratives({ legacyDir })

    expect(report.results.find((r) => r.id === good.id)?.status).toBe('migrated')
    expect(report.results.some((r) => r.status === 'failed')).toBe(true)
    expect(report.backupPath).toBeNull()
    expect(existsSync(legacyDir)).toBe(true)
  })

  it('skips entries that lack narrative.json', () => {
    mkdirSync(join(legacyDir, 'orphan-dir'), { recursive: true })
    const [good] = makeFixture([{ title: 'good' }])

    const report = migrateLegacyNarratives({ legacyDir })

    const orphan = report.results.find((r) => r.id === 'orphan-dir')
    expect(orphan?.status).toBe('skipped')
    expect(report.results.find((r) => r.id === good.id)?.status).toBe('migrated')
    void readdirSync // silence unused import
  })
})
