const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let clipboard = { paths: [], action: null }; // action: 'copy' | 'cut'

function createWindow() {
  const win = new BrowserWindow({
    title: 'Sublime Explorer',
    icon: path.join(__dirname, 'icon.png'),
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html');
  return win;
}

app.whenReady().then(() => {
  try { app.dock.setIcon(path.join(__dirname, 'icon.png')); } catch (e) {}
  createWindow();

  const menuTemplate = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Réglages…', accelerator: 'CmdOrCtrl+,', click: () => {
          const focused = BrowserWindow.getFocusedWindow();
          if (focused) focused.webContents.send('open-settings');
        }},
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Fichier',
      submenu: [
        { label: 'Nouvelle fenêtre', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        { label: 'Fermer', accelerator: 'CmdOrCtrl+W', role: 'close' },
      ]
    },
    { label: 'Édition', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]},
    { label: 'Fenêtre', submenu: [
      { role: 'minimize' }, { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' }
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
});

app.on('window-all-closed', () => app.quit());

// Read directory contents
ipcMain.handle('read-dir', async (event, dirPath) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const items = entries.map(entry => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
      isHidden: entry.name.startsWith('.'),
      isSymlink: entry.isSymbolicLink()
    }));
    // Sort: directories first, then alphabetical
    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return { ok: true, items };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Resolve real path (fix case on case-insensitive fs)
ipcMain.handle('realpath', async (event, filePath) => {
  try {
    const real = await fs.promises.realpath(filePath);
    return { ok: true, path: real };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Get file stats
ipcMain.handle('stat', async (event, filePath) => {
  try {
    const stat = await fs.promises.stat(filePath);
    return {
      ok: true,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
      isDirectory: stat.isDirectory()
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Copy files
ipcMain.handle('copy-files', async (event, sources, destDir) => {
  const results = [];
  for (const src of sources) {
    const destPath = path.join(destDir, path.basename(src));
    try {
      await fs.promises.cp(src, destPath, { recursive: true });
      results.push({ ok: true, src, dest: destPath });
    } catch (err) {
      results.push({ ok: false, src, error: err.message });
    }
  }
  return results;
});

// Move files
ipcMain.handle('move-files', async (event, sources, destDir) => {
  const results = [];
  for (const src of sources) {
    const destPath = path.join(destDir, path.basename(src));
    try {
      await fs.promises.rename(src, destPath);
      results.push({ ok: true, src, dest: destPath });
    } catch (err) {
      // Cross-device move: copy + delete
      try {
        await fs.promises.cp(src, destPath, { recursive: true });
        await fs.promises.rm(src, { recursive: true });
        results.push({ ok: true, src, dest: destPath });
      } catch (err2) {
        results.push({ ok: false, src, error: err2.message });
      }
    }
  }
  return results;
});

// Delete files
ipcMain.handle('delete-files', async (event, paths) => {
  const results = [];
  for (const p of paths) {
    try {
      await shell.trashItem(p);
      results.push({ ok: true, path: p });
    } catch (err) {
      results.push({ ok: false, path: p, error: err.message });
    }
  }
  return results;
});

// Permanent delete (no trash)
ipcMain.handle('permanent-delete', async (event, paths) => {
  const results = [];
  for (const p of paths) {
    try {
      await fs.promises.rm(p, { recursive: true });
      results.push({ ok: true, path: p });
    } catch (err) {
      results.push({ ok: false, path: p, error: err.message });
    }
  }
  return results;
});

// Rename
ipcMain.handle('rename', async (event, oldPath, newName) => {
  const newPath = path.join(path.dirname(oldPath), newName);
  try {
    await fs.promises.rename(oldPath, newPath);
    return { ok: true, newPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Create directory
ipcMain.handle('mkdir', async (event, dirPath) => {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Clipboard operations
ipcMain.handle('clipboard-copy', (event, paths) => {
  clipboard = { paths, action: 'copy' };
  return { ok: true };
});

ipcMain.handle('clipboard-cut', (event, paths) => {
  clipboard = { paths, action: 'cut' };
  return { ok: true };
});

ipcMain.handle('clipboard-paste', async (event, destDir) => {
  if (!clipboard.paths.length) return { ok: false, error: 'Nothing in clipboard' };
  if (clipboard.action === 'copy') {
    const results = [];
    for (const src of clipboard.paths) {
      const destPath = path.join(destDir, path.basename(src));
      try {
        await fs.promises.cp(src, destPath, { recursive: true });
        results.push({ ok: true, src, dest: destPath });
      } catch (err) {
        results.push({ ok: false, src, error: err.message });
      }
    }
    return { ok: true, results };
  } else {
    const results = [];
    for (const src of clipboard.paths) {
      const destPath = path.join(destDir, path.basename(src));
      try {
        await fs.promises.rename(src, destPath);
        results.push({ ok: true, src, dest: destPath });
      } catch (err) {
        try {
          await fs.promises.cp(src, destPath, { recursive: true });
          await fs.promises.rm(src, { recursive: true });
          results.push({ ok: true, src, dest: destPath });
        } catch (err2) {
          results.push({ ok: false, src, error: err2.message });
        }
      }
    }
    clipboard = { paths: [], action: null };
    return { ok: true, results };
  }
});

// Read file text (for preview, max 512KB)
ipcMain.handle('read-file-text', async (event, filePath) => {
  try {
    const handle = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(512 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    await handle.close();
    return { ok: true, text: buf.toString('utf-8', 0, bytesRead) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Render markdown
ipcMain.handle('render-markdown', async (event, filePath) => {
  try {
    const { marked } = require('marked');
    let text = await fs.promises.readFile(filePath, 'utf-8');
    // Escape [N] reference-style lines so marked doesn't swallow them
    text = text.replace(/^\[(\d+)\]\s/gm, '\\[$1\\] ');
    const html = marked(text, { breaks: true });
    return { ok: true, html };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Open file with default app
ipcMain.handle('open-file', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Open with — let user pick an app via system dialog
ipcMain.handle('open-with', async (event, filePath) => {
  const result = await dialog.showOpenDialog({
    title: 'Ouvrir avec…',
    defaultPath: '/Applications',
    filters: [{ name: 'Applications', extensions: ['app'] }],
    properties: ['openFile'],
    message: `Choisir une application pour ouvrir ${path.basename(filePath)}`
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const appPath = result.filePaths[0];
    const { exec } = require('child_process');
    exec(`open -a "${appPath}" "${filePath}"`);
  }
});

// Native drag to external apps
ipcMain.on('native-drag', (event, filePaths) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  event.sender.startDrag({
    files: filePaths,
    icon: path.join(__dirname, 'drag-icon.png')
  });
});

// Reveal in Finder
ipcMain.handle('reveal-in-finder', (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Open in terminal
ipcMain.handle('open-in-terminal', (event, dirPath) => {
  const { exec } = require('child_process');
  exec(`open -a iTerm "${dirPath}"`);
});

// Settings
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const defaultSettings = {
  startPath: 'last',
  showHidden: true,
  showPreview: true,
  previewFontSize: 14,
  lastPath: '',
  treeWidth: 280,
  previewWidth: 250
};

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return { ...defaultSettings, ...saved };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (event, settings) => {
  saveSettings(settings);
  return { ok: true };
});

// Favorites
const favoritesPath = path.join(app.getPath('userData'), 'favorites.json');

ipcMain.handle('get-favorites', () => {
  try {
    return JSON.parse(fs.readFileSync(favoritesPath, 'utf-8'));
  } catch {
    return [];
  }
});

ipcMain.handle('save-favorites', (event, favs) => {
  fs.writeFileSync(favoritesPath, JSON.stringify(favs, null, 2));
  return { ok: true };
});

// Watch directory (per window)
const watchers = new Map();
ipcMain.handle('watch-dir', (event, dirPath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const id = win.id;
  if (watchers.has(id)) watchers.get(id).close();
  try {
    const watcher = fs.watch(dirPath, { persistent: false }, () => {
      if (!win.isDestroyed()) win.webContents.send('dir-changed');
    });
    watchers.set(id, watcher);
    win.on('closed', () => { if (watchers.has(id)) { watchers.get(id).close(); watchers.delete(id); } });
  } catch (err) {
    // Ignore watch errors
  }
});

// Home directory
ipcMain.handle('get-home', () => {
  return require('os').homedir();
});

// List external volumes
ipcMain.handle('get-volumes', async () => {
  try {
    const entries = await fs.promises.readdir('/Volumes', { withFileTypes: true });
    const volumes = entries
      .filter(e => e.name !== 'Macintosh HD')
      .map(e => ({ name: e.name, path: '/Volumes/' + e.name }));
    return { ok: true, volumes };
  } catch (err) {
    return { ok: false, volumes: [] };
  }
});

// Set window title
ipcMain.handle('set-title', (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setTitle(title);
});

// Window snap (split screen)
ipcMain.handle('snap-window', (event, side) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const { screen } = require('electron');
  const display = screen.getDisplayNearestPoint(win.getBounds());
  const { x, y, width, height } = display.workArea;

  if (side === 'left') {
    win.setBounds({ x, y, width: Math.floor(width / 2), height });
  } else if (side === 'right') {
    win.setBounds({ x: x + Math.floor(width / 2), y, width: Math.floor(width / 2), height });
  } else if (side === 'maximize') {
    win.setBounds({ x, y, width, height });
  }
});
