import * as Y from 'yjs'
import { randomUUID } from 'node:crypto'
import { openDb } from './db'

export type NarrativeRow = {
  id: string
  title: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type UpdateRow = {
  seq: number
  update: Uint8Array
}

function now(): string {
  return new Date().toISOString()
}

function rowToNarrative(r: {
  id: string
  title: string
  tags_json: string
  created_at: string
  updated_at: string
}): NarrativeRow {
  return {
    id: r.id,
    title: r.title,
    tags: JSON.parse(r.tags_json) as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

export function listNarratives(): NarrativeRow[] {
  const db = openDb()
  const rows = db
    .prepare(
      'SELECT id, title, tags_json, created_at, updated_at FROM narratives ORDER BY updated_at DESC'
    )
    .all() as Array<{
    id: string
    title: string
    tags_json: string
    created_at: string
    updated_at: string
  }>
  return rows.map(rowToNarrative)
}

export function getNarrative(id: string): NarrativeRow | null {
  const db = openDb()
  const row = db
    .prepare(
      'SELECT id, title, tags_json, created_at, updated_at FROM narratives WHERE id = ?'
    )
    .get(id) as
    | {
        id: string
        title: string
        tags_json: string
        created_at: string
        updated_at: string
      }
    | undefined
  return row ? rowToNarrative(row) : null
}

export function createNarrative(opts?: {
  id?: string
  title?: string
  tags?: string[]
}): NarrativeRow {
  const db = openDb()
  const id = opts?.id ?? randomUUID()
  const title = opts?.title ?? 'Untitled'
  const tags = opts?.tags ?? []
  const ts = now()
  db.prepare(
    'INSERT INTO narratives (id, title, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, title, JSON.stringify(tags), ts, ts)
  return { id, title, tags, createdAt: ts, updatedAt: ts }
}

export function deleteNarrative(id: string): void {
  const db = openDb()
  db.prepare('DELETE FROM narratives WHERE id = ?').run(id)
}

export function updateNarrativeMeta(
  id: string,
  patch: { title?: string; tags?: string[] }
): void {
  const db = openDb()
  const ts = now()
  if (patch.title !== undefined && patch.tags !== undefined) {
    db.prepare(
      'UPDATE narratives SET title = ?, tags_json = ?, updated_at = ? WHERE id = ?'
    ).run(patch.title, JSON.stringify(patch.tags), ts, id)
  } else if (patch.title !== undefined) {
    db.prepare(
      'UPDATE narratives SET title = ?, updated_at = ? WHERE id = ?'
    ).run(patch.title, ts, id)
  } else if (patch.tags !== undefined) {
    db.prepare(
      'UPDATE narratives SET tags_json = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(patch.tags), ts, id)
  }
}

export function appendUpdate(narrativeId: string, update: Uint8Array): number {
  const db = openDb()
  const ts = now()
  const tx = db.transaction((nid: string, blob: Uint8Array, t: string) => {
    const row = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM narrative_updates WHERE narrative_id = ?'
      )
      .get(nid) as { max_seq: number }
    const nextSeq = row.max_seq + 1
    db.prepare(
      'INSERT INTO narrative_updates (narrative_id, seq, update_blob, created_at) VALUES (?, ?, ?, ?)'
    ).run(nid, nextSeq, Buffer.from(blob), t)
    db.prepare('UPDATE narratives SET updated_at = ? WHERE id = ?').run(t, nid)
    return nextSeq
  })
  return tx(narrativeId, update, ts)
}

export function loadDoc(narrativeId: string): Y.Doc {
  const db = openDb()
  const doc = new Y.Doc()
  const rows = db
    .prepare(
      'SELECT update_blob FROM narrative_updates WHERE narrative_id = ? ORDER BY seq ASC'
    )
    .all(narrativeId) as Array<{ update_blob: Buffer }>
  for (const r of rows) {
    Y.applyUpdate(doc, new Uint8Array(r.update_blob))
  }
  return doc
}

export function loadDocState(narrativeId: string): Uint8Array {
  const doc = loadDoc(narrativeId)
  return Y.encodeStateAsUpdate(doc)
}

export function getUpdatesSince(
  narrativeId: string,
  sinceSeq: number
): UpdateRow[] {
  const db = openDb()
  const rows = db
    .prepare(
      'SELECT seq, update_blob FROM narrative_updates WHERE narrative_id = ? AND seq > ? ORDER BY seq ASC'
    )
    .all(narrativeId, sinceSeq) as Array<{ seq: number; update_blob: Buffer }>
  return rows.map((r) => ({ seq: r.seq, update: new Uint8Array(r.update_blob) }))
}

export function getMaxSeq(narrativeId: string): number {
  const db = openDb()
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM narrative_updates WHERE narrative_id = ?'
    )
    .get(narrativeId) as { max_seq: number }
  return row.max_seq
}

export type SyncState = {
  narrativeId: string
  lastPushedSeq: number
  lastPulledRemoteId: number
}

export function getSyncState(narrativeId: string): SyncState {
  const db = openDb()
  const row = db
    .prepare(
      'SELECT narrative_id, last_pushed_seq, last_pulled_remote_id FROM sync_state WHERE narrative_id = ?'
    )
    .get(narrativeId) as
    | { narrative_id: string; last_pushed_seq: number; last_pulled_remote_id: number }
    | undefined
  if (!row) {
    return { narrativeId, lastPushedSeq: 0, lastPulledRemoteId: 0 }
  }
  return {
    narrativeId: row.narrative_id,
    lastPushedSeq: row.last_pushed_seq,
    lastPulledRemoteId: row.last_pulled_remote_id
  }
}

export function setSyncState(
  narrativeId: string,
  patch: { lastPushedSeq?: number; lastPulledRemoteId?: number }
): void {
  const db = openDb()
  const current = getSyncState(narrativeId)
  const next = {
    lastPushedSeq: Math.max(current.lastPushedSeq, patch.lastPushedSeq ?? current.lastPushedSeq),
    lastPulledRemoteId: Math.max(
      current.lastPulledRemoteId,
      patch.lastPulledRemoteId ?? current.lastPulledRemoteId
    )
  }
  db.prepare(
    `INSERT INTO sync_state (narrative_id, last_pushed_seq, last_pulled_remote_id)
     VALUES (?, ?, ?)
     ON CONFLICT(narrative_id) DO UPDATE SET
       last_pushed_seq = excluded.last_pushed_seq,
       last_pulled_remote_id = excluded.last_pulled_remote_id`
  ).run(narrativeId, next.lastPushedSeq, next.lastPulledRemoteId)
}

/**
 * Apply a remote update to the local Y.Doc log AND mark it as already-pushed
 * so the next push cycle doesn't ship it back to the server.
 *
 * Returns the local seq assigned to the appended update.
 */
export function applyRemoteUpdate(narrativeId: string, update: Uint8Array): number {
  const seq = appendUpdate(narrativeId, update)
  setSyncState(narrativeId, { lastPushedSeq: seq })
  return seq
}

export type CompactionResult = {
  from: number
  to: number
  skipped?: 'nothing-to-compact' | 'unsynced-changes'
}

/**
 * Replace all of a narrative's updates with a single snapshot encoded from
 * its current state. Bounds the log size; safe because Yjs updates can be
 * collapsed without changing the document.
 *
 * Gating: only compacts when every local update has already been pushed to
 * remote. Compacting unsynced changes would rewrite the seq numbers and could
 * cause those changes to be missed by the next push cycle.
 */
export function compactNarrative(narrativeId: string): CompactionResult {
  const db = openDb()
  const max = getMaxSeq(narrativeId)
  if (max <= 1) return { from: max, to: max, skipped: 'nothing-to-compact' }

  const { lastPushedSeq } = getSyncState(narrativeId)
  if (lastPushedSeq < max) {
    return { from: max, to: max, skipped: 'unsynced-changes' }
  }

  const doc = loadDoc(narrativeId)
  const snapshot = Y.encodeStateAsUpdate(doc)
  const ts = now()

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM narrative_updates WHERE narrative_id = ?').run(narrativeId)
    db.prepare(
      'INSERT INTO narrative_updates (narrative_id, seq, update_blob, created_at) VALUES (?, 1, ?, ?)'
    ).run(narrativeId, Buffer.from(snapshot), ts)
    // Force last_pushed_seq to 1 directly (bypassing setSyncState's max()
    // clamp). After compaction the seq numbers are reset, so any future seq
    // > 1 is a genuinely unsynced edit that we DO want push to find.
    db.prepare(
      `INSERT INTO sync_state (narrative_id, last_pushed_seq) VALUES (?, 1)
       ON CONFLICT(narrative_id) DO UPDATE SET last_pushed_seq = 1`
    ).run(narrativeId)
  })
  tx()

  return { from: max, to: 1 }
}
