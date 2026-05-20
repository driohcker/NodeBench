const path = require('path');
const fs = require('fs');
const ServModuleService = require('../service/serv_module_service');
const TestModuleService = require('../service/test_module_service');
const MonitorModuleService = require('../service/monitor_module_service');
const AnalyzerModuleService = require('../service/analyzer_module_service');
const Logger = require('../utils/logger');

/**
 * 主控端控制器 - 统一管理所有子模块
 * 提供对测试端、监测端、服务器端、分析端的统一控制
 * 
 * 自动化拐点探测流程（主控端负责调控）：
 * 1. 启动被测服务
 * 2. 初始化测试流程（生成sessionId、为各目标生成session2Id）
 * 3. 逐个启动子流程：
 *    a. 启动监测端
 *    b. 发送测试命令到测试端（指定target、sessionId、session2Id）
 *    c. 等待测试子流程完成信号
 *    d. 进入等待期，监听监测端反馈
 *    e. 关闭测试进程、关闭监测进程
 *    f. 完成子流程，标记为已完成
 * 4. 所有子流程完毕 → 调用分析端生成报告
 */
class MainController {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        
        // 子模块服务管理器
        const serverLogger = new Logger(this.config.getServerConfig().logDir);
        this.servModuleService = new ServModuleService(this.config.getServerConfig(), serverLogger);
        
        const testLogger = new Logger(this.config.getTestConfig().logDir);
        this.testModuleService = new TestModuleService(this.config.getTestConfig(), testLogger);
        
        const monitorLogger = new Logger(this.config.getMonitorConfig().logDir);
        this.monitorModuleService = new MonitorModuleService(this.config.getMonitorConfig(), monitorLogger);
        
        const analyzerLogger = new Logger(this.config.getAnalyzerConfig().logDir);
        this.analyzerModuleService = new AnalyzerModuleService(this.config.getAnalyzerConfig(), analyzerLogger);
        
        this.autoTestRunning = false;
        this.autoTestStopped = false;
        this.currentSessionId = null;
        this.bridgeState = { monitorService: null };
        this.autoTestProgress = null;
    }

    async stopAutoTest() {
        this.autoTestStopped = true;
        this.logger.info('[MainController] 收到停止自动化测试命令');
        try {
            const testCmd = await this.testModuleService.getCommand();
            await testCmd.controller.stopTest();
        } catch (e) {}
        try {
            const monCmd = await this.monitorModuleService.getCommand();
            await monCmd.controller.stopMonitor();
        } catch (e) {}
    }

    /**
     * 获取自动化测试整体进度
     * @returns {Object|null} { phase, totalTargets, completedTargets, currentTarget, currentTargetProgress, overallProgress }
     */
    async getAutoTestProgress() {
        if (!this.autoTestRunning || !this.autoTestProgress) return null;
        const p = { ...this.autoTestProgress };
        let overall = 0;
        if (p.phase === 'init') {
            overall = 3;
        } else if (p.phase === 'subflow') {
            const total = Math.max(1, p.totalTargets);
            const targetWeight = 85 / total;
            overall = 5 + p.completedTargets * targetWeight;
            if (p.currentTarget) {
                try {
                    const testCmd = await this.testModuleService.getCommand();
                    let testProgress = 0;
                    if (testCmd && testCmd.controller && testCmd.controller.testRunnerService) {
                        const ts = testCmd.controller.testRunnerService.getTestStatus();
                        testProgress = ts?.progress || 0;
                        p.currentTargetProgress = testProgress;
                    }
                    overall += (testProgress / 100) * targetWeight * 0.9;
                } catch (e) {
                    overall += targetWeight * 0.05;
                }
            }
        } else if (p.phase === 'report') {
            overall = 93;
        } else if (p.phase === 'complete') {
            overall = 100;
        }
        p.overallProgress = Math.min(99, Math.round(Number(overall) || 0));
        if (p.phase === 'complete') p.overallProgress = 100;
        return p;
    }

    async handleServerModuleCommand(command) {
        const serverCommandObj = await this.servModuleService.getCommand();
        return await serverCommandObj.executeCommand(command);
    }

    async handleTestModuleCommand(command) {
        const testCommandObj = await this.testModuleService.getCommand();
        return await testCommandObj.executeCommand(command);
    }

    async handleMonitorModuleCommand(command) {
        const monitorCommandObj = await this.monitorModuleService.getCommand();
        return await monitorCommandObj.executeCommand(command);
    }

    async handleAnalyzerModuleCommand(command) {
        const analyzerCommandObj = await this.analyzerModuleService.getCommand();
        return await analyzerCommandObj.executeCommand(command);
    }

    async runAllModules() {
        await this.handleServerModuleCommand('start');
        await this.handleTestModuleCommand('start');
    }

    /**
     * 一键自动化性能标定流程
     * 主控端负责调控：逐个目标启动监测端→发送测试命令→等待完成→处理监测反馈→生成报告
     */
    async runAutoTest(options = {}) {
        if (this.autoTestRunning) {
            throw new Error('自动化测试流程已在运行中');
        }
        
        this.autoTestRunning = true;
        let sessionId = null;
        
        try {
            this.logger.info('============================================');
            this.logger.info('      🚀 启动自动化性能标定流程');
            this.logger.info('============================================');

            // 1. 启动被测服务
            this.logger.info('[Auto] 步骤 1/5: 启动Express被测服务...');
            await this.handleServerModuleCommand('start');
            await this._waitForServerReady();
            this.logger.info('[Auto] 被测服务已就绪');

            // 2. 读取配置并生成sessionId和各目标session2Id
            this.logger.info('[Auto] 步骤 2/5: 初始化测试流程...');
            const testConfig = this.config.getTestConfig();
            const targets = options.testTargets || testConfig.testTargets || ['cpu'];
            if (options.testTargets) {
                this.logger.info(`[Auto] 使用运行时覆盖的测试目标: ${targets.join(', ')}`);
            }
            const outputMode = testConfig.outputMode || 'file';
            const monitorConfig = this.config.getMonitorConfig();
            const algorithm = monitorConfig.algorithm || 'doubleWindow';
            
            sessionId = Date.now().toString();
            this.currentSessionId = sessionId;
            this.autoTestProgress = {
                phase: 'init',
                totalTargets: targets.length,
                completedTargets: 0,
                currentTarget: null,
                currentTargetProgress: 0,
                overallProgress: 3
            };
            const session2IdMap = {};
            for (const target of targets) {
                session2IdMap[target] = Date.now().toString() + '_' + target;
                await new Promise(r => setTimeout(r, 10));
            }
            this.logger.info(`[Auto] 生成测试流程 sessionId=${sessionId}, 目标: ${targets.join(', ')}`);

            // 3. 逐个执行子流程
            for (let i = 0; i < targets.length; i++) {
                if (this.autoTestStopped) { this.logger.info('[Auto] 自动化流程被中断'); break; }
                const target = targets[i];
                const session2Id = session2IdMap[target];
                this.autoTestProgress.phase = 'subflow';
                this.autoTestProgress.currentTarget = target;
                this.autoTestProgress.completedTargets = i;

                // ═══════════════════════════════════════════════════════════════════════
                //  环境隔离：非首个 target 时重启被测服务，确保每个子测试的纯净性
                //  原因：Express 以 cluster 模式运行，worker 进程中的全局状态
                //  （memory_pool、V8 堆、连接缓存等）会跨测试目标累积残留，
                //  导致后续测试的初始资源基线被污染，拐点识别失真。
                // ═══════════════════════════════════════════════════════════════════════
                if (i > 0) {
                    const prevTarget = targets[i - 1];
                    this.logger.info(`[Auto] 为隔离环境，准备重启被测服务（清理 ${prevTarget} 测试残留）...`);
                    await this.handleServerModuleCommand('stop');
                    await this._waitForServerStopped();
                    this.logger.info('[Auto] 被测服务已停止，准备重新启动...');
                    await this.handleServerModuleCommand('start');
                    await this._waitForServerReady();
                    const subFlowIntervalMs = (testConfig.subFlowInterval || 5) * 1000;
                    if (subFlowIntervalMs > 0) {
                        this.logger.info(`[Auto] 环境净化完成，进入子流程冷却期 ${subFlowIntervalMs}ms...`);
                        await new Promise(r => setTimeout(r, subFlowIntervalMs));
                    }
                    this.logger.info('[Auto] 被测服务已重启并就绪，环境已净化');
                }
                const testDataDir = testConfig.dataOutputDir || 'data/test';
                const session2Dir = path.join(process.cwd(), testDataDir, sessionId, session2Id);
                fs.mkdirSync(session2Dir, { recursive: true });

                // 循环重试逻辑：未检测到拐点时增加MaxVUs重试
                const maxVuLimit = 2000;
                const maxVuIncrement = testConfig.maxVuIncrement || 100;
                let currentMaxVUs = testConfig.maxVUs || 400;
                let retryCount = 0;
                let inflectionDetected = false;

                let metricHandler = null;
                while (currentMaxVUs <= maxVuLimit) {
                    if (this.autoTestStopped) {
                        this.logger.info('[Auto] 自动化流程被中断');
                        await this.handleMonitorModuleCommand('stop');
                        if (metricHandler) {
                            try {
                                const testCmd = await this.testModuleService.getCommand();
                                testCmd.controller.testRunnerService.removeListener('metric', metricHandler);
                            } catch (e) {}
                            metricHandler = null;
                        }
                        break;
                    }
                    retryCount++;
                    this.logger.info(`[Auto] --- 子流程 ${i + 1}/${targets.length}: ${target} (第${retryCount}轮, MaxVUs=${currentMaxVUs}) ---`);

                    // 3.1 启动监测端
                    // 新架构：file 模式和 pipe 模式统一使用 pipe 传输链路
                    // RealtimeDataAdapter 在内部处理数据持久化（当 saveFilePath 不为空时）
                    const monitorMode = 'pipe';
                    await this.handleMonitorModuleCommand(`mode ${monitorMode}`);
                    const monitorSource = 'pipe';
                    const saveFilePath = outputMode === 'file'
                        ? path.join(session2Dir, 'data_points.jsonl')
                        : null;
                    // 直接调用 controller 方法，避免命令字符串解析导致参数错位
                    const monitorCmdObj = await this.monitorModuleService.getCommand();
                    await monitorCmdObj.controller.startMonitor(sessionId, session2Id, monitorSource, target, algorithm, null, saveFilePath);
                    this.logger.info(`[Auto] 监测端已启动: mode=${monitorMode}, target=${target}, saveFilePath=${saveFilePath || 'none'}`);

                    // 3.2 建立测试端→监测端管道数据桥接，并监听RESET/STOP信号
                    let resetSignaled = false;
                    const testCmd = await this.testModuleService.getCommand();
                    const testRunnerService = testCmd.controller.testRunnerService;
                    const monitorCmd = await this.monitorModuleService.getCommand();
                    this.bridgeState.monitorService = monitorCmd.controller.monitorService;
                    
                    metricHandler = (data) => {
                        if (this.bridgeState.monitorService) {
                            this.bridgeState.monitorService.feedMetric(data);
                        }
                    };
                    testRunnerService.on('metric', metricHandler);
                    
                    // 监听监测端RESET信号：有最优拐点但没最大拐点时自动触发reset
                    const resetHandler = (data) => {
                        resetSignaled = true;
                        const reason = data?.reason || 'unknown';
                        if (reason === 'optimal_without_max') {
                            this.logger.info('[Auto] 收到监测端RESET信号：检测到最优拐点但未检测到最大拐点');
                        } else {
                            this.logger.info('[Auto] 收到监测端RESET信号：未检测到拐点');
                        }
                        testRunnerService.onSignal('reset');
                    };
                    monitorCmd.controller.monitorService.once('subFlowCompleteNoInflection', resetHandler);

                    // 监听监测端拐点完成事件：检测到两个拐点后延迟2.5秒提前结束测试端
                    const inflectionStopHandler = async () => {
                        this.logger.info('[Auto] 监测端已检测到两个拐点，2.5秒后提前结束测试端');
                        await new Promise(r => setTimeout(r, 2500));
                        try {
                            const testCmdStop = await this.testModuleService.getCommand();
                            const testRunnerService2 = testCmdStop.controller.testRunnerService;
                            if (testRunnerService2.isRunning) {
                                this.logger.info('[Auto] 发送stop信号到测试端');
                                testRunnerService2.onSignal('stop');
                            }
                        } catch (e) {
                            this.logger.warn('[Auto] 发送stop信号失败: ' + e.message);
                        }
                    };
                    monitorCmd.controller.monitorService.once('inflectionComplete', inflectionStopHandler);

                    this.logger.info('[Auto] 已建立测试端→监测端管道数据桥接，已注册RESET/STOP信号监听');

                    // 3.3 发送测试命令到测试端（单一子流程）
                    const overrides = {
                        target,
                        sessionId,
                        session2Id,
                        outputMode,
                        initVUs: testConfig.initVUs || 1,
                        maxVUs: currentMaxVUs,
                        duration: testConfig.duration || '6s',
                        waitPeriod: testConfig.waitPeriod || 5,
                        maxVuIncrement
                    };
                    await this.handleTestModuleCommand(`start ${JSON.stringify(overrides)}`);
                    this.logger.info(`[Auto] 测试端已启动: target=${target}, maxVUs=${currentMaxVUs}`);

                    // 3.4 等待测试子流程完成
                    const testResult = await this._waitForSubFlowComplete(testRunnerService);
                    this.logger.info(`[Auto] 测试子流程完成: target=${target}, result=${testResult}`);

                    // 如果RESET信号已触发，跳过等待期直接重试
                    if (testResult === 'reset' || resetSignaled) {
                        this.logger.info('[Auto] RESET信号已确认，跳过等待期直接检查状态');
                    } else {
                        // 3.5 等待期：给监测端时间处理数据
                        const waitTime = (testConfig.waitPeriod || 5) * 1000;
                        this.logger.info(`[Auto] 进入等待期 ${waitTime}ms...`);
                        await new Promise(r => setTimeout(r, waitTime));
                    }

                    // 检查监测端状态
                    const monitorStatus = await this.handleMonitorModuleCommand('status');
                    if (!resetSignaled && monitorStatus?.detectedMax && monitorStatus?.detectedOptimal) {
                        this.logger.info('[Auto] 监测端已检测到两个拐点');
                        inflectionDetected = true;
                    }

                    // 3.6 生成数据报告（同一session2Id会覆盖原报告）
                    try {
                        await this.handleMonitorModuleCommand('report');
                        this.logger.info(`[Auto] 数据报告已生成: target=${target}`);
                    } catch (e) {
                        this.logger.warn(`[Auto] 生成数据报告失败: ${e.message}`);
                    }

                    if (inflectionDetected) {
                        // 检测到拐点，停止监测端并退出循环
                        this.autoTestProgress.completedTargets = i + 1;
                        this.autoTestProgress.currentTarget = null;
                        this.autoTestProgress.currentTargetProgress = 0;
                        await this.handleMonitorModuleCommand('stop');
                        // 清理桥接
                        if (metricHandler) {
                            try {
                                const testCmd = await this.testModuleService.getCommand();
                                testCmd.controller.testRunnerService.removeListener('metric', metricHandler);
                            } catch (e) {}
                            metricHandler = null;
                        }
                        break;
                    }

                    // 未检测到拐点，计算下一轮MaxVUs
                    const nextMaxVUs = currentMaxVUs + maxVuIncrement;
                    if (nextMaxVUs > maxVuLimit) {
                        this.logger.warn(`[Auto] 已达到MaxVUs上限(${maxVuLimit})，停止重试`);
                        this.autoTestProgress.completedTargets = i + 1;
                        this.autoTestProgress.currentTarget = null;
                        this.autoTestProgress.currentTargetProgress = 0;
                        await this.handleMonitorModuleCommand('stop');
                        // 清理桥接
                        if (metricHandler) {
                            try {
                                const testCmd = await this.testModuleService.getCommand();
                                testCmd.controller.testRunnerService.removeListener('metric', metricHandler);
                            } catch (e) {}
                            metricHandler = null;
                        }
                        break;
                    }

                    this.logger.info(`[Auto] 未检测到拐点，准备重试: MaxVUs ${currentMaxVUs} → ${nextMaxVUs}`);
                    currentMaxVUs = nextMaxVUs;

                    // 停止监测端，清理桥接，准备下一轮
                    await this.handleMonitorModuleCommand('stop');
                    if (metricHandler) {
                        try {
                            const testCmd = await this.testModuleService.getCommand();
                            testCmd.controller.testRunnerService.removeListener('metric', metricHandler);
                        } catch (e) {}
                        metricHandler = null;
                    }
                    // 子流程间隔：确保资源释放和系统冷却
                    const subFlowIntervalMs2 = (testConfig.subFlowInterval || 5) * 1000;
                    this.logger.info(`[Auto] 进入子流程间隔 ${subFlowIntervalMs2}ms...`);
                    await new Promise(r => setTimeout(r, subFlowIntervalMs2));
                }
            }

            // 4. 生成标定报告
            this.autoTestProgress.phase = 'report';
            this.logger.info('[Auto] 步骤 5/5: 生成标定报告...');
            try {
                await this.handleAnalyzerModuleCommand(`analyze ${sessionId}`);
                await this.handleAnalyzerModuleCommand(`benchmark ${sessionId}`);
            } catch (e) {
                this.logger.warn(`[Auto] 生成标定报告失败: ${e.message}`);
            }
            
            this.logger.info('============================================');
            this.logger.info('      ✅ 自动化性能标定流程完成！');
            this.logger.info(`      📊 Session ID: ${sessionId}`);
            this.logger.info('============================================');
            
            this.autoTestProgress.phase = 'complete';
            this.autoTestProgress.overallProgress = 100;
            return { success: true, sessionId };
        } catch (error) {
            this.logger.error('[Auto] 自动化流程失败:', error.message);
            throw error;
        } finally {
            this.autoTestRunning = false;
            this.autoTestStopped = false;
            this.currentSessionId = null;
            try { await this.handleMonitorModuleCommand('stop'); } catch (e) {}
        }
    }

    /**
     * 等待单一测试子流程完成
     */
    async _waitForSubFlowComplete(testRunnerService) {
        return new Promise((resolve) => {
            if (!testRunnerService.isRunning) {
                resolve(testRunnerService.lastResult || 'complete');
                return;
            }
            const onComplete = (data) => {
                testRunnerService.removeListener('subFlowComplete', onComplete);
                resolve(data?.result || 'complete');
            };
            testRunnerService.once('subFlowComplete', onComplete);
        });
    }

    /**
     * 轮询等待被测服务完全停止
     */
    async _waitForServerStopped(timeoutMs = 15000, intervalMs = 500) {
        const http = require('http');
        const serverUrl = this.config.getServerConfig().serverUrl || 'http://localhost:10000';
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            try {
                await new Promise((resolve, reject) => {
                    const req = http.get(serverUrl, (res) => {
                        // 服务仍在响应，继续等待
                        reject(new Error('服务仍在运行'));
                    });
                    req.on('error', () => {
                        // 连接失败 = 服务已停止
                        resolve();
                    });
                    req.setTimeout(1000, () => {
                        req.destroy();
                        resolve();
                    });
                });
                this.logger.info('[Auto] 被测服务已确认停止');
                return;
            } catch (e) {
                // 服务还在运行，继续等待
            }
            await new Promise(r => setTimeout(r, intervalMs));
        }
        this.logger.warn(`[Auto] 等待被测服务停止超时 (${timeoutMs}ms)，继续执行`);
    }

    /**
     * 轮询等待被测服务端口就绪
     */
    async _waitForServerReady(timeoutMs = 30000, intervalMs = 500) {
        const http = require('http');
        const serverUrl = this.config.getServerConfig().serverUrl || 'http://localhost:10000';
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            try {
                await new Promise((resolve, reject) => {
                    const req = http.get(serverUrl, (res) => {
                        if (res.statusCode === 200) {
                            resolve();
                        } else {
                            reject(new Error(`状态码: ${res.statusCode}`));
                        }
                    });
                    req.on('error', reject);
                    req.setTimeout(1000, () => {
                        req.destroy();
                        reject(new Error('超时'));
                    });
                });
                this.logger.info('[Auto] 被测服务已就绪');
                return;
            } catch (e) {
                // 服务尚未就绪，继续等待
            }
            await new Promise(r => setTimeout(r, intervalMs));
        }
        throw new Error(`等待被测服务就绪超时 (${timeoutMs}ms)`);
    }

    async getConfig(isAll = '') {
        try {
            const globalConfig = this.config.getGlobalConfig();
            this.logger.info('============================================');
            this.logger.info('            全局配置');
            this.logger.info('============================================');
            Object.keys(globalConfig).forEach(key => {
                const val = globalConfig[key];
                if (typeof val !== 'function') {
                    this.logger.info(`${key}: ${JSON.stringify(val)}`);
                }
            });
            this.logger.info('============================================');

            const conf = this.config.getMainConfig();
            this.logger.info('============================================');
            this.logger.info('            主控端配置');
            this.logger.info('============================================');
            Object.keys(conf).forEach(key => {
                const val = conf[key];
                if (typeof val !== 'function') {
                    this.logger.info(`${key}: ${JSON.stringify(val)}`);
                }
            });
            this.logger.info('============================================');

            if (isAll === 'all') {
                await this.handleServerModuleCommand('config');
                await this.handleTestModuleCommand('config');
                await this.handleMonitorModuleCommand('config');
                await this.handleAnalyzerModuleCommand('config');
            }
            return conf;
        } catch (error) {
            this.logger.error('获取配置失败', { error: error.message });
        }
    }

    async exit(exit = 'true') {
        await this.handleServerModuleCommand('exit false');
        await this.handleTestModuleCommand('exit false');
        await this.handleMonitorModuleCommand('exit false');
        await this.handleAnalyzerModuleCommand('exit false');
        if (exit === 'true') {
            this.logger.info('MainModule: 退出程序');
            process.exit(0);
        }
    }
}

module.exports = MainController;
