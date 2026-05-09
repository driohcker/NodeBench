const { ipcMain } = require('electron');
const state = require('../state');

function register() {
    ipcMain.handle('monitor:start', async (event, sessionId, session2Id, source, options = {}) => {
        try {
            if (state.monitorMetricBridge) {
                try {
                    const testCmd = await state.services.test.getCommand();
                    testCmd.controller.testRunnerService.removeListener('metric', state.monitorMetricBridge);
                } catch (e) {}
                state.monitorMetricBridge = null;
            }

            const cmd = await state.services.monitor.getCommand();
            const inferredMode = (source === 'pipe') ? 'pipe' : 'tail';
            await cmd.controller.setMonitorMode(inferredMode);

            if (options.algorithm) {
                await cmd.controller.setAlgorithm(options.algorithm);
            }

            let target = 'unknown';
            try {
                const testCmd = await state.services.test.getCommand();
                const testStatus = testCmd.controller.testRunnerService.getTestStatus();
                target = testStatus.currentTarget || 'unknown';
            } catch (e) {}

            const strategyName = options.algorithm || 'doubleWindow';
            const result = await cmd.controller.startMonitor(sessionId, session2Id, source, target, strategyName);

            if (inferredMode === 'pipe') {
                const testCmd = await state.services.test.getCommand();
                const testRunnerService = testCmd.controller.testRunnerService;
                const monitorService = cmd.controller.monitorService;

                state.monitorMetricBridge = (data) => {
                    if (monitorService && monitorService.isMonitoring) {
                        monitorService.feedMetric(data);
                    }
                };
                testRunnerService.on('metric', state.monitorMetricBridge);
                state.services.logger.info('[ui/main.js] pipe 模式数据桥接已建立');

                monitorService.once('inflectionComplete', async (data) => {
                    state.services.logger.info('[ui/main.js] 监测端检测到拐点完成，发送停止信号');
                    try {
                        await testCmd.controller.onSignal('stop');
                    } catch (e) {}
                });

                const onFlowComplete = async () => {
                    state.services.logger.info('[ui/main.js] 测试流程结束，开始自动生成报告');
                    try {
                        testRunnerService.removeListener('flowComplete', onFlowComplete);
                    } catch (e) {}

                    await new Promise(r => setTimeout(r, 2000));

                    try {
                        await cmd.controller.stopMonitor();
                    } catch (e) {}

                    if (state.monitorMetricBridge) {
                        try {
                            testRunnerService.removeListener('metric', state.monitorMetricBridge);
                        } catch (e) {}
                        state.monitorMetricBridge = null;
                    }

                    let dataReportPath = null;
                    try {
                        const reportResult = await cmd.controller.generateDataReport();
                        dataReportPath = reportResult.reportPath;
                        state.services.logger.info('[ui/main.js] 数据报告已生成: ' + dataReportPath);
                    } catch (e) {
                        state.services.logger.error('[ui/main.js] 生成数据报告失败: ' + e.message);
                    }

                    try {
                        const analyzerCmd = await state.services.analyzer.getCommand();
                        const benchResult = await analyzerCmd.controller.generateBenchmarkReport(sessionId);
                        state.services.logger.info('[ui/main.js] 标定报告已生成: ' + benchResult.reportPath);
                    } catch (e) {
                        state.services.logger.error('[ui/main.js] 生成标定报告失败: ' + e.message);
                    }
                };

                testRunnerService.once('flowComplete', onFlowComplete);
            }

            return { success: true, ...result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('monitor:stop', async () => {
        try {
            if (state.monitorMetricBridge) {
                try {
                    const testCmd = await state.services.test.getCommand();
                    testCmd.controller.testRunnerService.removeListener('metric', state.monitorMetricBridge);
                } catch (e) {}
                state.monitorMetricBridge = null;
                state.services.logger.info('[ui/main.js] pipe 模式数据桥接已清理');
            }

            const cmd = await state.services.monitor.getCommand();
            const result = await cmd.controller.stopMonitor();
            return { success: true, ...result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('monitor:status', async () => {
        try {
            const cmd = await state.services.monitor.getCommand();
            const status = await cmd.controller.getMonitorStatus();
            return { success: true, data: status };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('monitor:metrics', async () => {
        try {
            const cmd = await state.services.monitor.getCommand();
            const metrics = await cmd.controller.getCurrentMetrics();
            return { success: true, data: metrics };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });

    ipcMain.handle('monitor:report', async () => {
        try {
            const cmd = await state.services.monitor.getCommand();
            const result = await cmd.controller.generateDataReport();
            return { success: true, ...result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
