import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  close:    () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  selectFile: () => ipcRenderer.invoke('dialog:selectFile'),
  selectFiles: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('dialog:selectFiles', options),
  onDeviceChange: (callback: (payload: { availableRoots: string[]; added: string[]; removed: string[] }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: { availableRoots: string[]; added: string[]; removed: string[] }) => callback(payload);
    ipcRenderer.on('device:changed', listener);
    return () => ipcRenderer.removeListener('device:changed', listener);
  },
  getAvailableRoots: () => ipcRenderer.invoke('drive:getAvailableRoots'),
});
