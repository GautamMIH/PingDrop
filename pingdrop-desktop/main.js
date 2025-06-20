const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// Initialize store for persisting data like the download path
const store = new Store();

// --- Create the Main Window ---
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    title: 'PingDrop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // icon: path.join(__dirname, 'assets/icon.ico') 
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
  // mainWindow.webContents.openDevTools();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// --- App Lifecycle Events ---
app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


// --- IPC Handlers for File System Access ---

// Renderer asks for the saved download path
ipcMain.handle('get-download-path', () => {
  return store.get('downloadPath');
});

// Renderer asks to open the folder selection dialog
ipcMain.handle('set-download-path', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (canceled || filePaths.length === 0) {
    return null;
  }
  const selectedPath = filePaths[0];
  store.set('downloadPath', selectedPath);
  // Notify all windows of the change
  event.sender.send('download-path-updated', selectedPath);
  return selectedPath;
});

// Renderer sends a file to be saved to the disk
ipcMain.handle('save-file', async (event, { fileName, dataBuffer }) => {
  const downloadPath = store.get('downloadPath');
  if (!downloadPath) {
    return { success: false, error: 'Download path not set.' };
  }
  
  const fullPath = path.join(downloadPath, fileName);

  try {
    // Check if file already exists and add a suffix if it does
    let finalPath = fullPath;
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      const dir = path.dirname(fullPath);
      const ext = path.extname(fullPath);
      const baseName = path.basename(fullPath, ext);
      finalPath = path.join(dir, `${baseName} (${counter})${ext}`);
      counter++;
    }
    
    // Write the file
    await fs.promises.writeFile(finalPath, Buffer.from(dataBuffer));
    return { success: true, path: finalPath };
  } catch (error) {
    console.error('Failed to save file:', error);
    return { success: false, error: error.message };
  }
});