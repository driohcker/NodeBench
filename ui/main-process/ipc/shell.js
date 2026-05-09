const { ipcMain, shell } = require('electron');
const fs = require('fs');

function register() {
    ipcMain.handle('shell:openPath', async (event, filePath) => {
        try {
            if (!fs.existsSync(filePath)) {
                return { success: false, error: '文件不存在' };
            }
            const result = await shell.openPath(filePath);
            if (result !== '') {
                return { success: false, error: result };
            }
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
