import { ipcMain, BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import * as store from './store'
import { schedulePush, schedulePushDelete, syncNow } from './sync'

let watcher: FSWatcher | null = null
let selfWriteUntil = 0
const SELF_WRITE_WINDOW_MS = 500

function markSelfWrite(): void {
  selfWriteUntil = Date.now() + SELF_WRITE_WINDOW_MS
}

function isSelfWrite(): boolean {
  return Date.now() < selfWriteUntil
}

export function registerIpcHandlers(): void {
  ipcMain.handle('narratives:list', () => {
    return store.listNarratives()
  })

  ipcMain.handle('narratives:get', (_e, id: string) => {
    return store.getNarrative(id)
  })

  ipcMain.handle('narratives:create', (_e, title?: string) => {
    markSelfWrite()
    const result = store.createNarrative(title)
    schedulePush(result.narrativeId)
    return result
  })

  ipcMain.handle('narratives:update-draft', (_e, narrativeId: string, content: unknown, title: string) => {
    markSelfWrite()
    store.updateDraft(narrativeId, content, title)
    schedulePush(narrativeId)
  })

  ipcMain.handle('narratives:delete', (_e, id: string) => {
    markSelfWrite()
    store.deleteNarrative(id)
    schedulePushDelete(id)
  })

  ipcMain.handle('narratives:get-latest-id', () => {
    return store.getLatestNarrativeId()
  })

  ipcMain.handle('narratives:import', (_e, items: { id: string; title: string | null; content: unknown; updated_at: string }[]) => {
    store.importNarratives(items)
  })

  ipcMain.handle('narratives:has-local-data', () => {
    return store.listNarratives().length > 0
  })

  ipcMain.handle('narratives:sync-now', () => {
    syncNow()
  })
}

export function startFileWatcher(): void {
  if (watcher) return

  const dir = store.getStoreDir()
  try {
    watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return
      if (isSelfWrite()) return
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        win.webContents.send('narratives:external-change', { filename })
      }
    })
  } catch {
    // fs.watch with recursive may not be supported on all platforms
  }
}

export function stopFileWatcher(): void {
  watcher?.close()
  watcher = null
}
