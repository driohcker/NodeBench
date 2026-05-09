const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const state = require('../state');

function register() {
    ipcMain.handle('logs:read', async (event, moduleName, tailLines = 200, fileName = null) => {
        try {
            const logDirMap = {
                'main': state.services.config.getMainConfig().logDir,
                'server': state.services.config.getServerConfig().logDir,
                'test': state.services.config.getTestConfig().logDir,
                'monitor': state.services.config.getMonitorConfig().logDir,
                'analyzer': state.services.config.getAnalyzerConfig().logDir,
                'express': state.services.config.getServerConfig().expressLogDir || 'logs/express_service'
            };

            const logDir = logDirMap[moduleName] || `logs/${moduleName}`;
            const logDirPath = path.join(process.cwd(), logDir);

            if (!fs.existsSync(logDirPath)) {
                return { success: true, data: `日志目录不存在: ${logDirPath}` };
            }

            let targetFile;
            if (fileName) {
                targetFile = path.join(logDirPath, fileName);
                if (!fs.existsSync(targetFile)) {
                    return { success: true, data: `日志文件不存在: ${fileName}` };
                }
            } else {
                const files = fs.readdirSync(logDirPath)
                    .filter(f => f.endsWith('.log'))
                    .map(f => {
                        const fp = path.join(logDirPath, f);
                        return { name: f, path: fp, mtime: fs.statSync(fp).mtime };
                    })
                    .sort((a, b) => b.mtime - a.mtime);

                if (files.length === 0) return { success: true, data: `目录 ${logDirPath} 中暂无 .log 文件` };
                targetFile = files[0].path;
            }

            const content = fs.readFileSync(targetFile, 'utf-8');
            const lines = content.split('\n');
            const tail = lines.slice(-tailLines).join('\n');
            if (!tail.trim()) {
                return { success: true, data: `[日志文件为空或暂无内容: ${path.basename(targetFile)}]` };
            }

            return { success: true, data: tail };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('logs:list', async (event, moduleName) => {
        try {
            const logDirMap = {
                'main': state.services.config.getMainConfig().logDir,
                'server': state.services.config.getServerConfig().logDir,
                'test': state.services.config.getTestConfig().logDir,
                'monitor': state.services.config.getMonitorConfig().logDir,
                'analyzer': state.services.config.getAnalyzerConfig().logDir,
                'express': state.services.config.getServerConfig().expressLogDir || 'logs/express_service'
            };

            const logDir = logDirMap[moduleName] || `logs/${moduleName}`;
            const logDirPath = path.join(process.cwd(), logDir);

            if (!fs.existsSync(logDirPath)) {
                return { success: true, data: [] };
            }

            const files = fs.readdirSync(logDirPath)
                .filter(f => f.endsWith('.log'))
                .map(f => {
                    const fp = path.join(logDirPath, f);
                    const stat = fs.statSync(fp);
                    return { name: f, size: stat.size, mtime: stat.mtime };
                })
                .sort((a, b) => b.mtime - a.mtime);

            return { success: true, data: files };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('logs:delete', async (event, moduleName, fileName) => {
        try {
            const logDirMap = {
                'main': state.services.config.getMainConfig().logDir,
                'server': state.services.config.getServerConfig().logDir,
                'test': state.services.config.getTestConfig().logDir,
                'monitor': state.services.config.getMonitorConfig().logDir,
                'analyzer': state.services.config.getAnalyzerConfig().logDir,
                'express': state.services.config.getServerConfig().expressLogDir || 'logs/express_service'
            };

            const logDir = logDirMap[moduleName] || `logs/${moduleName}`;
            const logDirPath = path.join(process.cwd(), logDir);
            const targetFile = path.join(logDirPath, fileName);

            const realDir = fs.realpathSync(logDirPath);
            const realTarget = fs.realpathSync(targetFile);
            if (!realTarget.startsWith(realDir)) {
                return { success: false, error: '非法文件路径' };
            }

            if (!fs.existsSync(targetFile)) {
                return { success: false, error: '文件不存在' };
            }

            fs.unlinkSync(targetFile);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
