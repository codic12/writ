const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    frame: isMac,
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundColor: isMac ? '#00000000' : '#ffffff',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: true,
    },
  });

  win.loadFile('index.html');

  // Context Menu for Spellcheck
  win.webContents.on('context-menu', (event, params) => {
    const menu = new Menu();

    // Add suggestions for misspelled words
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion)
      }));
    }

    // Allow users to add to dictionary
    if (params.misspelledWord) {
      menu.append(new MenuItem({
        label: 'Add to Dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Standard Edit Actions
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
    }

    if (menu.items.length > 0) {
      menu.popup();
    }
  });
}

// IPC Handlers for Window Controls
ipcMain.on('window-minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});

ipcMain.on('window-close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

// IPC Handlers for File I/O
ipcMain.handle('save-file', async (event, content, defaultPath) => {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: defaultPath || 'Untitled.txt',
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'HTML', extensions: ['html'] },
      { name: 'Text', extensions: ['txt'] }
    ]
  });
  if (filePath) {
    fs.writeFileSync(filePath, content);
    return filePath;
  }
  return null;
});

ipcMain.handle('open-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Allowed Files', extensions: ['txt', 'md', 'html'] }]
  });
  if (filePaths && filePaths.length > 0) {
    const content = fs.readFileSync(filePaths[0], 'utf-8');
    return { content, filePath: filePaths[0] };
  }
  return null;
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
