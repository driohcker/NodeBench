const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const state = require('../state');

function register() {
    ipcMain.handle('test:start', async (event, overrides = {}) => {
        try {
            // 建立原始数据桥接（必须在 startTest 之前，否则测试期间的数据会丢失）
            try {
                const testCmd2 = await state.services.test.getCommand();
                const testRunnerService2 = testCmd2.controller.testRunnerService;
                if (!state.rawMetricBridge) {
                    state.rawMetricBridge = (data) => {
                        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
                            state.mainWindow.webContents.send('test:rawMetric', data);
                        }
                    };
                }
                testRunnerService2.removeListener('rawMetric', state.rawMetricBridge);
                testRunnerService2.on('rawMetric', state.rawMetricBridge);
            } catch (e) { /* ignore */ }

            const cmd = await state.services.test.getCommand();
            const result = await cmd.controller.startTest(JSON.stringify(overrides));
            return { success: true, data: result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('test:stop', async () => {
        try {
            if (state.monitorMetricBridge) {
                try {
                    const testCmd = await state.services.test.getCommand();
                    testCmd.controller.testRunnerService.removeListener('metric', state.monitorMetricBridge);
                } catch (e) {}
                state.monitorMetricBridge = null;
            }
            const cmd = await state.services.test.getCommand();
            await cmd.controller.stopTest();
            try {
                const monCmd = await state.services.monitor.getCommand();
                await monCmd.controller.stopMonitor();
            } catch (e) {}
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('test:reset', async () => {
        try {
            const cmd = await state.services.test.getCommand();
            await cmd.controller.onSignal('reset');
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('test:status', async () => {
        try {
            const cmd = await state.services.test.getCommand();
            const status = await cmd.controller.getTestStatus();
            return { success: true, data: status };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('test:scripts', async () => {
        try {
            const scriptDir = path.join(process.cwd(), 'scripts', 'test_scripts');
            if (!fs.existsSync(scriptDir)) return { success: true, data: [] };
            const { extractMetaFromK6Script } = require('../../../core/main_controller/utils/metaExtractor');
            const files = fs.readdirSync(scriptDir)
                .filter(f => f.endsWith('_test.js'))
                .map(f => {
                    const fp = path.join(scriptDir, f);
                    const meta = extractMetaFromK6Script(fp) || {};
                    const name = meta.name || f.replace('_test.js', '');
                    return {
                        name,
                        fileName: f,
                        path: fp,
                        meta: {
                            displayName: meta.displayName || name,
                            description: meta.description || '',
                            category: meta.category || 'test_script',
                            targets: meta.targets || [],
                            ...meta
                        }
                    };
                });
            return { success: true, data: files };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('test:metrics', async () => {
        try {
            const testLogDir = state.services.config.getTestConfig().logDir || 'logs/test';
            const logDirPath = path.join(process.cwd(), testLogDir);
            let log = '';
            if (fs.existsSync(logDirPath)) {
                const files = fs.readdirSync(logDirPath)
                    .filter(f => f.endsWith('.log'))
                    .map(f => ({ path: path.join(logDirPath, f), mtime: fs.statSync(path.join(logDirPath, f)).mtime }))
                    .sort((a, b) => b.mtime - a.mtime);
                if (files.length > 0) {
                    const content = fs.readFileSync(files[0].path, 'utf-8');
                    log = content.split('\n').slice(-50).join('\n');
                }
            }
            if (!log) return { success: false, error: '暂无测试日志' };

            const metrics = {};
            const runningMatches = [...log.matchAll(/running \(([\d.]+)s\),\s+(\d+)\/(\d+)\s+VUs/g)];
            if (runningMatches.length > 0) {
                const last = runningMatches[runningMatches.length - 1];
                metrics.runTime = parseFloat(last[1]);
                metrics.currentVUs = parseInt(last[2]);
                metrics.targetVUs = parseInt(last[3]);
            }
            const durationMatch = log.match(/http_req_duration[\s.]*avg=([\d.]+)/);
            if (durationMatch) metrics.avgDuration = parseFloat(durationMatch[1]);
            const rpsMatch = log.match(/http_reqs[\s.]*([\d.]+)\/s/);
            if (rpsMatch) metrics.rps = parseFloat(rpsMatch[1]);

            return { success: true, data: metrics };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
