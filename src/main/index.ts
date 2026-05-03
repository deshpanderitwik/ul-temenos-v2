import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { startSync, stopSync, syncNow } from './sync'
import { initDb, closeDb, getDbPath } from './yjs/db'
import { registerYjsIpcHandlers } from './yjs/ipc'
import { migrateLegacyNarratives, summarizeReport } from './yjs/migrate'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#141414',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.maximize()
  mainWindow.show()

  mainWindow.on('focus', () => {
    syncNow()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDb()
  console.log('[temenos] sqlite ready at', getDbPath())
  try {
    const report = migrateLegacyNarratives()
    if (report.results.length > 0) {
      console.log(summarizeReport(report))
    }
  } catch (err) {
    console.error('[temenos] migration crashed (non-fatal):', err)
  }
  registerYjsIpcHandlers()
  startSync()
  createWindow()

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('Auto-update check failed:', err)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopSync()
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})
