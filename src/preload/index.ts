import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  yjs: {
    listNarratives: () => ipcRenderer.invoke('yjs:list-narratives'),
    getNarrative: (id: string) => ipcRenderer.invoke('yjs:get-narrative', id),
    createNarrative: (opts?: { id?: string; title?: string; tags?: string[] }) =>
      ipcRenderer.invoke('yjs:create-narrative', opts),
    deleteNarrative: (id: string) => ipcRenderer.invoke('yjs:delete-narrative', id),
    updateMeta: (id: string, patch: { title?: string; tags?: string[] }) =>
      ipcRenderer.invoke('yjs:update-meta', id, patch),
    loadDocState: (id: string) => ipcRenderer.invoke('yjs:load-doc-state', id),
    appendUpdate: (id: string, update: Uint8Array) =>
      ipcRenderer.invoke('yjs:append-update', id, update),
    getUpdatesSince: (id: string, sinceSeq: number) =>
      ipcRenderer.invoke('yjs:get-updates-since', id, sinceSeq),
    getMaxSeq: (id: string) => ipcRenderer.invoke('yjs:get-max-seq', id),
    onRemoteUpdate: (
      cb: (payload: { narrativeId: string; seq: number; update: Uint8Array }) => void
    ) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: { narrativeId: string; seq: number; update: Uint8Array }
      ) => cb(payload)
      ipcRenderer.on('yjs:remote-update', handler)
      return () => {
        ipcRenderer.removeListener('yjs:remote-update', handler)
      }
    }
  }
})
