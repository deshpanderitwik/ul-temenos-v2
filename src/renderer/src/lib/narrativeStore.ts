import type { NarrativeIndexEntry, NarrativeData, NarrativeCreateResult, NarrativeImportItem } from '../../../preload/index.d'

export type { NarrativeIndexEntry, NarrativeData, NarrativeCreateResult, NarrativeImportItem }

export function listNarratives(): Promise<NarrativeIndexEntry[]> {
  return window.api.narratives.list()
}

export function getNarrative(id: string): Promise<NarrativeData | null> {
  return window.api.narratives.get(id)
}

export function createNarrative(title?: string): Promise<NarrativeCreateResult> {
  return window.api.narratives.create(title)
}

export function updateDraft(narrativeId: string, content: unknown, title: string): Promise<void> {
  return window.api.narratives.updateDraft(narrativeId, content, title)
}

export function deleteNarrative(id: string): Promise<void> {
  return window.api.narratives.delete(id)
}

export function getLatestNarrativeId(): Promise<string | null> {
  return window.api.narratives.getLatestId()
}

export function importNarratives(items: NarrativeImportItem[]): Promise<void> {
  return window.api.narratives.import(items)
}

export function hasLocalData(): Promise<boolean> {
  return window.api.narratives.hasLocalData()
}

export function onExternalChange(cb: (data: { filename: string }) => void): () => void {
  return window.api.narratives.onExternalChange(cb)
}
