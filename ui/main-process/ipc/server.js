const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const state = require('../state');

function register() {
    ipcMain.handle('server:start', async () => {
        try {
            const cmd = await state.services.serv.getCommand();
            await cmd.controller.startExpressService();
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('server:stop', async () => {
        try {
            const cmd = await state.services.serv.getCommand();
            await cmd.controller.stopExpressService();
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('server:status', async () => {
        try {
            const cmd = await state.services.serv.getCommand();
            const status = await cmd.controller.getStatusExpressService();
            return { success: true, data: status };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('server:config', async () => {
        try {
            const cmd = await state.services.serv.getCommand();
            const conf = await cmd.controller.getConfig();
            return { success: true, data: conf };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('server:methods', async () => {
        try {
            const methodsDir = path.join(process.cwd(), 'scripts', 'server_methods');
            if (!fs.existsSync(methodsDir)) return { success: true, data: [] };
            const files = fs.readdirSync(methodsDir)
                .filter(f => f.endsWith('_method.js'))
                .map(f => {
                    const fp = path.join(methodsDir, f);
                    const stat = fs.statSync(fp);
                    return {
                        name: f.replace('_method.js', ''),
                        fileName: f,
                        path: fp,
                        size: stat.size,
                        modified: stat.mtime.toISOString()
                    };
                })
                .sort((a, b) => new Date(b.modified) - new Date(a.modified));
            return { success: true, data: files };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('server:readMethod', async (event, methodName) => {
        try {
            const methodsDir = path.join(process.cwd(), 'scripts', 'server_methods');
            const filePath = path.join(methodsDir, `${methodName}_method.js`);
            if (!fs.existsSync(filePath)) {
                return { success: false, error: '方法文件不存在' };
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            const stats = fs.statSync(filePath);
            return { success: true, data: { name: methodName, content, size: stats.size, modified: stats.mtime.toISOString() } };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('server:saveMethod', async (event, methodName, content) => {
        try {
            const methodsDir = path.join(process.cwd(), 'scripts', 'server_methods');
            if (!fs.existsSync(methodsDir)) {
                fs.mkdirSync(methodsDir, { recursive: true });
            }
            const safeName = methodName.replace(/[^a-zA-Z0-9_-]/g, '');
            if (!safeName) {
                return { success: false, error: '无效的方法名称' };
            }
            const filePath = path.join(methodsDir, `${safeName}_method.js`);
            if (!filePath.startsWith(methodsDir)) {
                return { success: false, error: '无效的文件路径' };
            }
            fs.writeFileSync(filePath, content, 'utf-8');
            return { success: true, path: filePath };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('server:deleteMethod', async (event, methodName) => {
        try {
            const methodsDir = path.join(process.cwd(), 'scripts', 'server_methods');
            const filePath = path.join(methodsDir, `${methodName}_method.js`);
            if (!fs.existsSync(filePath)) {
                return { success: false, error: '方法文件不存在' };
            }
            if (!filePath.startsWith(methodsDir)) {
                return { success: false, error: '无效的文件路径' };
            }
            fs.unlinkSync(filePath);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
