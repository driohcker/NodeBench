const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function register() {
    ipcMain.handle('data:sessions', async () => {
        try {
            const testDataDir = path.join(process.cwd(), 'data', 'test');
            if (!fs.existsSync(testDataDir)) return { success: true, data: [] };

            const dirs = fs.readdirSync(testDataDir)
                .filter(d => {
                    const fullPath = path.join(testDataDir, d);
                    return fs.statSync(fullPath).isDirectory();
                })
                .map(d => {
                    const sessionPath = path.join(testDataDir, d);
                    const stat = fs.statSync(sessionPath);
                    return { sessionId: d, createdAt: new Date(stat.birthtime).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'), hasResult: true };
                })
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            return { success: true, data: dirs };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('data:readResult', async (event, sessionId) => {
        try {
            const analyzerDir = path.join(process.cwd(), 'data', 'analyzer', sessionId);
            if (fs.existsSync(analyzerDir)) {
                const files = fs.readdirSync(analyzerDir)
                    .filter(f => f.endsWith('.json'))
                    .map(f => {
                        const fp = path.join(analyzerDir, f);
                        return { name: f, path: fp, mtime: fs.statSync(fp).mtime };
                    })
                    .sort((a, b) => b.mtime - a.mtime);
                if (files.length > 0) {
                    const content = fs.readFileSync(files[0].path, 'utf-8');
                    return { success: true, data: JSON.parse(content) };
                }
            }
            const monitorDir = path.join(process.cwd(), 'data', 'monitor', sessionId);
            if (fs.existsSync(monitorDir)) {
                const files = fs.readdirSync(monitorDir)
                    .filter(f => f.endsWith('.json'))
                    .map(f => {
                        const fp = path.join(monitorDir, f);
                        return { name: f, path: fp, mtime: fs.statSync(fp).mtime };
                    })
                    .sort((a, b) => b.mtime - a.mtime);
                if (files.length > 0) {
                    const content = fs.readFileSync(files[0].path, 'utf-8');
                    return { success: true, data: JSON.parse(content) };
                }
            }
            return { success: false, error: '结果文件不存在' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
