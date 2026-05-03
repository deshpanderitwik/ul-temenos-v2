export interface NarrativeIndexEntry {
  id: string
  title: string
  updatedAt: string
}

export interface NarrativeCreateResult {
  narrativeId: string
  draftId: string
}

export interface YjsNarrativeRow {
  id: string
  title: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface YjsRemoteUpdatePayload {
  narrativeId: string
  seq: number
  update: Uint8Array
}

export interface YjsApi {
  listNarratives(): Promise<YjsNarrativeRow[]>
  getNarrative(id: string): Promise<YjsNarrativeRow | null>
  createNarrative(opts?: {
    id?: string
    title?: string
    tags?: string[]
  }): Promise<YjsNarrativeRow>
  deleteNarrative(id: string): Promise<void>
  updateMeta(
    id: string,
    patch: { title?: string; tags?: string[] }
  ): Promise<void>
  loadDocState(id: string): Promise<Uint8Array>
  appendUpdate(id: string, update: Uint8Array): Promise<number>
  getUpdatesSince(
    id: string,
    sinceSeq: number
  ): Promise<Array<{ seq: number; update: Uint8Array }>>
  getMaxSeq(id: string): Promise<number>
  onRemoteUpdate(cb: (payload: YjsRemoteUpdatePayload) => void): () => void
}

export interface WindowApi {
  yjs: YjsApi
}

declare global {
  interface Window {
    api: WindowApi
  }
}
