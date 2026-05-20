const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem, shell } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    frame: isMac,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: true,
    },
  });

  win.loadFile('index.html');

  // Application Menu
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => win.webContents.send('menu-action', 'new-note') },
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => win.webContents.send('menu-action', 'open-file') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => win.webContents.send('menu-action', 'save-file') },
        {
          label: 'Export As',
          submenu: [
            { label: 'Markdown', click: () => win.webContents.send('menu-action', 'export-md') },
            { label: 'HTML', click: () => win.webContents.send('menu-action', 'export-html') }
          ]
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+P', click: () => win.webContents.send('menu-action', 'toggle-palette') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: () => win.webContents.send('menu-action', 'toggle-sidebar') },
        { label: 'Toggle Focus Mode', accelerator: 'CmdOrCtrl+F', click: () => win.webContents.send('menu-action', 'toggle-focus') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  if (isMac) {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Preferences...', accelerator: 'CmdOrCtrl+,', click: () => win.webContents.send('menu-action', 'open-preferences') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  } else {
      template[0].submenu.push(
          { type: 'separator' },
          { label: 'Preferences...', accelerator: 'CmdOrCtrl+,', click: () => win.webContents.send('menu-action', 'open-preferences') }
      );
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Context Menu for Spellcheck
  win.webContents.on('context-menu', (event, params) => {
    const contextMenu = new Menu();
    for (const suggestion of params.dictionarySuggestions) {
        contextMenu.append(new MenuItem({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion)
      }));
    }
    if (params.misspelledWord) {
        contextMenu.append(new MenuItem({
        label: 'Add to Dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }));
      contextMenu.append(new MenuItem({ type: 'separator' }));
    }
    if (params.isEditable) {
        contextMenu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
        contextMenu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
        contextMenu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
    }
    if (contextMenu.items.length > 0) {
        contextMenu.popup();
    }
  });
}

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
