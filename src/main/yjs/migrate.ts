import * as Y from 'yjs'
import { existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror'
import { getSchema } from '@tiptap/core'
import StarterKitImport from '@tiptap/starter-kit'
import PlaceholderImport from '@tiptap/extension-placeholder'
import {
  createNarrative,
  getNarrative,
  appendUpdate,
  loadDoc,
  getMaxSeq
} from './persistence'

// CJS/ESM interop: when bundled into the Electron main process by
// electron-vite (with externalizeDepsPlugin), tiptap's default exports come
// through as the namespace object rather than the actual class. Tests under
// vitest are more lenient and don't show this. Resolve defensively here so
// the same code path works in both environments.
type WithDefault<T> = T & { default?: T }
const StarterKit =
  (StarterKitImport as WithDefault<typeof StarterKitImport>).default ?? StarterKitImport
const Placeholder =
  (PlaceholderImport as WithDefault<typeof PlaceholderImport>).default ?? PlaceholderImport

// Must match the field used by the TipTap Collaboration extension in the
// renderer (its default is 'default'). If we mismatch here, the editor will
// load an empty document for migrated narratives.
const COLLAB_FIELD = 'default'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

export type MigrationStatus =
  | { id: string; status: 'migrated'; title: string }
  | { id: string; status: 'skipped'; reason: string }
  | { id: string; status: 'failed'; error: string }

export type MigrationReport = {
  results: MigrationStatus[]
  backupPath: string | null
  legacyDir: string
}

function defaultLegacyDir(): string {
  return join(homedir(), '.temenos', 'narratives')
}

function buildSchema() {
  return getSchema([
    StarterKit.configure({ orderedList: false, undoRedo: false }),
    Placeholder.configure({ placeholder: 'Start writing...' })
  ])
}

function isEmptyObject(v: unknown): boolean {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.keys(v as Record<string, unknown>).length === 0
  )
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = canonicalize((value as Record<string, unknown>)[k])
      if (v === undefined) continue
      // y-prosemirror adds empty `attrs: {}` to every mark on round-trip.
      // The bare TipTap JSON omits attrs when there are none — semantically
      // identical, so we drop empty attrs here rather than calling round-trip
      // a failure.
      if (k === 'attrs' && isEmptyObject(v)) continue
      // Empty content/marks arrays are also benign normalization differences.
      if ((k === 'content' || k === 'marks') && Array.isArray(v) && v.length === 0) continue
      out[k] = v
    }
    return out
  }
  return value
}

function jsonEquivalent(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b))
}

type LegacyMeta = {
  id: string
  title?: string | null
  activeDraftId: string
  tags?: string[]
  createdAt?: string
  updatedAt?: string
}

type LegacyDraft = {
  content?: unknown
}

function readLegacyNarrative(narrativeDir: string): {
  meta: LegacyMeta
  content: unknown
} | null {
  const metaPath = join(narrativeDir, 'narrative.json')
  if (!existsSync(metaPath)) return null

  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as LegacyMeta
  const draftPath = join(narrativeDir, 'drafts', `${meta.activeDraftId}.json`)

  let content: unknown = EMPTY_DOC
  if (existsSync(draftPath)) {
    const draft = JSON.parse(readFileSync(draftPath, 'utf-8')) as LegacyDraft
    if (draft.content) content = draft.content
  }

  return { meta, content }
}

/**
 * Migrate every legacy JSON narrative into the SQLite + Yjs store.
 *
 * Idempotent: narratives already present in SQLite are skipped.
 * On full success (no failures), renames the legacy dir to a timestamped
 * backup so it can never be silently re-migrated.
 *
 * Failure-tolerant: a single bad narrative does not abort the run. If any
 * narrative fails, the legacy dir is NOT renamed so the source of truth
 * stays in place for inspection.
 */
export function migrateLegacyNarratives(opts?: {
  legacyDir?: string
}): MigrationReport {
  const legacyDir = opts?.legacyDir ?? defaultLegacyDir()
  const report: MigrationReport = {
    results: [],
    backupPath: null,
    legacyDir
  }

  if (!existsSync(legacyDir)) return report

  let dirEntries: string[]
  try {
    dirEntries = readdirSync(legacyDir)
  } catch (err) {
    report.results.push({
      id: '<scan>',
      status: 'failed',
      error: err instanceof Error ? err.message : String(err)
    })
    return report
  }

  if (dirEntries.length === 0) return report

  const schema = buildSchema()

  for (const entry of dirEntries) {
    const narrativeDir = join(legacyDir, entry)
    let isDir = false
    try {
      isDir = statSync(narrativeDir).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) continue

    let parsed: ReturnType<typeof readLegacyNarrative>
    try {
      parsed = readLegacyNarrative(narrativeDir)
    } catch (err) {
      report.results.push({
        id: entry,
        status: 'failed',
        error: `read failed: ${err instanceof Error ? err.message : String(err)}`
      })
      continue
    }

    if (!parsed) {
      report.results.push({
        id: entry,
        status: 'skipped',
        reason: 'no narrative.json'
      })
      continue
    }

    const { meta, content } = parsed

    const existing = getNarrative(meta.id)
    if (existing && getMaxSeq(meta.id) > 0) {
      // Already migrated: row exists AND has content.
      report.results.push({
        id: meta.id,
        status: 'skipped',
        reason: 'already migrated'
      })
      continue
    }

    try {
      const yDoc = prosemirrorJSONToYDoc(
        schema,
        content as Parameters<typeof prosemirrorJSONToYDoc>[1],
        COLLAB_FIELD
      )
      const update = Y.encodeStateAsUpdate(yDoc)

      // Stub rows can pre-exist if remote sync ran before this migration
      // (e.g. on a previous boot that crashed mid-migration). Don't double-
      // create — just append the migrated content to the existing row.
      if (!existing) {
        createNarrative({
          id: meta.id,
          title: meta.title ?? 'Untitled',
          tags: meta.tags ?? []
        })
      }
      appendUpdate(meta.id, update)

      // Round-trip verification: reload from SQLite and compare to source.
      const reloaded = loadDoc(meta.id)
      const reloadedJson = yDocToProsemirrorJSON(reloaded, COLLAB_FIELD)

      if (!jsonEquivalent(reloadedJson, content)) {
        report.results.push({
          id: meta.id,
          status: 'failed',
          error: 'round-trip mismatch'
        })
        continue
      }

      report.results.push({
        id: meta.id,
        status: 'migrated',
        title: meta.title ?? 'Untitled'
      })
    } catch (err) {
      report.results.push({
        id: meta.id,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  const failed = report.results.filter((r) => r.status === 'failed')
  const migrated = report.results.filter((r) => r.status === 'migrated')

  if (failed.length === 0 && migrated.length > 0) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = `${legacyDir}.json-backup-${ts}`
    renameSync(legacyDir, backupPath)
    report.backupPath = backupPath
  }

  return report
}

export function summarizeReport(report: MigrationReport): string {
  const counts = report.results.reduce(
    (acc, r) => {
      acc[r.status]++
      return acc
    },
    { migrated: 0, skipped: 0, failed: 0 }
  )

  const lines: string[] = []
  lines.push(
    `[migrate] ${counts.migrated} migrated, ${counts.skipped} skipped, ${counts.failed} failed`
  )
  if (report.backupPath) {
    lines.push(`[migrate] legacy dir renamed to ${report.backupPath}`)
  } else if (counts.migrated > 0 || counts.failed > 0) {
    lines.push(`[migrate] legacy dir NOT renamed — keeping source of truth`)
  }
  for (const r of report.results) {
    if (r.status === 'failed') {
      lines.push(`[migrate]   FAIL ${r.id}: ${r.error}`)
    }
  }
  return lines.join('\n')
}
