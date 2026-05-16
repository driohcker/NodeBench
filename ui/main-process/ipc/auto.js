const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const state = require('../state');

function register() {
    ipcMain.handle('auto:start', async (event, options = {}) => {
        // 读取配置文件默认值，当前端未传临时参数时使用配置值
        const testConf = state.services.config.getTestConfig();
        const monitorConf = state.services.config.getMonitorConfig();

        const {
            targets = testConf.testTargets || ['cpu'],
            outputMode = testConf.outputMode || 'file',
            algorithm = monitorConf.algorithm || 'doubleWindow',
            initVUs = testConf.initVUs || 1,
            maxVUs = testConf.maxVUs || 400,
            duration = testConf.duration || '6s',
            waitPeriod = testConf.waitPeriod || 5,
            maxVuIncrement = testConf.maxVuIncrement || 100,
            strategyParams = null
        } = options;

        let sessionId = null;
        const autoTestState = { monitorMetricBridge: null, stopped: false };

        try {
            state.services.logger.info('[Auto] ==============================');
            state.services.logger.info('[Auto] 启动自动化性能标定流程');
            state.services.logger.info('[Auto] ==============================');

            // 1. 启动被测服务
            state.services.logger.info('[Auto] 步骤 1/5: 启动Express被测服务...');
            const servCmd = await state.services.serv.getCommand();
            const serverStatus = await servCmd.controller.getStatusExpressService();
            if (!serverStatus.isRunning) {
                await servCmd.controller.startExpressService();
                const serverUrl = state.services.config.getServerConfig().serverUrl || 'http://localhost:10000';
                let serverReady = false;
                for (let i = 0; i < 30; i++) {
                    try {
                        await new Promise((resolve, reject) => {
                            const req = http.get(serverUrl, (res) => {
                                if (res.statusCode === 200) resolve();
                                else reject(new Error(`状态码: ${res.statusCode}`));
                            });
                            req.on('error', reject);
                            req.setTimeout(1000, () => { req.destroy(); reject(new Error('超时')); });
                        });
                        serverReady = true;
                        break;
                    } catch (e) {
                        await new Promise(r => setTimeout(r, 500));
                    }
                }
                if (!serverReady) {
                    throw new Error('被测服务启动后未就绪');
                }
            }
            state.services.logger.info('[Auto] 被测服务已就绪');

            // 2. 生成 sessionId 和各目标 session2Id
            sessionId = Date.now().toString();
            const session2IdMap = {};
            for (const target of targets) {
                session2IdMap[target] = Date.now().toString() + '_' + target;
                await new Promise(r => setTimeout(r, 10));
            }
            state.services.logger.info(`[Auto] 生成测试流程 sessionId=${sessionId}, 目标: ${targets.join(', ')}`);

            // 3. 逐个执行测试子流程
            for (let i = 0; i < targets.length; i++) {
                if (autoTestState.stopped) {
                    state.services.logger.info('[Auto] 流程被中断');
                    break;
                }

                const target = targets[i];
                const session2Id = session2IdMap[target];
                const testDataDir = state.services.config.getTestConfig().dataOutputDir || 'data/test';
                const session2Dir = path.join(process.cwd(), testDataDir, sessionId, session2Id);
                fs.mkdirSync(session2Dir, { recursive: true });

                state.services.logger.info(`[Auto] --- 子流程 ${i + 1}/${targets.length}: ${target} ---`);
                state.services.logger.info(`[Auto] session2Id=${session2Id}`);

                // 3.1 启动监测端
                // 新架构：file 模式和 pipe 模式统一使用 pipe 传输链路
                const monitorMode = 'pipe';
                const monCmd = await state.services.monitor.getCommand();
                await monCmd.controller.setMonitorMode(monitorMode);
                const monitorSource = 'pipe';
                const saveFilePath = outputMode === 'file'
                    ? path.join(session2Dir, 'data_points.jsonl')
                    : null;
                await monCmd.controller.startMonitor(sessionId, session2Id, monitorSource, target, algorithm, strategyParams, saveFilePath);
                state.services.logger.info(`[Auto] 监测端已启动: mode=${monitorMode}, target=${target}, saveFilePath=${saveFilePath || 'none'}`);

                // 3.2 建立测试端→监测端管道数据桥接
                const testCmd = await state.services.test.getCommand();
                const testRunnerService = testCmd.controller.testRunnerService;
                const monitorService = monCmd.controller.monitorService;
                autoTestState.monitorMetricBridge = (data) => {
                    if (monitorService && monitorService.isMonitoring) {
                        monitorService.feedMetric(data);
                    }
                };
                testRunnerService.on('metric', autoTestState.monitorMetricBridge);

                // 监听监测端拐点完成事件：检测到两个拐点后延迟2.5秒提前结束测试端
                const inflectionStopHandler = async () => {
                    state.services.logger.info('[Auto] 监测端已检测到两个拐点，2.5秒后提前结束测试端');
                    await new Promise(r => setTimeout(r, 2500));
                    try {
                        const testCmdStop = await state.services.test.getCommand();
                        const testRunnerService2 = testCmdStop.controller.testRunnerService;
                        if (testRunnerService2.isRunning) {
                            state.services.logger.info('[Auto] 发送stop信号到测试端');
                            testRunnerService2.onSignal('stop');
                        }
                    } catch (e) {
                        state.services.logger.warn('[Auto] 发送stop信号失败: ' + e.message);
                    }
                };
                monitorService.once('inflectionComplete', inflectionStopHandler);

                state.services.logger.info('[Auto] 管道数据桥接已建立，已注册STOP信号监听');

                // 3.3 启动测试端（单一子流程）
                // testCmd 已在桥接建立时获取，复用同一实例
                const overrides = {
                    target,
                    sessionId,
                    session2Id,
                    outputMode,
                    initVUs,
                    maxVUs,
                    duration,
                    waitPeriod,
                    maxVuIncrement
                };

                // 建立原始数据桥接（必须在 startTest 之前，否则测试期间的数据会丢失）
                try {
                    const testRunnerServiceRaw = testCmd.controller.testRunnerService;
                    if (!state.rawMetricBridge) {
                        state.rawMetricBridge = (data) => {
                            if (state.mainWindow && !state.mainWindow.isDestroyed()) {
                                state.mainWindow.webContents.send('test:rawMetric', data);
                            }
                        };
                    }
                    testRunnerServiceRaw.removeListener('rawMetric', state.rawMetricBridge);
                    testRunnerServiceRaw.on('rawMetric', state.rawMetricBridge);
                } catch (e) { /* ignore */ }

                await testCmd.controller.startTest(JSON.stringify(overrides));
                state.services.logger.info(`[Auto] 测试端已启动: target=${target}`);

                // 3.4 等待测试子流程完成
                await new Promise((resolve) => {
                    const testRunnerService = testCmd.controller.testRunnerService;
                    if (!testRunnerService.isRunning) {
                        resolve();
                        return;
                    }
                    const onComplete = () => {
                        testRunnerService.removeListener('subFlowComplete', onComplete);
                        resolve();
                    };
                    testRunnerService.once('subFlowComplete', onComplete);
                });
                state.services.logger.info(`[Auto] 测试子流程完成: target=${target}`);

                // 3.5 等待期
                const waitTime = (waitPeriod || 5) * 1000;
                state.services.logger.info(`[Auto] 进入等待期 ${waitTime}ms，监听监测端反馈...`);
                await new Promise(r => setTimeout(r, waitTime));

                const monitorStatus = await monCmd.controller.getMonitorStatus();
                if (monitorStatus.detectedMax && monitorStatus.detectedOptimal) {
                    state.services.logger.info('[Auto] 监测端已检测到两个拐点');
                } else {
                    state.services.logger.info('[Auto] 等待期结束，监测端状态: detectedOptimal=' + monitorStatus.detectedOptimal + ', detectedMax=' + monitorStatus.detectedMax);
                }

                // 3.6 停止监测端并生成数据报告
                try {
                    await monCmd.controller.generateDataReport();
                    state.services.logger.info(`[Auto] 数据报告已生成: target=${target}`);
                } catch (e) {
                    state.services.logger.warn(`[Auto] 生成数据报告失败: ${e.message}`);
                }

                await monCmd.controller.stopMonitor();
                state.services.logger.info(`[Auto] 监测端已停止: target=${target}`);

                // 清理桥接
                if (autoTestState.monitorMetricBridge) {
                    try {
                        const testCmd2 = await state.services.test.getCommand();
                        testCmd2.controller.testRunnerService.removeListener('metric', autoTestState.monitorMetricBridge);
                    } catch (e) {}
                    autoTestState.monitorMetricBridge = null;
                }
            }

            // 4. 生成标定报告
            state.services.logger.info('[Auto] 步骤 5/5: 生成标定报告...');
            try {
                const analyzerCmd = await state.services.analyzer.getCommand();
                const benchResult = await analyzerCmd.controller.generateBenchmarkReport(sessionId);
                state.services.logger.info(`[Auto] 标定报告已生成: ${benchResult.reportPath || sessionId}`);
            } catch (e) {
                state.services.logger.warn(`[Auto] 生成标定报告失败: ${e.message}`);
            }

            state.services.logger.info('[Auto] ==============================');
            state.services.logger.info('[Auto] ✅ 自动化性能标定流程完成！');
            state.services.logger.info(`[Auto] Session ID: ${sessionId}`);
            state.services.logger.info('[Auto] ==============================');

            return { success: true, sessionId };
        } catch (error) {
            state.services.logger.error('[Auto] 自动化流程失败:', error.message);
            try {
                const monCmd = await state.services.monitor.getCommand();
                await monCmd.controller.stopMonitor();
            } catch (e) {}
            if (autoTestState.monitorMetricBridge) {
                try {
                    const testCmd = await state.services.test.getCommand();
                    testCmd.controller.testRunnerService.removeListener('metric', autoTestState.monitorMetricBridge);
                } catch (e) {}
                autoTestState.monitorMetricBridge = null;
            }
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('auto:stop', async () => {
        try {
            const testCmd = await state.services.test.getCommand();
            await testCmd.controller.stopTest();
            const monCmd = await state.services.monitor.getCommand();
            await monCmd.controller.stopMonitor();
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
