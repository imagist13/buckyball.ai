const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserPoc', {
  setBounds: (bounds) => ipcRenderer.invoke('browser-poc:set-bounds', bounds),
  navigate: (url) => ipcRenderer.invoke('browser-poc:navigate', url),
  setOverlayOpen: (open) => ipcRenderer.invoke('browser-poc:set-overlay-open', open),
  crashGuest: () => ipcRenderer.invoke('browser-poc:crash-guest'),
  getStatus: () => ipcRenderer.invoke('browser-poc:get-status'),
});
