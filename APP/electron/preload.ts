import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  selectFile: () => ipcRenderer.invoke('dialog:selectFile'),
  onDeviceChange: (callback: (payload: { availableRoots: string[]; added: string[]; removed: string[] }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: { availableRoots: string[]; added: string[]; removed: string[] }) => callback(payload);
    ipcRenderer.on('device:changed', listener);
    return () => ipcRenderer.removeListener('device:changed', listener);
  },
  getAvailableRoots: () => ipcRenderer.invoke('drive:getAvailableRoots'),
});
