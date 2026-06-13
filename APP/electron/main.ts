import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';

let mainWindow: BrowserWindow | null;
let pythonProcess: ChildProcess | null = null;
let devicePollInterval: NodeJS.Timeout | null = null;
let lastDriveRoots: string[] = [];

function getAvailableDriveRoots(): string[] {
  const roots: string[] = [];
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`;
    try {
      fs.readdirSync(root);
      roots.push(root);
    } catch {
      // drive not accessible
    }
  }
  return roots;
}

function startDevicePolling() {
  lastDriveRoots = getAvailableDriveRoots();
  devicePollInterval = setInterval(() => {
    const current = getAvailableDriveRoots();
    const added   = current.filter(r => !lastDriveRoots.includes(r));
    const removed = lastDriveRoots.filter(r => !current.includes(r));
    if (added.length > 0 || removed.length > 0) {
      lastDriveRoots = current;
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('device:changed', { availableRoots: current, added, removed });
      });
    }
  }, 2000);
}

function stopDevicePolling() {
  if (devicePollInterval) {
    clearInterval(devicePollInterval);
    devicePollInterval = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
    },
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.on('window:close',    () => mainWindow?.close());
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});

ipcMain.handle('dialog:selectDirectory', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('dialog:selectFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile']
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });

ipcMain.handle('dialog:selectFiles', async (_event, options?: { filters?: { name: string; extensions: string[] }[] }) => {
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
    };
    if (options?.filters) {
      dialogOptions.filters = options.filters;
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, dialogOptions);
    if (canceled) return [];
    return filePaths;
  });

ipcMain.handle('drive:getAvailableRoots', () => {
  return getAvailableDriveRoots();
});

ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
  const normalized = filePath.replace(/\//g, '\\');
  const err = await shell.openPath(normalized);
  return err || null;
});

ipcMain.handle('shell:showItemInFolder', (_event, filePath: string) => {
  const normalized = filePath.replace(/\//g, '\\');
  shell.showItemInFolder(normalized);
});

function startPythonBackend() {
  const isDev = !app.isPackaged;
  let scriptPath: string;
  let command: string;
  let args: string[] = [];

  if (isDev) {
    command = 'python';
    scriptPath = path.join(__dirname, '../src/main.py');
    args = [scriptPath];
  } else {
    scriptPath = path.join(process.resourcesPath, 'backend/backend.exe');
    command = scriptPath;
    args = [];
  }

  // Always pass the data directory explicitly so dev and prod use the same location.
  const dataDir = isDev
    ? path.join(__dirname, '../data')
    : path.join(process.resourcesPath, 'backend', 'data');

  console.log(`Starting Python backend: ${command} ${args.join(' ')} (data: ${dataDir})`);

  pythonProcess = spawn(command, args, {
    env: { ...process.env, APP_DATA_DIR: dataDir },
  });

  pythonProcess.stdout?.on('data', (data) => {
    console.log(`[Python stdout]: ${data}`);
  });

  pythonProcess.stderr?.on('data', (data) => {
    console.error(`[Python stderr]: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
  });
}

function stopPythonBackend() {
  if (pythonProcess) {
    console.log('Stopping Python backend...');
    pythonProcess.kill();
    pythonProcess = null;
  }
}

app.whenReady().then(() => {
  startPythonBackend();
  createWindow();
  startDevicePolling();

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

app.on('will-quit', () => {
  stopPythonBackend();
  stopDevicePolling();
});
