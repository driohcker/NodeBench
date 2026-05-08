/**
 * Browser-based GUI test server
 * Replaces Electron with an Express server + browser
 */

require('./core/main_controller/utils/fixEncoding');
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const Config = require('./core/main_controller/utils/config');
const Logger = require('./core/main_controller/utils/logger');
const ServModuleService = require('./core/main_controller/service/serv_module_service');
const TestModuleService = require('./core/main_controller/service/test_module_service');
const MonitorModule = require('./core/main_controller/modules/monitor_module/moduleIndex');
const AnalyzerModule = require('./core/main_controller/modules/analyzer_module/moduleIndex');

const app = express();
app.use(express.json());

const services = {};
let monitorMetricBridge = null;
const autoTestState = { monitorMetricBridge: null, stopped: false };

let lastCpuInfo = null;
let lastCpuTime = 0;

function getCpuUsage() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const cpu of cpus) {
        for (const type in cpu.times) {
            total += cpu.times[type];
        }
        idle += cpu.times.idle;
    }
    const now = Date.now();
    let usage = 0;
    if (lastCpuInfo && now > lastCpuTime) {
        const idleDiff = idle - lastCpuInfo.idle;
        const totalDiff = total - lastCpuInfo.total;
        if (totalDiff > 0) {
            usage = 100 - Math.floor((idleDiff / totalDiff) * 100);
        }
    }
    lastCpuInfo = { idle, total };
    lastCpuTime = now;
    return Math.max(0, Math.min(100, usage));
}

async function initializeServices() {
    const config = Config;
    const mainLogger = new Logger(config.getMainConfig().logDir);
    services.config = config;
    services.logger = mainLogger;

    const serverLogger = new Logger(config.getServerConfig().logDir);
    services.serv = new ServModuleService(config.getServerConfig(), serverLogger);

    const testLogger = new Logger(config.getTestConfig().logDir);
    services.test = new TestModuleService(config.getTestConfig(), testLogger);

    const monitorConfig = config.getMonitorConfig();
    const monitorLogger = new Logger(monitorConfig.logDir);
    services.monitor = new MonitorModule(monitorConfig, monitorLogger);

    const analyzerConfig = config.getAnalyzerConfig();
    const analyzerLogger = new Logger(analyzerConfig.logDir);
    services.analyzer = new AnalyzerModule(analyzerConfig, analyzerLogger);

    await new Promise(resolve => setTimeout(resolve, 300));
    mainLogger.info('Browser test server backend initialized');
}

// Helper to create API endpoints
function createEndpoint(route, handler) {
    app.post(route, async (req, res) => {
        try {
            const result = await handler(req.body);
            res.json(result);
        } catch (e) {
            res.json({ success: false, error: e.message });
        }
    });
}

// ═══ Server Module ═══
createEndpoint('/api/server/start', async () => {
    const cmd = await services.serv.getCommand();
    await cmd.controller.startExpressService();
    return { success: true };
});

createEndpoint('/api/server/stop', async () => {
    const cmd = await services.serv.getCommand();
    await cmd.controller.stopExpressService();
    return { success: true };
});

createEndpoint('/api/server/status', async () => {
    const cmd = await services.serv.getCommand();
    const status = await cmd.controller.getStatusExpressService();
    return { success: true, data: status };
});

createEndpoint('/api/server/config', async () => {
    const cmd = await services.serv.getCommand();
    const conf = await cmd.controller.getConfig();
    return { success: true, data: conf };
});

createEndpoint('/api/server/methods', async () => {
    const methodsDir = path.join(process.cwd(), 'scripts', 'server_methods');
    if (!fs.existsSync(methodsDir)) return { success: true, data: [] };
    const files = fs.readdirSync(methodsDir)
        .filter(f => f.endsWith('_method.js'))
        .map(f => {
            const fp = path.join(methodsDir, f);
            const stat = fs.statSync(fp);
            return { name: f.replace('_method.js', ''), fileName: f, path: fp, size: stat.size, modified: stat.mtime.toISOString() };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    return { success: true, data: files };
});

createEndpoint('/api/server/readMethod', async (body) => {
    const methodsDir = path.join(process.cwd(), 'scripts', 'server_methods');
    const filePath = path.join(methodsDir, `${body.methodName}_method.js`);
    if (!fs.existsSync(filePath)) return { success: false, error: '方法文件不存在' };
    const content = fs.readFileSync(filePath, 'utf-8');
    const stats = fs.statSync(filePath);
    return { success: true, data: { name: body.methodName, content, size: stats.size, modified: stats.mtime.toISOString() } };
});

createEndpoint('/api/server/saveMethod', async (body) => {
    const methodsDir = path.join(process.cwd(), 'scripts', 'server_methods');
    if (!fs.existsSync(methodsDir)) fs.mkdirSync(methodsDir, { recursive: true });
    const safeName = body.methodName.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeName) return { success: false, error: '无效的方法名称' };
    const filePath = path.join(methodsDir, `${safeName}_method.js`);
    if (!filePath.startsWith(methodsDir)) return { success: false, error: '无效的文件路径' };
    fs.writeFileSync(filePath, body.content, 'utf-8');
    return { success: true, path: filePath };
});

createEndpoint('/api/server/deleteMethod', async (body) => {
    const methodsDir = path.join(process.cwd(), 'scripts', 'server_methods');
    const filePath = path.join(methodsDir, `${body.methodName}_method.js`);
    if (!fs.existsSync(filePath)) return { success: false, error: '方法文件不存在' };
    if (!filePath.startsWith(methodsDir)) return { success: false, error: '无效的文件路径' };
    fs.unlinkSync(filePath);
    return { success: true };
});

// ═══ Test Module ═══
createEndpoint('/api/test/start', async (body) => {
    const cmd = await services.test.getCommand();
    const result = await cmd.controller.startTest(JSON.stringify(body.overrides || {}));
    return { success: true, data: result };
});

createEndpoint('/api/test/stop', async () => {
    autoTestState.stopped = true;
    if (monitorMetricBridge) {
        try {
            const testCmd = await services.test.getCommand();
            testCmd.controller.testRunnerService.removeListener('metric', monitorMetricBridge);
        } catch (e) {}
        monitorMetricBridge = null;
    }
    const cmd = await services.test.getCommand();
    await cmd.controller.stopTest();
    try {
        const monCmd = await services.monitor.getCommand();
        await monCmd.controller.stopMonitor();
    } catch (e) {}
    return { success: true };
});

createEndpoint('/api/test/reset', async () => {
    const cmd = await services.test.getCommand();
    await cmd.controller.onSignal('reset');
    return { success: true };
});

createEndpoint('/api/test/status', async () => {
    const cmd = await services.test.getCommand();
    const status = await cmd.controller.getTestStatus();
    return { success: true, data: status };
});

createEndpoint('/api/test/metrics', async () => {
    const testLogDir = services.config.getTestConfig().logDir || 'logs/test';
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
});

// ═══ Auto Test ═══
createEndpoint('/api/auto/start', async (body) => {
    const options = body || {};
    const {
        targets = ['cpu'],
        outputMode = 'file',
        algorithm = 'doubleWindow',
        initVUs = 1,
        maxVUs = 400,
        duration = '6s',
        waitPeriod = 5,
        maxVuIncrement = 100
    } = options;

    let sessionId = null;
    autoTestState.stopped = false;
    autoTestState.monitorMetricBridge = null;

    try {
        services.logger.info('[Auto] ==============================');
        services.logger.info('[Auto] 启动自动化性能标定流程');
        services.logger.info('[Auto] ==============================');

        services.logger.info('[Auto] 步骤 1/5: 启动Express被测服务...');
        const servCmd = await services.serv.getCommand();
        const serverStatus = await servCmd.controller.getStatusExpressService();
        if (!serverStatus.isRunning) {
            await servCmd.controller.startExpressService();
            const http = require('http');
            const serverUrl = services.config.getServerConfig().serverUrl || 'http://localhost:10000';
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
            if (!serverReady) throw new Error('被测服务启动后未就绪');
        }
        services.logger.info('[Auto] 被测服务已就绪');

        sessionId = Date.now().toString();
        const session2IdMap = {};
        for (const target of targets) {
            session2IdMap[target] = Date.now().toString() + '_' + target;
            await new Promise(r => setTimeout(r, 10));
        }
        services.logger.info(`[Auto] 生成测试流程 sessionId=${sessionId}, 目标: ${targets.join(', ')}`);

        for (let i = 0; i < targets.length; i++) {
            if (autoTestState.stopped) { services.logger.info('[Auto] 流程被中断'); break; }
            const target = targets[i];
            const session2Id = session2IdMap[target];
            const testDataDir = services.config.getTestConfig().dataOutputDir || 'data/test';
            const session2Dir = path.join(process.cwd(), testDataDir, sessionId, session2Id);
            fs.mkdirSync(session2Dir, { recursive: true });

            // 循环重试逻辑：未检测到拐点时增加MaxVUs重试
            const maxVuLimit = 2000;
            let currentMaxVUs = maxVUs;
            let retryCount = 0;
            let inflectionDetected = false;

            while (currentMaxVUs <= maxVuLimit) {
                if (autoTestState.stopped) {
                    services.logger.info('[Auto] 流程被中断');
                    try { await monCmd.controller.stopMonitor(); } catch (e) {}
                    if (autoTestState.monitorMetricBridge) {
                        try { const testCmd2 = await services.test.getCommand(); testCmd2.controller.testRunnerService.removeListener('metric', autoTestState.monitorMetricBridge); } catch (e) {}
                        autoTestState.monitorMetricBridge = null;
                    }
                    break;
                }
                retryCount++;
                services.logger.info(`[Auto] --- 子流程 ${i + 1}/${targets.length}: ${target} (第${retryCount}轮, MaxVUs=${currentMaxVUs}) ---`);

                const monitorMode = outputMode === 'pipe' ? 'pipe' : 'tail';
                const monCmd = await services.monitor.getCommand();
                await monCmd.controller.setMonitorMode(monitorMode);
                let monitorSource;
                if (monitorMode === 'tail') {
                    monitorSource = path.join(session2Dir, 'metrics.json');
                } else {
                    monitorSource = 'pipe';
                }
                await monCmd.controller.startMonitor(sessionId, session2Id, monitorSource, target, algorithm);
                services.logger.info(`[Auto] 监测端已启动: mode=${monitorMode}, target=${target}`);

                // 建立桥接并监听RESET信号
                let resetSignaled = false;
                if (monitorMode === 'pipe') {
                    const testCmd = await services.test.getCommand();
                    const testRunnerService = testCmd.controller.testRunnerService;
                    const monitorService = monCmd.controller.monitorService;
                    autoTestState.monitorMetricBridge = (data) => {
                        if (monitorService && monitorService.isMonitoring) monitorService.feedMetric(data);
                    };
                    testRunnerService.on('metric', autoTestState.monitorMetricBridge);
                    
                    // 监听监测端RESET信号：未检测到拐点时自动触发reset
                    monitorService.once('subFlowCompleteNoInflection', () => {
                        resetSignaled = true;
                        services.logger.info('[Auto] 收到监测端RESET信号：未检测到拐点');
                        testRunnerService.onSignal('reset');
                    });
                    services.logger.info('[Auto] pipe 模式数据桥接已建立，已注册RESET信号监听');
                }

                const testCmd = await services.test.getCommand();
                const overrides = { target, sessionId, session2Id, outputMode, initVUs, maxVUs: currentMaxVUs, duration, waitPeriod, maxVuIncrement };
                await testCmd.controller.startTest(JSON.stringify(overrides));
                services.logger.info(`[Auto] 测试端已启动: target=${target}, maxVUs=${currentMaxVUs}`);

                const testResult = await new Promise((resolve) => {
                    const testRunnerService = testCmd.controller.testRunnerService;
                    if (!testRunnerService.isRunning) { resolve(testRunnerService.lastResult || 'complete'); return; }
                    const onComplete = (data) => { testRunnerService.removeListener('subFlowComplete', onComplete); resolve(data?.result || 'complete'); };
                    testRunnerService.once('subFlowComplete', onComplete);
                });
                services.logger.info(`[Auto] 测试子流程完成: target=${target}, result=${testResult}`);

                // 如果RESET信号已触发，跳过等待期直接重试
                if (testResult === 'reset' || resetSignaled) {
                    services.logger.info('[Auto] RESET信号已确认，跳过等待期直接检查状态');
                } else {
                    const waitTime = (waitPeriod || 5) * 1000;
                    services.logger.info(`[Auto] 进入等待期 ${waitTime}ms...`);
                    await new Promise(r => setTimeout(r, waitTime));
                }

                const monitorStatus = await monCmd.controller.getMonitorStatus();
                if (!resetSignaled && monitorStatus.detectedMax && monitorStatus.detectedOptimal) {
                    services.logger.info('[Auto] 监测端已检测到两个拐点');
                    inflectionDetected = true;
                }

                try { await monCmd.controller.generateDataReport(); services.logger.info(`[Auto] 数据报告已生成: target=${target}`); } catch (e) {}

                if (inflectionDetected) {
                    await monCmd.controller.stopMonitor();
                    services.logger.info(`[Auto] 监测端已停止: target=${target}`);
                    if (autoTestState.monitorMetricBridge) {
                        try { const testCmd2 = await services.test.getCommand(); testCmd2.controller.testRunnerService.removeListener('metric', autoTestState.monitorMetricBridge); } catch (e) {}
                        autoTestState.monitorMetricBridge = null;
                    }
                    break;
                }

                const nextMaxVUs = currentMaxVUs + maxVuIncrement;
                if (nextMaxVUs > maxVuLimit) {
                    services.logger.warn(`[Auto] 已达到MaxVUs上限(${maxVuLimit})，停止重试`);
                    await monCmd.controller.stopMonitor();
                    services.logger.info(`[Auto] 监测端已停止: target=${target}`);
                    if (autoTestState.monitorMetricBridge) {
                        try { const testCmd2 = await services.test.getCommand(); testCmd2.controller.testRunnerService.removeListener('metric', autoTestState.monitorMetricBridge); } catch (e) {}
                        autoTestState.monitorMetricBridge = null;
                    }
                    break;
                }

                services.logger.info(`[Auto] 未检测到拐点，准备重试: MaxVUs ${currentMaxVUs} → ${nextMaxVUs}`);
                currentMaxVUs = nextMaxVUs;

                await monCmd.controller.stopMonitor();
                services.logger.info(`[Auto] 监测端已停止: target=${target}`);
                if (autoTestState.monitorMetricBridge) {
                    try { const testCmd2 = await services.test.getCommand(); testCmd2.controller.testRunnerService.removeListener('metric', autoTestState.monitorMetricBridge); } catch (e) {}
                    autoTestState.monitorMetricBridge = null;
                }
                // 短暂延迟确保资源释放
                await new Promise(r => setTimeout(r, 500));
            }
        }

        try {
            const analyzerCmd = await services.analyzer.getCommand();
            const benchResult = await analyzerCmd.controller.generateBenchmarkReport(sessionId);
            services.logger.info(`[Auto] 标定报告已生成: ${benchResult.reportPath || sessionId}`);
        } catch (e) {
            services.logger.warn(`[Auto] 生成标定报告失败: ${e.message}`);
        }

        services.logger.info('[Auto] ✅ 自动化性能标定流程完成！');
        return { success: true, sessionId };
    } catch (error) {
        services.logger.error('[Auto] 自动化流程失败:', error.message);
        try { const monCmd = await services.monitor.getCommand(); await monCmd.controller.stopMonitor(); } catch (e) {}
        if (autoTestState.monitorMetricBridge) {
            try { const testCmd = await services.test.getCommand(); testCmd.controller.testRunnerService.removeListener('metric', autoTestState.monitorMetricBridge); } catch (e) {}
            autoTestState.monitorMetricBridge = null;
        }
        return { success: false, error: error.message };
    }
});

createEndpoint('/api/auto/stop', async () => {
    autoTestState.stopped = true;
    const testCmd = await services.test.getCommand();
    await testCmd.controller.stopTest();
    const monCmd = await services.monitor.getCommand();
    await monCmd.controller.stopMonitor();
    return { success: true };
});

// ═══ Monitor Module ═══
createEndpoint('/api/monitor/start', async (body) => {
    if (monitorMetricBridge) {
        try { const testCmd = await services.test.getCommand(); testCmd.controller.testRunnerService.removeListener('metric', monitorMetricBridge); } catch (e) {}
        monitorMetricBridge = null;
    }
    const cmd = await services.monitor.getCommand();
    const inferredMode = (body.source === 'pipe') ? 'pipe' : 'tail';
    await cmd.controller.setMonitorMode(inferredMode);
    if (body.options?.algorithm) await cmd.controller.setAlgorithm(body.options.algorithm);
    let target = 'unknown';
    try { const testCmd = await services.test.getCommand(); const testStatus = testCmd.controller.testRunnerService.getTestStatus(); target = testStatus.currentTarget || 'unknown'; } catch (e) {}
    const strategyName = body.options?.algorithm || 'doubleWindow';
    const result = await cmd.controller.startMonitor(body.sessionId, body.session2Id, body.source, target, strategyName);
    if (inferredMode === 'pipe') {
        const testCmd = await services.test.getCommand();
        const testRunnerService = testCmd.controller.testRunnerService;
        const monitorService = cmd.controller.monitorService;
        monitorMetricBridge = (data) => { if (monitorService && monitorService.isMonitoring) monitorService.feedMetric(data); };
        testRunnerService.on('metric', monitorMetricBridge);
    }
    return { success: true, ...result };
});

createEndpoint('/api/monitor/stop', async () => {
    if (monitorMetricBridge) {
        try { const testCmd = await services.test.getCommand(); testCmd.controller.testRunnerService.removeListener('metric', monitorMetricBridge); } catch (e) {}
        monitorMetricBridge = null;
    }
    const cmd = await services.monitor.getCommand();
    const result = await cmd.controller.stopMonitor();
    return { success: true, ...result };
});

createEndpoint('/api/monitor/status', async () => {
    const cmd = await services.monitor.getCommand();
    const status = await cmd.controller.getMonitorStatus();
    return { success: true, data: status };
});

createEndpoint('/api/monitor/metrics', async () => {
    const cmd = await services.monitor.getCommand();
    const metrics = await cmd.controller.getCurrentMetrics();
    return { success: true, data: metrics };
});

createEndpoint('/api/monitor/report', async () => {
    const cmd = await services.monitor.getCommand();
    const result = await cmd.controller.generateDataReport();
    return { success: true, ...result };
});

// ═══ Analyzer Module ═══
createEndpoint('/api/analyzer/analyze', async (body) => {
    const cmd = await services.analyzer.getCommand();
    const strategyMap = { doubleWindow: 'DoubleWindowStrategy.js', cusum: 'CusumStrategy.js', slopeChange: 'SlopeChangeStrategy.js' };
    let strategyFile = body.strategy;
    if (body.strategy && strategyMap[body.strategy]) strategyFile = strategyMap[body.strategy];
    if (strategyFile && strategyFile.endsWith('.js')) await cmd.controller.selectStrategy(strategyFile);
    const result = await cmd.controller.analyzeDataReport(body.sessionId);
    return result && result.success === false ? { success: false, error: result.message || result.error || '分析失败' } : { success: true, data: result };
});

createEndpoint('/api/analyzer/benchmark', async (body) => {
    const cmd = await services.analyzer.getCommand();
    const result = await cmd.controller.generateBenchmarkReport(body.sessionId);
    return result;
});

createEndpoint('/api/analyzer/transcode', async (body) => {
    const cmd = await services.analyzer.getCommand();
    const result = await cmd.controller.transcodeReport(body.sessionId, body.format);
    return result;
});

createEndpoint('/api/analyzer/strategies', async () => {
    const cmd = await services.analyzer.getCommand();
    const strategies = await cmd.controller.listStrategies();
    return { success: true, data: strategies };
});

// ═══ Reports ═══
createEndpoint('/api/reports/list', async () => {
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) return { success: true, data: [] };
    const files = fs.readdirSync(reportsDir)
        .filter(f => f.endsWith('.html'))
        .map(f => {
            const fp = path.join(reportsDir, f);
            const stat = fs.statSync(fp);
            const match = f.match(/(?:report_session_|benchmark_report_|report_realtime_)(\d+)/);
            return { name: f, path: fp, sessionId: match ? match[1] : null, createdAt: stat.birthtime.toISOString(), size: stat.size };
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { success: true, data: files };
});

// ═══ Config ═══
createEndpoint('/api/config/get', async () => {
    return { success: true, data: services.config.getAll() };
});

createEndpoint('/api/config/set', async (body) => {
    return services.config.update(body);
});

createEndpoint('/api/config/reset', async () => {
    return services.config.resetToDefaults();
});

createEndpoint('/api/config/stats', async () => {
    return { success: true, data: services.config.getStats() };
});

// ═══ Data ═══
createEndpoint('/api/data/sessions', async () => {
    const testDataDir = path.join(process.cwd(), 'data', 'test');
    if (!fs.existsSync(testDataDir)) return { success: true, data: [] };
    const dirs = fs.readdirSync(testDataDir)
        .filter(d => fs.statSync(path.join(testDataDir, d)).isDirectory())
        .map(d => {
            const sessionPath = path.join(testDataDir, d);
            const stat = fs.statSync(sessionPath);
            return { sessionId: d, createdAt: new Date(stat.birthtime).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'), hasResult: true };
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { success: true, data: dirs };
});

createEndpoint('/api/data/readResult', async (body) => {
    const analyzerDir = path.join(process.cwd(), 'data', 'analyzer', body.sessionId);
    if (fs.existsSync(analyzerDir)) {
        const files = fs.readdirSync(analyzerDir).filter(f => f.endsWith('.json')).map(f => {
            const fp = path.join(analyzerDir, f);
            return { name: f, path: fp, mtime: fs.statSync(fp).mtime };
        }).sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0) {
            const content = fs.readFileSync(files[0].path, 'utf-8');
            return { success: true, data: JSON.parse(content) };
        }
    }
    const monitorDir = path.join(process.cwd(), 'data', 'monitor', body.sessionId);
    if (fs.existsSync(monitorDir)) {
        const files = fs.readdirSync(monitorDir).filter(f => f.endsWith('.json')).map(f => {
            const fp = path.join(monitorDir, f);
            return { name: f, path: fp, mtime: fs.statSync(fp).mtime };
        }).sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0) {
            const content = fs.readFileSync(files[0].path, 'utf-8');
            return { success: true, data: JSON.parse(content) };
        }
    }
    return { success: false, error: '结果文件不存在' };
});

// ═══ Logs ═══
createEndpoint('/api/logs/read', async (body) => {
    const logDirMap = {
        main: services.config.getMainConfig().logDir,
        server: services.config.getServerConfig().logDir,
        test: services.config.getTestConfig().logDir,
        monitor: services.config.getMonitorConfig().logDir,
        analyzer: services.config.getAnalyzerConfig().logDir,
        express: services.config.getServerConfig().expressLogDir || 'logs/express_service'
    };
    const logDir = logDirMap[body.moduleName] || `logs/${body.moduleName}`;
    const logDirPath = path.join(process.cwd(), logDir);
    if (!fs.existsSync(logDirPath)) return { success: true, data: `日志目录不存在: ${logDirPath}` };
    let targetFile;
    if (body.fileName) {
        targetFile = path.join(logDirPath, body.fileName);
        if (!fs.existsSync(targetFile)) return { success: true, data: `日志文件不存在: ${body.fileName}` };
    } else {
        const files = fs.readdirSync(logDirPath).filter(f => f.endsWith('.log')).map(f => {
            const fp = path.join(logDirPath, f);
            return { name: f, path: fp, mtime: fs.statSync(fp).mtime };
        }).sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) return { success: true, data: `目录 ${logDirPath} 中暂无 .log 文件` };
        targetFile = files[0].path;
    }
    const content = fs.readFileSync(targetFile, 'utf-8');
    const lines = content.split('\n');
    const tail = lines.slice(-(body.tailLines || 200)).join('\n');
    if (!tail.trim()) return { success: true, data: `[日志文件为空或暂无内容: ${path.basename(targetFile)}]` };
    return { success: true, data: tail };
});

createEndpoint('/api/logs/list', async (body) => {
    const logDirMap = {
        main: services.config.getMainConfig().logDir,
        server: services.config.getServerConfig().logDir,
        test: services.config.getTestConfig().logDir,
        monitor: services.config.getMonitorConfig().logDir,
        analyzer: services.config.getAnalyzerConfig().logDir,
        express: services.config.getServerConfig().expressLogDir || 'logs/express_service'
    };
    const logDir = logDirMap[body.moduleName] || `logs/${body.moduleName}`;
    const logDirPath = path.join(process.cwd(), logDir);
    if (!fs.existsSync(logDirPath)) return { success: true, data: [] };
    const files = fs.readdirSync(logDirPath).filter(f => f.endsWith('.log')).map(f => {
        const fp = path.join(logDirPath, f);
        const stat = fs.statSync(fp);
        return { name: f, size: stat.size, mtime: stat.mtime };
    }).sort((a, b) => b.mtime - a.mtime);
    return { success: true, data: files };
});

createEndpoint('/api/logs/delete', async (body) => {
    const logDirMap = {
        main: services.config.getMainConfig().logDir,
        server: services.config.getServerConfig().logDir,
        test: services.config.getTestConfig().logDir,
        monitor: services.config.getMonitorConfig().logDir,
        analyzer: services.config.getAnalyzerConfig().logDir,
        express: services.config.getServerConfig().expressLogDir || 'logs/express_service'
    };
    const logDir = logDirMap[body.moduleName] || `logs/${body.moduleName}`;
    const logDirPath = path.join(process.cwd(), logDir);
    const targetFile = path.join(logDirPath, body.fileName);
    const realDir = fs.realpathSync(logDirPath);
    const realTarget = fs.realpathSync(targetFile);
    if (!realTarget.startsWith(realDir)) return { success: false, error: '非法文件路径' };
    if (!fs.existsSync(targetFile)) return { success: false, error: '文件不存在' };
    fs.unlinkSync(targetFile);
    return { success: true };
});

// ═══ System ═══
createEndpoint('/api/system/stats', async () => {
    const cpu = getCpuUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = parseFloat(((usedMem / totalMem) * 100).toFixed(1));
    return {
        success: true,
        data: { cpu, memory: memPercent, memoryUsed: Math.round(usedMem / 1024 / 1024), memoryTotal: Math.round(totalMem / 1024 / 1024), uptime: os.uptime(), platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length }
    };
});

// ═══ Shell ═══
createEndpoint('/api/shell/openPath', async (body) => {
    if (!fs.existsSync(body.filePath)) return { success: false, error: '文件不存在' };
    // In browser mode, just return success; actual opening would need different mechanism
    return { success: true };
});

// Serve static files with HTML injection
const uiDir = path.join(process.cwd(), 'ui');

app.get('/', (req, res) => {
    res.redirect('/view/index.html');
});

app.get('/view/index.html', (req, res) => {
    const htmlPath = path.join(uiDir, 'view', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');
    // Inject browser API script before the first <script> tag
    const injectScript = '<script src="/js/browser-api.js"></script>';
    html = html.replace('<script', injectScript + '\n    <script');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
});

// Serve browser-api.js
app.get('/js/browser-api.js', (req, res) => {
    const apiPath = path.join(uiDir, 'js', 'browser-api.js');
    if (fs.existsSync(apiPath)) {
        res.setHeader('Content-Type', 'application/javascript');
        res.sendFile(apiPath);
    } else {
        res.status(404).send('Not found');
    }
});

// Serve other static files
app.use('/css', express.static(path.join(uiDir, 'css')));
app.use('/js', express.static(path.join(uiDir, 'js')));
app.use('/view', express.static(path.join(uiDir, 'view')));
app.use('/assets', express.static(path.join(uiDir, 'assets')));

const PORT = 3456;

async function main() {
    await initializeServices();
    app.listen(PORT, () => {
        console.log(`Browser GUI server running at http://localhost:${PORT}`);
    });
}

main().catch(console.error);
