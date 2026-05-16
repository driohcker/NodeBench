const { ipcMain } = require('electron');
const state = require('../state');

function register() {
    ipcMain.handle('config:get', async () => {
        try {
            return { success: true, data: state.services.config.getAll() };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('config:set', async (event, changes) => {
        try {
            return state.services.config.update(changes);
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('config:reset', async () => {
        try {
            return state.services.config.resetToDefaults();
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('config:stats', async () => {
        try {
            return { success: true, data: state.services.config.getStats() };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
