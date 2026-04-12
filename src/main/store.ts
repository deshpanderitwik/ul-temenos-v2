import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

const BASE_DIR = join(homedir(), '.temenos')
const NARRATIVES_DIR = join(BASE_DIR, 'narratives')
const INDEX_PATH = join(BASE_DIR, 'index.json')

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

// ── Types ──

export type IndexEntry = {
  id: string
  title: string
  updatedAt: string
}

type IndexFile = {
  narratives: IndexEntry[]
}

export type NarrativeMeta = {
  id: string
  title: string
  activeDraftId: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type Draft = {
  id: string
  narrativeId: string
  parentDraftId: string | null
  label: string | null
  content: unknown
  createdAt: string
  updatedAt: string
}

export type NarrativeData = {
  id: string
  title: string
  activeDraftId: string
  content: unknown
}

// ── Helpers ──

function now(): string {
  return new Date().toISOString()
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
}

function narrativeDir(id: string): string {
  return join(NARRATIVES_DIR, id)
}

function narrativeMetaPath(id: string): string {
  return join(narrativeDir(id), 'narrative.json')
}

function draftsDir(id: string): string {
  return join(narrativeDir(id), 'drafts')
}

function draftPath(narrativeId: string, draftId: string): string {
  return join(draftsDir(narrativeId), `${draftId}.json`)
}

// ── Store Directory ──

export function ensureStoreDir(): void {
  mkdirSync(NARRATIVES_DIR, { recursive: true })
  if (!existsSync(INDEX_PATH)) {
    writeJson(INDEX_PATH, { narratives: [] })
  }
}

export function getStoreDir(): string {
  return BASE_DIR
}

// ── Index ──

function readIndex(): IndexFile {
  try {
    return readJson<IndexFile>(INDEX_PATH)
  } catch {
    return { narratives: [] }
  }
}

function writeIndex(index: IndexFile): void {
  writeJson(INDEX_PATH, index)
}

function updateIndexEntry(id: string, title: string, updatedAt: string): void {
  const index = readIndex()
  const existing = index.narratives.findIndex((n) => n.id === id)
  if (existing >= 0) {
    index.narratives[existing] = { id, title, updatedAt }
  } else {
    index.narratives.unshift({ id, title, updatedAt })
  }
  index.narratives.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  writeIndex(index)
}

function removeIndexEntry(id: string): void {
  const index = readIndex()
  index.narratives = index.narratives.filter((n) => n.id !== id)
  writeIndex(index)
}

// ── CRUD ──

export function listNarratives(): IndexEntry[] {
  return readIndex().narratives
}

export function getLatestNarrativeId(): string | null {
  const entries = readIndex().narratives
  return entries.length > 0 ? entries[0].id : null
}

export function getNarrative(id: string): NarrativeData | null {
  const metaPath = narrativeMetaPath(id)
  if (!existsSync(metaPath)) return null

  const meta = readJson<NarrativeMeta>(metaPath)
  const dp = draftPath(id, meta.activeDraftId)

  let content: unknown = EMPTY_DOC
  if (existsSync(dp)) {
    const draft = readJson<Draft>(dp)
    content = draft.content
  }

  return {
    id: meta.id,
    title: meta.title,
    activeDraftId: meta.activeDraftId,
    content
  }
}

export function createNarrative(title?: string): { narrativeId: string; draftId: string } {
  const narrativeId = randomUUID()
  const draftId = randomUUID()
  const ts = now()
  const narrativeTitle = title ?? 'Untitled'

  mkdirSync(draftsDir(narrativeId), { recursive: true })

  const meta: NarrativeMeta = {
    id: narrativeId,
    title: narrativeTitle,
    activeDraftId: draftId,
    tags: [],
    createdAt: ts,
    updatedAt: ts
  }
  writeJson(narrativeMetaPath(narrativeId), meta)

  const draft: Draft = {
    id: draftId,
    narrativeId,
    parentDraftId: null,
    label: null,
    content: EMPTY_DOC,
    createdAt: ts,
    updatedAt: ts
  }
  writeJson(draftPath(narrativeId, draftId), draft)

  updateIndexEntry(narrativeId, narrativeTitle, ts)

  return { narrativeId, draftId }
}

export function updateDraft(
  narrativeId: string,
  content: unknown,
  title: string
): void {
  const metaPath = narrativeMetaPath(narrativeId)
  if (!existsSync(metaPath)) return

  const meta = readJson<NarrativeMeta>(metaPath)
  const ts = now()

  const dp = draftPath(narrativeId, meta.activeDraftId)
  if (existsSync(dp)) {
    const draft = readJson<Draft>(dp)
    draft.content = content
    draft.updatedAt = ts
    writeJson(dp, draft)
  }

  meta.title = title
  meta.updatedAt = ts
  writeJson(metaPath, meta)

  updateIndexEntry(narrativeId, title, ts)
}

export function deleteNarrative(id: string): void {
  const dir = narrativeDir(id)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
  removeIndexEntry(id)
}

/**
 * Import narratives from an external source (e.g. Supabase migration).
 * Each item should have { id, title, content, updated_at }.
 */
export function importNarratives(
  items: { id: string; title: string | null; content: unknown; updated_at: string }[]
): void {
  for (const item of items) {
    const narrativeId = item.id
    const draftId = randomUUID()
    const title = item.title ?? 'Untitled'
    const ts = item.updated_at

    if (existsSync(narrativeDir(narrativeId))) continue

    mkdirSync(draftsDir(narrativeId), { recursive: true })

    const meta: NarrativeMeta = {
      id: narrativeId,
      title,
      activeDraftId: draftId,
      tags: [],
      createdAt: ts,
      updatedAt: ts
    }
    writeJson(narrativeMetaPath(narrativeId), meta)

    const draft: Draft = {
      id: draftId,
      narrativeId,
      parentDraftId: null,
      label: null,
      content: item.content ?? EMPTY_DOC,
      createdAt: ts,
      updatedAt: ts
    }
    writeJson(draftPath(narrativeId, draftId), draft)

    updateIndexEntry(narrativeId, title, ts)
  }
}

/**
 * Import a full narrative with its drafts from a remote source (Supabase sync).
 * Overwrites existing local data for this narrative if present.
 */
export function importFromRemote(data: {
  id: string
  title: string
  activeDraftId: string
  tags: string[]
  createdAt: string
  updatedAt: string
  drafts: Draft[]
}): void {
  mkdirSync(draftsDir(data.id), { recursive: true })

  const meta: NarrativeMeta = {
    id: data.id,
    title: data.title,
    activeDraftId: data.activeDraftId,
    tags: data.tags,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt
  }
  writeJson(narrativeMetaPath(data.id), meta)

  for (const draft of data.drafts) {
    writeJson(draftPath(data.id, draft.id), draft)
  }

  updateIndexEntry(data.id, data.title, data.updatedAt)
}

/**
 * Rebuild index.json by scanning all narrative directories.
 * Useful as a recovery tool or after external modifications.
 */
export function rebuildIndex(): void {
  if (!existsSync(NARRATIVES_DIR)) {
    writeIndex({ narratives: [] })
    return
  }

  const entries: IndexEntry[] = []
  for (const dirname of readdirSync(NARRATIVES_DIR)) {
    const metaPath = narrativeMetaPath(dirname)
    if (!existsSync(metaPath)) continue
    try {
      const meta = readJson<NarrativeMeta>(metaPath)
      entries.push({ id: meta.id, title: meta.title, updatedAt: meta.updatedAt })
    } catch {
      // skip malformed directories
    }
  }
  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  writeIndex({ narratives: entries })
}
