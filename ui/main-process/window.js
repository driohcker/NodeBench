const { BrowserWindow } = require('electron');
const path = require('path');
const state = require('./state');

function createWindow() {
    state.mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1100,
        minHeight: 700,
        webPreferences: {
            preload: path.join(__dirname, '..', 'js', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
        },
        titleBarStyle: state.isMac ? 'hidden' : 'default',
        trafficLightPosition: state.isMac ? { x: 15, y: 15 } : undefined,
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
        show: false,
    });

    state.mainWindow.loadFile(path.join(__dirname, '..', 'view', 'index.html'));

    state.mainWindow.once('ready-to-show', () => {
        state.mainWindow.show();
    });

    state.mainWindow.webContents.on('console-message', (event, level, message) => {
        if (message.includes('pollSystemStats') || message.includes('systemStatsHistory')) {
            console.log('[RENDERER]', message);
        }
    });
}

module.exports = { createWindow };
