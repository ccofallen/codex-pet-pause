const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petShell', {
  openSettings: () => ipcRenderer.invoke('pet:open-settings'),
  dockNow: () => ipcRenderer.invoke('pet:manual-dock'),
  dragWindowTo: (x, y) => ipcRenderer.send('pet:drag-window', { x, y }),
  showContextMenu: (x, y) => ipcRenderer.send('pet:show-context-menu', { x, y }),
});
