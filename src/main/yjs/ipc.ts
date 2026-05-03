import { ipcMain, BrowserWindow } from 'electron'
import * as persistence from './persistence'
import { schedulePush, schedulePushDelete } from '../sync'

export function registerYjsIpcHandlers(): void {
  ipcMain.handle('yjs:list-narratives', () => persistence.listNarratives())

  ipcMain.handle('yjs:get-narrative', (_e, id: string) =>
    persistence.getNarrative(id)
  )

  ipcMain.handle(
    'yjs:create-narrative',
    (_e, opts?: { id?: string; title?: string; tags?: string[] }) =>
      persistence.createNarrative(opts)
  )

  ipcMain.handle('yjs:delete-narrative', (_e, id: string) => {
    persistence.deleteNarrative(id)
    schedulePushDelete(id)
  })

  ipcMain.handle(
    'yjs:update-meta',
    (_e, id: string, patch: { title?: string; tags?: string[] }) => {
      persistence.updateNarrativeMeta(id, patch)
    }
  )

  ipcMain.handle('yjs:load-doc-state', (_e, id: string) => {
    return persistence.loadDocState(id)
  })

  ipcMain.handle(
    'yjs:append-update',
    (event, id: string, update: Uint8Array) => {
      const seq = persistence.appendUpdate(id, update)
      const sender = BrowserWindow.fromWebContents(event.sender)
      for (const w of BrowserWindow.getAllWindows()) {
        if (w !== sender) {
          w.webContents.send('yjs:remote-update', {
            narrativeId: id,
            seq,
            update
          })
        }
      }
      schedulePush(id)
      return seq
    }
  )

  ipcMain.handle(
    'yjs:get-updates-since',
    (_e, id: string, sinceSeq: number) => {
      return persistence.getUpdatesSince(id, sinceSeq)
    }
  )

  ipcMain.handle('yjs:get-max-seq', (_e, id: string) =>
    persistence.getMaxSeq(id)
  )
}
