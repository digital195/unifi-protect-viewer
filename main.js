// Modules to control application life and create native browser window
const {app, BrowserWindow, ipcMain} = require('electron');
const path = require('path');
const Store = require('electron-store');



// persistent store
const store = new Store();



// cause self-signed certificate
app.commandLine.appendSwitch('ignore-certificate-errors', true);



// dev
try {
  require('electron-reloader')(module)
} catch (_) {}



// event handlers
function handleReset(event) {
  store.delete('config');
}

function handleRestart(event) {
  app.quit();
  app.relaunch();
}

async function handleConfigLoad(event) {
  return store.get('config');
}

function handleConfigSave(event, config) {
  store.set('config', config);
}

// window handler
function handleWindow(mainWindow) {
  mainWindow.loadFile('./src/html/index.html');

  if (store.has('config')) {
    mainWindow.loadURL(store.get('config').url);
  } else {
    mainWindow.loadFile('./src/html/config.html');
  }
}



function createWindow () {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 750,
    webPreferences: {
      nodeIntegration: false,
      spellcheck: true,
      preload: path.join(__dirname, '/src/js/preload.js'),
      allowDisplayingInsecureContent: true,
      allowRunningInsecureContent: true
    },

    icon: path.join(__dirname, '/src/img/128.png'),

    frame: true,
    movable: true,
    resizable: true,
    closable: true,
    darkTheme: false,
    autoHideMenuBar: true,
  });

  mainWindow.setTitle('UnifiProtect Viewer');

  mainWindow.on('page-title-updated', function(e) {
    e.preventDefault()
  });

  // and load the index.html of the app.
  handleWindow(mainWindow);
}



// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  ipcMain.on('reset', handleReset);
  ipcMain.on('restart', handleRestart);
  ipcMain.on('configSave', handleConfigSave);

  ipcMain.handle('configLoad', handleConfigLoad)

  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  });
});



// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})



// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.


