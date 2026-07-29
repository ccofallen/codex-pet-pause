const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petShell', {
  openSettings: () => ipcRenderer.invoke('pet:open-settings'),
  openPetdex: () => ipcRenderer.invoke('pet:open-petdex'),
  onPetdexImport: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pet:petdex-import', listener);
    return () => ipcRenderer.removeListener('pet:petdex-import', listener);
  },
  notifyStateChanged: () => ipcRenderer.send('pet:state-changed'),
  onStateChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('pet:state-changed', listener);
    return () => ipcRenderer.removeListener('pet:state-changed', listener);
  },
  dockNow: () => ipcRenderer.invoke('pet:manual-dock'),
  dragWindowTo: (x, y) => ipcRenderer.send('pet:drag-window', { x, y }),
  showContextMenu: (x, y) => ipcRenderer.send('pet:show-context-menu', { x, y }),
});
