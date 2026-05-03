import type {
  NarrativeIndexEntry,
  NarrativeCreateResult,
  YjsNarrativeRow
} from '../../../preload/index.d'

export type { NarrativeIndexEntry, NarrativeCreateResult }

function yjsRowToIndexEntry(row: YjsNarrativeRow): NarrativeIndexEntry {
  return { id: row.id, title: row.title, updatedAt: row.updatedAt }
}

export async function listNarratives(): Promise<NarrativeIndexEntry[]> {
  const rows = await window.api.yjs.listNarratives()
  return rows.map(yjsRowToIndexEntry)
}

export async function createNarrative(title?: string): Promise<NarrativeCreateResult> {
  const row = await window.api.yjs.createNarrative({ title: title ?? 'Untitled' })
  // Preserve the legacy return shape so callers don't need to change.
  // draftId is no longer meaningful in the Yjs world; return the narrative
  // id as a placeholder.
  return { narrativeId: row.id, draftId: row.id }
}

export function deleteNarrative(id: string): Promise<void> {
  return window.api.yjs.deleteNarrative(id)
}

export function renameNarrative(id: string, title: string): Promise<void> {
  return window.api.yjs.updateMeta(id, { title })
}

export async function getLatestNarrativeId(): Promise<string | null> {
  const rows = await window.api.yjs.listNarratives()
  return rows.length > 0 ? rows[0].id : null
}

export async function hasLocalData(): Promise<boolean> {
  const rows = await window.api.yjs.listNarratives()
  return rows.length > 0
}
