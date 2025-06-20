const { contextBridge, ipcRenderer } = require('electron');

// Expose secure, sandboxed APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Functions the renderer can call
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  setDownloadPath: () => ipcRenderer.invoke('set-download-path'),
  saveFile: ({ fileName, dataBuffer }) => ipcRenderer.invoke('save-file', { fileName, dataBuffer }),

  // A way for the main process to talk to the renderer
  onDownloadPathUpdate: (callback) => ipcRenderer.on('download-path-updated', (_event, value) => callback(value))
});