const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  readDir: (dirPath) => ipcRenderer.invoke('read-dir', dirPath),
  realpath: (filePath) => ipcRenderer.invoke('realpath', filePath),
  stat: (filePath) => ipcRenderer.invoke('stat', filePath),
  copyFiles: (sources, destDir) => ipcRenderer.invoke('copy-files', sources, destDir),
  moveFiles: (sources, destDir) => ipcRenderer.invoke('move-files', sources, destDir),
  deleteFiles: (paths) => ipcRenderer.invoke('delete-files', paths),
  permanentDelete: (paths) => ipcRenderer.invoke('permanent-delete', paths),
  rename: (oldPath, newName) => ipcRenderer.invoke('rename', oldPath, newName),
  mkdir: (dirPath) => ipcRenderer.invoke('mkdir', dirPath),
  clipboardCopy: (paths) => ipcRenderer.invoke('clipboard-copy', paths),
  clipboardCut: (paths) => ipcRenderer.invoke('clipboard-cut', paths),
  clipboardPaste: (destDir) => ipcRenderer.invoke('clipboard-paste', destDir),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  readFileText: (filePath) => ipcRenderer.invoke('read-file-text', filePath),
  renderMarkdown: (filePath) => ipcRenderer.invoke('render-markdown', filePath),
  revealInFinder: (filePath) => ipcRenderer.invoke('reveal-in-finder', filePath),
  openInTerminal: (dirPath) => ipcRenderer.invoke('open-in-terminal', dirPath),
  getHome: () => ipcRenderer.invoke('get-home'),
  getFavorites: () => ipcRenderer.invoke('get-favorites'),
  saveFavorites: (favs) => ipcRenderer.invoke('save-favorites', favs),
  watchDir: (dirPath) => ipcRenderer.invoke('watch-dir', dirPath),
  onDirChanged: (callback) => ipcRenderer.on('dir-changed', callback),
  snapWindow: (side) => ipcRenderer.invoke('snap-window', side),
  setTitle: (title) => ipcRenderer.invoke('set-title', title)
});
