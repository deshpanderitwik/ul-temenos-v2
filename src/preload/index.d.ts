export interface NarrativeIndexEntry {
  id: string
  title: string
  updatedAt: string
}

export interface NarrativeData {
  id: string
  title: string
  activeDraftId: string
  content: unknown
}

export interface NarrativeCreateResult {
  narrativeId: string
  draftId: string
}

export interface NarrativeImportItem {
  id: string
  title: string | null
  content: unknown
  updated_at: string
}

export interface NarrativesApi {
  list(): Promise<NarrativeIndexEntry[]>
  get(id: string): Promise<NarrativeData | null>
  create(title?: string): Promise<NarrativeCreateResult>
  updateDraft(narrativeId: string, content: unknown, title: string): Promise<void>
  delete(id: string): Promise<void>
  getLatestId(): Promise<string | null>
  import(items: NarrativeImportItem[]): Promise<void>
  hasLocalData(): Promise<boolean>
  onExternalChange(cb: (data: { filename: string }) => void): () => void
}

export interface WindowApi {
  narratives: NarrativesApi
}

declare global {
  interface Window {
    api: WindowApi
  }
}
