import { app, BrowserWindow, ipcMain, dialog } from 'electron';
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
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

ipcMain.handle('drive:getAvailableRoots', () => {
  return getAvailableDriveRoots();
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
    // In production, the backend is a compiled executable in resources
    scriptPath = path.join(process.resourcesPath, 'backend/backend.exe');
    command = scriptPath;
    args = [];
  }

  console.log(`Starting Python backend: ${command} ${args.join(' ')}`);

  pythonProcess = spawn(command, args);

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
