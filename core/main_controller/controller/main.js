const path = require('path');
const ServModuleService = require('../service/serv_module_service');
const TestModuleService = require('../service/test_module_service');
const MonitorModuleService = require('../service/monitor_module_service');
const AnalyzerModuleService = require('../service/analyzer_module_service');
const Logger = require('../utils/logger');

/**
 * 主控端控制器 - 统一管理所有子模块
 * 提供对测试端、监测端、服务器端、分析端的统一控制
 * 
 * 自动化拐点探测流程：
 * 1. 启动被测服务
 * 2. 启动测试端（生成sessionId，开始测试）
 * 3. 启动监测端（根据输出模式选择tail或pipe）
 * 4. 轮询监测状态：
 *    - 检测到两个拐点 -> 发送"停止"信号给测试端
 *    - 子流程完毕未检测到拐点 -> 发送"重置"信号给测试端（提升MaxVUs重试）
 * 5. 所有子流程完毕 -> 调用分析端生成报告
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
        this.currentSessionId = null;
        this.bridgeState = { monitorService: null };
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
     * 一键自动化性能标定流程（Auto-PIP 模式）
     */
    async runAutoTest() {
        if (this.autoTestRunning) {
            throw new Error('自动化测试流程已在运行中');
        }
        
        this.autoTestRunning = true;
        let sessionId = null;
        let metricHandler = null;
        
        try {
            this.logger.info('============================================');
            this.logger.info('      🚀 启动自动化性能标定流程 (Auto-PIP)');
            this.logger.info('============================================');

            // 1. 启动被测服务
            this.logger.info('[Auto] 步骤 1/5: 启动Express被测服务...');
            await this.handleServerModuleCommand('start');
            await this._waitForServerReady();
            this.logger.info('[Auto] 被测服务已就绪');

            // 2. 启动测试端
            this.logger.info('[Auto] 步骤 2/5: 启动测试端...');
            const testResult = await this.handleTestModuleCommand('start');
            sessionId = testResult?.sessionId;
            this.currentSessionId = sessionId;
            
            if (!sessionId) {
                throw new Error('测试启动失败，未获取到sessionId');
            }
            this.logger.info(`[Auto] 测试已启动，sessionId=${sessionId}`);
            
            // 等待k6进程启动及第一个子流程初始化
            await new Promise(r => setTimeout(r, 2000));
            
            // 3. 获取测试状态以确定第一个子流程的session2Id
            const testStatus = await this.handleTestModuleCommand('status');
            const currentSession2Id = testStatus?.currentSession2Id;
            const outputMode = testStatus?.outputMode || 'file';
            
            // 4. 启动监测端
            this.logger.info('[Auto] 步骤 3/5: 启动监测端...');
            const monitorMode = outputMode === 'pipe' ? 'pipe' : 'tail';
            await this.handleMonitorModuleCommand(`mode ${monitorMode}`);
            
            let monitorSource;
            if (monitorMode === 'tail') {
                monitorSource = path.join(process.cwd(), 'data', 'test', sessionId, currentSession2Id, 'metrics.json');
            } else {
                monitorSource = 'pipe';
            }
            
            await this.handleMonitorModuleCommand(`start ${sessionId} ${currentSession2Id} ${monitorSource}`);
            this.logger.info(`[Auto] 监测端已启动，mode=${monitorMode}`);
            
            // 5. 管道模式下，建立测试端到监测端的数据桥接
            let resetHandler = null;
            this.bridgeState = { monitorService: null };
            if (outputMode === 'pipe') {
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
                
                // 监听子流程完毕但未检测到拐点的事件
                resetHandler = () => {
                    this.logger.info('[Auto] 监测端检测到子流程完毕但未发现拐点，发送reset信号');
                    this.handleTestModuleCommand('signal reset');
                };
                this.bridgeState.monitorService.on('subFlowCompleteNoInflection', resetHandler);
                
                this.logger.info('[Auto] 已建立测试端→监测端管道数据桥接');
            }
            
            // 6. 轮询等待拐点或测试结束
            this.logger.info('[Auto] 步骤 4/5: 实时监测中，等待拐点或测试结束...');
            await this._waitForAutoTestComplete(sessionId, outputMode, metricHandler, resetHandler);
            
            // 7. 生成报告
            this.logger.info('[Auto] 步骤 5/5: 生成分析报告...');
            try {
                await this.handleAnalyzerModuleCommand(`analyze ${sessionId}`);
                await this.handleAnalyzerModuleCommand(`benchmark ${sessionId}`);
            } catch (e) {
                this.logger.warn(`[Auto] 生成报告失败: ${e.message}`);
            }
            
            this.logger.info('============================================');
            this.logger.info('      ✅ 自动化性能标定流程完成！');
            this.logger.info(`      📊 Session ID: ${sessionId}`);
            this.logger.info('============================================');
            
            return { success: true, sessionId };
        } catch (error) {
            this.logger.error('[Auto] 自动化流程失败:', error.message);
            throw error;
        } finally {
            this.autoTestRunning = false;
            this.currentSessionId = null;
            // 移除管道桥接和reset监听
            if (metricHandler) {
                try {
                    const testCmd = await this.testModuleService.getCommand();
                    const testRunnerService = testCmd.controller.testRunnerService;
                    testRunnerService.removeListener('metric', metricHandler);
                } catch (e) {}
            }
            if (resetHandler) {
                try {
                    const monitorCmd = await this.monitorModuleService.getCommand();
                    const monitorService = monitorCmd.controller.monitorService;
                    monitorService.removeListener('subFlowCompleteNoInflection', resetHandler);
                } catch (e) {}
            }
            // 确保清理
            try { await this.handleMonitorModuleCommand('stop'); } catch (e) {}
        }
    }

    /**
     * 轮询等待自动化测试完成
     */
    async _waitForAutoTestComplete(sessionId, outputMode, metricHandler, resetHandler, timeoutMs = 600000, intervalMs = 2000) {
        const startTime = Date.now();
        let lastSession2Id = null;
        
        while (Date.now() - startTime < timeoutMs) {
            try {
                // 获取测试端状态
                const testStatus = await this.handleTestModuleCommand('status');
                
                if (!testStatus?.isRunning) {
                    this.logger.info(`[Auto] 测试流程已自然结束`);
                    await this.handleMonitorModuleCommand('stop');
                    return;
                }
                
                const currentSession2Id = testStatus?.currentSession2Id;
                
                // 如果子流程切换了，重新启动监测端
                if (currentSession2Id && currentSession2Id !== lastSession2Id) {
                    lastSession2Id = currentSession2Id;
                    this.logger.info(`[Auto] 检测到新子流程: ${currentSession2Id}`);
                    
                    await this.handleMonitorModuleCommand('stop');
                    
                    const monitorMode = outputMode === 'pipe' ? 'pipe' : 'tail';
                    await this.handleMonitorModuleCommand(`mode ${monitorMode}`);
                    
                    let monitorSource;
                    if (monitorMode === 'tail') {
                        monitorSource = path.join(process.cwd(), 'data', 'test', sessionId, currentSession2Id, 'metrics.json');
                    } else {
                        monitorSource = 'pipe';
                    }
                    
                    await this.handleMonitorModuleCommand(`start ${sessionId} ${currentSession2Id} ${monitorSource}`);
                    
                    // 重新建立管道桥接：更新bridgeState中的monitorService引用
                    if (outputMode === 'pipe' && this.bridgeState) {
                        const monitorCmd = await this.monitorModuleService.getCommand();
                        this.bridgeState.monitorService = monitorCmd.controller.monitorService;
                    }
                }
                
                // 获取监测端状态
                const monitorStatus = await this.handleMonitorModuleCommand('status');
                
                if (monitorStatus?.detectedMax) {
                    this.logger.info(`[Auto] 监测端检测到最大拐点，发送停止信号`);
                    await this.handleTestModuleCommand('signal stop');
                    // 等待测试端停止当前子流程并进入下一个
                    await new Promise(r => setTimeout(r, 3000));
                } else if (monitorStatus?.isMonitoring && !monitorStatus?.detectedOptimal && !monitorStatus?.detectedMax) {
                    // 检查是否子流程已完毕但未检测到拐点
                    // 简化处理：由监测端通过SubFlowComplete标记判断
                }
                
                // 每10秒打印一次进度
                const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
                if (elapsedSec % 10 === 0 && elapsedSec > 0) {
                    this.logger.info(`[Auto] 测试中... 已运行 ${elapsedSec}s, 当前目标: ${testStatus?.currentTarget || 'unknown'}, 数据点: ${monitorStatus?.dataPoints || 0}`);
                }
            } catch (e) {
                this.logger.warn(`[Auto] 轮询状态失败: ${e.message}`);
            }
            
            await new Promise(r => setTimeout(r, intervalMs));
        }
        
        throw new Error(`等待测试完成超时 (${timeoutMs}ms)`);
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
