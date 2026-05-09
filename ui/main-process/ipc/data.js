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

    // 获取数据报告会话列表（monitor + analyzer）
    ipcMain.handle('data:reportSessions', async () => {
        try {
            const sessionSet = new Set();
            const sessionMap = new Map();

            const monitorDir = path.join(process.cwd(), 'data', 'monitor');
            if (fs.existsSync(monitorDir)) {
                fs.readdirSync(monitorDir).forEach(d => {
                    const fullPath = path.join(monitorDir, d);
                    if (fs.statSync(fullPath).isDirectory()) {
                        sessionSet.add(d);
                        const stat = fs.statSync(fullPath);
                        sessionMap.set(d, { sessionId: d, createdAt: new Date(stat.birthtime).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'), sources: ['monitor'] });
                    }
                });
            }

            const analyzerDir = path.join(process.cwd(), 'data', 'analyzer');
            if (fs.existsSync(analyzerDir)) {
                fs.readdirSync(analyzerDir).forEach(d => {
                    const fullPath = path.join(analyzerDir, d);
                    if (fs.statSync(fullPath).isDirectory()) {
                        if (sessionSet.has(d)) {
                            sessionMap.get(d).sources.push('analyzer');
                        } else {
                            sessionSet.add(d);
                            const stat = fs.statSync(fullPath);
                            sessionMap.set(d, { sessionId: d, createdAt: new Date(stat.birthtime).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'), sources: ['analyzer'] });
                        }
                    }
                });
            }

            const dirs = Array.from(sessionMap.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            return { success: true, data: dirs };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 读取指定 sessionId 下的所有数据报告
    ipcMain.handle('data:readDataReports', async (event, sessionId) => {
        try {
            const reports = [];
            const monitorDir = path.join(process.cwd(), 'data', 'monitor', sessionId);
            if (fs.existsSync(monitorDir)) {
                fs.readdirSync(monitorDir)
                    .filter(f => f.endsWith('.json'))
                    .forEach(f => {
                        const fp = path.join(monitorDir, f);
                        const content = fs.readFileSync(fp, 'utf-8');
                        reports.push(JSON.parse(content));
                    });
            }
            const analyzerDir = path.join(process.cwd(), 'data', 'analyzer', sessionId);
            if (fs.existsSync(analyzerDir)) {
                fs.readdirSync(analyzerDir)
                    .filter(f => f.endsWith('.json'))
                    .forEach(f => {
                        const fp = path.join(analyzerDir, f);
                        const content = fs.readFileSync(fp, 'utf-8');
                        reports.push(JSON.parse(content));
                    });
            }
            if (reports.length === 0) {
                return { success: false, error: '数据报告不存在' };
            }
            return { success: true, data: reports };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    // 读取原始测试数据摘要
    ipcMain.handle('data:readRawTestData', async (event, sessionId) => {
        try {
            const testDataDir = path.join(process.cwd(), 'data', 'test', sessionId);
            if (!fs.existsSync(testDataDir)) {
                return { success: false, error: '原始测试数据不存在' };
            }
            const entries = fs.readdirSync(testDataDir, { withFileTypes: true });
            const subDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
            return { success: true, data: { sessionId, subDirs } };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
