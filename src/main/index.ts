import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { ensureStoreDir } from './store'
import { registerIpcHandlers, startFileWatcher, stopFileWatcher } from './ipc'
import { startSync, stopSync, syncNow } from './sync'

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
  ensureStoreDir()
  registerIpcHandlers()
  startFileWatcher()
  startSync()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopSync()
  stopFileWatcher()
  if (process.platform !== 'darwin') app.quit()
})
