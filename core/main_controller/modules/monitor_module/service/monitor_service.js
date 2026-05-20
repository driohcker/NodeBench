const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const RealtimeDataAdapter = require('../helper/RealtimeDataAdapter');
const TailReader = require('../helper/TailReader');
const SystemResourceCollector = require('../helper/SystemResourceCollector');

/**
 * MonitorService - 监测服务
 * 支持文件tail模式和管道监听模式
 * 通过 RealtimeDataAdapter 将实时指标流推送给分析策略插件
 */
class MonitorService extends EventEmitter {
    constructor(config, logger) {
        super();
        this.config = config;
        this.logger = logger;

        this.adapter = null;
        this.strategy = null;
        this.resourceCollector = new SystemResourceCollector(logger);
        this.tailReader = null;
        this.rl = null;
        this.fileStream = null;

        this.monitorMode = config.monitorMode || 'tail';
        this.isMonitoring = false;
        this.sessionId = null;
        this.session2Id = null;
        this.target = null;
    }

    /**
     * 启动监测进程
     * @param {string} sessionId - 测试流程sessionId
     * @param {string} session2Id - 子流程session2Id
     * @param {string} source - 监测源（文件路径或'pipe'）
     * @param {string} target - 测试目标
     * @param {string} strategyName - 分析策略名称（如 'doubleWindow'）
     */
    startMonitor(sessionId, session2Id, source, target, strategyName, strategyParams = null, saveFilePath = null) {
        if (this.isMonitoring) {
            throw new Error('监测进程已在运行中');
        }

        this.sessionId = sessionId;
        this.session2Id = session2Id;
        this.target = target || 'unknown';
        this.isMonitoring = true;

        // 加载并实例化分析策略（支持临时参数覆盖）
        this._loadStrategy(strategyName || this.config.algorithm || 'doubleWindow', strategyParams);

        // 创建实时数据流适配器，绑定策略和资源采集器
        // saveFilePath 不为空时，适配器会同时持久化标准化数据点到文件
        this.adapter = new RealtimeDataAdapter(this.config, this.logger, this.strategy, this.resourceCollector, saveFilePath);
        this.adapter.start();

        // 绑定策略拐点事件
        this.strategy.on('optimal', (data) => this._onOptimalDetected(data));
        this.strategy.on('max', (data) => this._onMaxDetected(data));
        this.strategy.on('complete', (data) => this._onDetectionComplete(data));

        this.logger.info(`[MonitorService] 启动监测: sessionId=${sessionId}, session2Id=${session2Id}, mode=${this.monitorMode}, strategy=${strategyName}, target=${this.target}`);

        if (this.monitorMode === 'tail' && source && source !== 'pipe') {
            this._startTailMode(source);
        } else if (this.monitorMode === 'pipe') {
            this._startPipeMode();
        } else {
            const filePath = path.join(process.cwd(), this.config.dataOutputDir || 'data/test', sessionId, session2Id, 'metrics.json');
            this._startTailMode(filePath);
        }

        return { success: true, mode: this.monitorMode };
    }

    /**
     * 动态加载分析策略插件
     */
    _loadStrategy(strategyName, strategyParams = null) {
        const strategyDir = path.join(process.cwd(), 'scripts', 'analyze_strategy');
        // 首字母大写 + Strategy 后缀
        const fileName = strategyName.charAt(0).toUpperCase() + strategyName.slice(1) + 'Strategy.js';
        const strategyPath = path.join(strategyDir, fileName);

        if (!fs.existsSync(strategyPath)) {
            throw new Error(`分析策略不存在: ${strategyPath}`);
        }

        delete require.cache[require.resolve(strategyPath)];
        const StrategyClass = require(strategyPath);
        // 优先读取策略独立配置，否则回退到 monitor 配置（兼容旧配置）
        const strategyKey = fileName.replace('.js', '');
        let strategyConfig = this.config;
        // 尝试从全局配置读取策略独立配置，同时合并 strategies 顶层通用字段
        try {
            const configPath = path.join(process.cwd(), 'core', 'main_controller', 'utils', 'config');
            const ConfigManager = require(configPath);
            const allConfig = ConfigManager.getAll();
            if (allConfig.strategies) {
                const { DoubleWindowStrategy, CusumStrategy, SlopeChangeStrategy, postProcess, ...commonStrategyConfig } = allConfig.strategies;
                const specificConfig = allConfig.strategies[strategyKey] || {};
                strategyConfig = { ...this.config, ...commonStrategyConfig, ...specificConfig };
            }
        } catch (e) {
            this.logger.warn(`[MonitorService] 读取全局策略配置失败: ${e.message}`);
        }
        // 临时参数覆盖（GUI传入，不写入配置文件）
        if (strategyParams && typeof strategyParams === 'object') {
            strategyConfig = { ...strategyConfig, ...strategyParams };
            this.logger.info(`[MonitorService] 应用临时策略参数: ${JSON.stringify(strategyParams)}`);
        }
        // 将测试目标传入策略，用于资源负载判断
        strategyConfig = { ...strategyConfig, target: this.target };
        this.strategy = new StrategyClass(strategyConfig, this.logger);
        this.logger.info(`[MonitorService] 已加载分析策略: ${fileName}, 配置=${JSON.stringify({ windowSize: strategyConfig.windowSize, threshold: strategyConfig.threshold, sustainCount: strategyConfig.sustainCount, minDataPoints: strategyConfig.minDataPoints, baselinePoints: strategyConfig.baselinePoints, cMultiplier: strategyConfig.cMultiplier, HMultiplier: strategyConfig.HMultiplier, slopeThreshold: strategyConfig.slopeThreshold })}`);
    }

    /**
     * 从文件启动tail模式监测
     */
    _startTailMode(filePath) {
        this.logger.info(`[MonitorService] Tail模式监测文件: ${filePath}`);

        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n').filter(l => l.trim());
                this.logger.info(`[MonitorService] 加载已有数据: ${lines.length} 行`);
                for (const line of lines) {
                    this._processLine(line);
                }
            } catch (e) {
                this.logger.warn(`[MonitorService] 读取已有数据失败: ${e.message}`);
            }
        }

        const startTail = () => {
            this.tailReader = new TailReader(filePath, { interval: this.config.monitorInterval || 200, logger: this.logger });
            this.tailReader.on('line', (line) => this._processLine(line));
            this.tailReader.start();
        };

        if (!fs.existsSync(filePath)) {
            this.logger.warn(`[MonitorService] 监测文件不存在，等待创建: ${filePath}`);
            const checkTimer = setInterval(() => {
                if (fs.existsSync(filePath)) {
                    clearInterval(checkTimer);
                    startTail();
                }
            }, 500);
            setTimeout(() => {
                clearInterval(checkTimer);
                if (!this.tailReader) {
                    this.logger.error(`[MonitorService] 等待监测文件超时: ${filePath}`);
                }
            }, 30000);
        } else {
            startTail();
        }
    }

    /**
     * 启动管道监听模式
     */
    _startPipeMode() {
        this.logger.info('[MonitorService] 管道监听模式已就绪，等待数据输入');
    }

    /**
     * 直接向监测器喂数据（管道模式使用）
     */
    feedMetric(data) {
        if (!this.isMonitoring || !this.adapter) return;

        // 管道模式下 SubFlowComplete 标记直接到达 feedMetric，不会经过 _processLine
        // 在此处理 RESET 信号：有最优拐点但没最大拐点时通知主控端重置子流程
        try {
            const obj = typeof data === 'string' ? JSON.parse(data) : data;
            if (obj.type === 'SubFlowComplete') {
                this.logger.info(`[MonitorService] 检测到子流程完毕标记: ${obj.session2Id}`);
                const status = this.strategy.getStatus();

                // 只在有最优拐点但没最大拐点时发送RESET信号，让主控端重置此子流程
                if (status.detectedOptimal && !status.detectedMax) {
                    this.logger.info(`[MonitorService] 子流程结束时检测到最优拐点但未检测到最大拐点，发送RESET信号`);
                    this.emit('subFlowCompleteNoInflection', {
                        sessionId: this.sessionId,
                        session2Id: this.session2Id,
                        target: this.target,
                        reason: 'optimal_without_max'
                    });
                } else if (!status.detectedOptimal && !status.detectedMax) {
                    this.logger.info(`[MonitorService] 子流程结束时未检测到任何拐点，发送RESET信号`);
                    this.emit('subFlowCompleteNoInflection', {
                        sessionId: this.sessionId,
                        session2Id: this.session2Id,
                        target: this.target,
                        reason: 'no_inflection'
                    });
                }
                return;
            }
        } catch (e) {
            // 非JSON数据，继续传给adapter
        }

        this.adapter.feed(data);
    }

    /**
     * 处理一行数据
     */
    _processLine(line) {
        if (!this.isMonitoring || !this.adapter) return;

        try {
            const obj = JSON.parse(line);
            if (obj.type === 'SubFlowComplete') {
                this.logger.info(`[MonitorService] 检测到子流程完毕标记: ${obj.session2Id}`);
                const status = this.strategy.getStatus();

                // 只在有最优拐点但没最大拐点时发送RESET信号，让主控端重置此子流程
                if (status.detectedOptimal && !status.detectedMax) {
                    this.logger.info(`[MonitorService] 子流程结束时检测到最优拐点但未检测到最大拐点，发送RESET信号`);
                    this.emit('subFlowCompleteNoInflection', {
                        sessionId: this.sessionId,
                        session2Id: this.session2Id,
                        target: this.target,
                        reason: 'optimal_without_max'
                    });
                } else if (!status.detectedOptimal && !status.detectedMax) {
                    this.logger.info(`[MonitorService] 子流程结束时未检测到任何拐点，发送RESET信号`);
                    this.emit('subFlowCompleteNoInflection', {
                        sessionId: this.sessionId,
                        session2Id: this.session2Id,
                        target: this.target,
                        reason: 'no_inflection'
                    });
                }
                return;
            }
        } catch (e) {
            // 不是JSON或解析失败，继续传给adapter
        }

        this.adapter.feed(line);
    }

    _onOptimalDetected(data) {
        this.logger.info(`[MonitorService] 最优拐点: VUs=${data.vus}, 延迟=${data.latency}ms`);
    }

    _onMaxDetected(data) {
        this.logger.info(`[MonitorService] 最大拐点: VUs=${data.vus}, 延迟=${data.latency}ms`);
    }

    _onDetectionComplete(data) {
        this.logger.info('[MonitorService] 两个拐点均检测完成');
        if (this.listenerCount('inflectionComplete') > 0) {
            this.emit('inflectionComplete', {
                sessionId: this.sessionId,
                session2Id: this.session2Id,
                ...data
            });
        }
    }

    /**
     * 停止监测进程
     */
    stopMonitor() {
        this.logger.info('[MonitorService] 停止监测进程');
        this.isMonitoring = false;

        if (this.tailReader) {
            this.tailReader.stop();
            this.tailReader = null;
        }
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        if (this.fileStream) {
            this.fileStream.destroy();
            this.fileStream = null;
        }
        if (this.adapter) {
            this.adapter.stop();
        }
        if (this.strategy) {
            this.strategy.removeAllListeners();
        }

        this.logger.info('[MonitorService] 监测进程已停止');
        return { success: true };
    }

    /**
     * 选择监测模式
     */
    setMonitorMode(mode) {
        if (!['tail', 'pipe'].includes(mode)) {
            throw new Error(`不支持的监测模式: ${mode}`);
        }
        this.monitorMode = mode;
        this.logger.info(`[MonitorService] 监测模式已设置为: ${mode}`);
        return { success: true, mode };
    }

    /**
     * 选择拐点识别算法（切换策略）
     */
    setAlgorithm(algorithm) {
        if (!this.strategy) {
            throw new Error('监测未启动，无法切换算法');
        }
        // 清理旧策略的事件监听
        this.strategy.removeAllListeners();
        this._loadStrategy(algorithm);
        if (this.adapter) {
            this.adapter.strategy = this.strategy;
            this.adapter.start(); // 重新启动adapter和strategy
        }
        // 重新绑定事件
        this.strategy.on('optimal', (data) => this._onOptimalDetected(data));
        this.strategy.on('max', (data) => this._onMaxDetected(data));
        this.strategy.on('complete', (data) => this._onDetectionComplete(data));
        this.logger.info(`[MonitorService] 拐点识别算法已设置为: ${algorithm}`);
        return { success: true, algorithm };
    }

    /**
     * 获取当前测试数据
     */
    getCurrentMetrics() {
        if (!this.strategy) {
            return { vus: 0, tps: 0, latency: 0, dataPoints: 0 };
        }
        const status = this.strategy.getStatus();
        const lastPoint = status.history.latency.length > 0
            ? status.history.latency[status.history.latency.length - 1]
            : null;
        const lastRps = status.history.rps.length > 0
            ? status.history.rps[status.history.rps.length - 1]
            : null;
        return {
            vus: status.currentVUs,
            tps: lastRps ? parseFloat(lastRps.v.toFixed(2)) : 0,
            latency: lastPoint ? parseFloat(lastPoint.v.toFixed(2)) : 0,
            dataPoints: status.dataPoints
        };
    }

    /**
     * 获取监测状态
     */
    getMonitorStatus() {
        if (!this.strategy) {
            return {
                isMonitoring: this.isMonitoring,
                sessionId: this.sessionId,
                session2Id: this.session2Id,
                mode: this.monitorMode,
                running: false,
                detectedOptimal: false,
                detectedMax: false,
                optimalPoint: null,
                maxPoint: null,
                currentVUs: 0,
                dataPoints: 0,
                algorithm: null,
                history: { vus: [], latency: [], rps: [], errors: [] }
            };
        }
        const strategyStatus = this.strategy.getStatus();
        return {
            isMonitoring: this.isMonitoring,
            sessionId: this.sessionId,
            session2Id: this.session2Id,
            target: this.target,
            mode: this.monitorMode,
            ...strategyStatus
        };
    }

    /**
     * 生成数据报告
     */
    generateDataReport() {
        try {
            if (!this.strategy) {
                throw new Error('监测未启动，无法生成数据报告');
            }

            const inflectionPoints = this.strategy.getInflectionPoints();
            if (!inflectionPoints.optimal && !inflectionPoints.max) {
                throw new Error('尚未检测到任何拐点，无法生成数据报告');
            }

            const targetName = this.target || 'unknown';
            const report = this.strategy.generateReport({
                sessionId: this.sessionId,
                session2Id: this.session2Id,
                target: targetName,
                mode: this.monitorMode
            });

            // 保存到 monitor 配置的数据报告目录，按 sessionId 分组
            const reportDir = path.join(process.cwd(), this.config.dataReportDir || 'data/monitor', this.sessionId);
            fs.mkdirSync(reportDir, { recursive: true });

            const reportPath = path.join(reportDir, `data_report_${this.session2Id}_${targetName}.json`);
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

            this.logger.info(`[MonitorService] 数据报告已生成: ${reportPath}`);
            return { success: true, reportPath };
        } catch (error) {
            this.logger.error(`[MonitorService] 生成数据报告失败: ${error.message}`);
            throw error;
        }
    }
}

module.exports = MonitorService;
