const { ipcMain } = require('electron');
const state = require('../state');

function register() {
    ipcMain.handle('analyzer:analyze', async (event, sessionId, strategy) => {
        try {
            const cmd = await state.services.analyzer.getCommand();
            const strategyMap = {
                'doubleWindow': 'DoubleWindowStrategy.js',
                'cusum': 'CusumStrategy.js',
                'slopeChange': 'SlopeChangeStrategy.js'
            };
            let strategyFile = strategy;
            if (strategy && strategyMap[strategy]) {
                strategyFile = strategyMap[strategy];
            }
            if (strategyFile && strategyFile.endsWith('.js')) {
                await cmd.controller.selectStrategy(strategyFile);
            }
            const result = await cmd.controller.analyzeDataReport(sessionId);
            if (result && result.success === false) {
                return { success: false, error: result.message || result.error || '分析失败' };
            }
            return { success: true, data: result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('analyzer:benchmark', async (event, sessionId) => {
        try {
            const cmd = await state.services.analyzer.getCommand();
            const result = await cmd.controller.generateBenchmarkReport(sessionId);
            return result;
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('analyzer:transcode', async (event, sessionId, format) => {
        try {
            const cmd = await state.services.analyzer.getCommand();
            const result = await cmd.controller.transcodeReport(sessionId, format);
            return result;
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('analyzer:strategies', async () => {
        try {
            const cmd = await state.services.analyzer.getCommand();
            const strategies = await cmd.controller.listStrategies();
            return { success: true, data: strategies };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
