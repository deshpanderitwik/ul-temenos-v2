import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  narratives: {
    list: () => ipcRenderer.invoke('narratives:list'),
    get: (id: string) => ipcRenderer.invoke('narratives:get', id),
    create: (title?: string) => ipcRenderer.invoke('narratives:create', title),
    updateDraft: (narrativeId: string, content: unknown, title: string) =>
      ipcRenderer.invoke('narratives:update-draft', narrativeId, content, title),
    delete: (id: string) => ipcRenderer.invoke('narratives:delete', id),
    getLatestId: () => ipcRenderer.invoke('narratives:get-latest-id'),
    import: (items: { id: string; title: string | null; content: unknown; updated_at: string }[]) =>
      ipcRenderer.invoke('narratives:import', items),
    hasLocalData: () => ipcRenderer.invoke('narratives:has-local-data'),
    onExternalChange: (cb: (data: { filename: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { filename: string }) => cb(data)
      ipcRenderer.on('narratives:external-change', handler)
      return () => {
        ipcRenderer.removeListener('narratives:external-change', handler)
      }
    }
  }
})
