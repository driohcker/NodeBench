const { EventEmitter } = require('events');

/**
 * BaseStrategy - 分析策略基类
 * 所有分析策略插件必须继承此类。
 * 提供公共的状态管理、拐点处理、性能历史记录和数据报告生成能力。
 * 子类只需实现算法核心逻辑（_detect、_isTriggered、_getResult、_resetAlgorithm）。
 */
class BaseStrategy extends EventEmitter {
    constructor(config, logger) {
        super();
        this.config = config;
        this.logger = logger;

        // 算法标识（子类必须覆盖）
        this.algorithmName = 'base';

        // 拐点检测状态
        this.detectedOptimal = false;
        this.detectedMax = false;
        this.optimalPoint = null;
        this.maxPoint = null;

        // 性能历史记录（标准化数据点数组）——保留完整数据以确保图表展示全貌
        this.performanceHistory = [];

        // 启动时间（用于计算 elapsedMs）
        this.startTime = null;

        // 数据点计数
        this.dataPointCount = 0;
    }

    /**
     * 启动策略（开始接收数据）
     */
    init() {
        this.startTime = Date.now();
        this.detectedOptimal = false;
        this.detectedMax = false;
        this.optimalPoint = null;
        this.maxPoint = null;
        this.performanceHistory = [];
        this.dataPointCount = 0;
        this._resetAlgorithm();
        this.logger.info(`[${this.constructor.name}] 策略已启动，算法=${this.algorithmName}`);
    }

    /**
     * 接收一个标准化数据点
     * @param {Object} point - {timestamp, vus, latency, rps, errorRate}
     */
    onDataPoint(point) {
        if (!this.startTime) return;

        // 保存性能历史（完整保留，不截断）
        this.performanceHistory.push(point);
        this.dataPointCount++;

        // 计算已运行时间
        const elapsedMs = point.timestamp - this.startTime;

        // 调用子类算法核心
        this._detect(point, elapsedMs);

        // 检查是否触发拐点
        if (this._isTriggered()) {
            const result = this._getResult();
            this._handleInflection(result, point, elapsedMs);
        }
    }

    /**
     * 通用拐点处理：先检测最优拐点，重置后再检测最大拐点
     */
    _handleInflection(result, point, elapsedMs) {
        if (!this.detectedOptimal) {
            this.detectedOptimal = true;
            this.optimalPoint = {
                type: 'optimal',
                timestamp: new Date().toISOString(),
                vus: result.vus || point.vus,
                latency: result.avgLatencyCurrMs || point.latency,
                rps: parseFloat((result.rps || point.rps || 0).toFixed(2)),
                ratio: result.ratio,
                algorithm: this.algorithmName,
                elapsedMs
            };
            this.logger.info(`[${this.constructor.name}] 最优拐点检测! VUs=${this.optimalPoint.vus}, 延迟=${this.optimalPoint.latency}ms`);
            this.emit('optimal', this.optimalPoint);

            // 重置算法继续检测最大拐点
            this._resetAlgorithm();
        } else if (!this.detectedMax) {
            this.detectedMax = true;
            this.maxPoint = {
                type: 'max',
                timestamp: new Date().toISOString(),
                vus: result.vus || point.vus,
                latency: result.avgLatencyCurrMs || point.latency,
                rps: parseFloat((result.rps || point.rps || 0).toFixed(2)),
                ratio: result.ratio,
                algorithm: this.algorithmName,
                elapsedMs
            };
            this.logger.info(`[${this.constructor.name}] 最大拐点检测! VUs=${this.maxPoint.vus}, 延迟=${this.maxPoint.latency}ms`);
            this.emit('max', this.maxPoint);
            this.emit('complete', { optimal: this.optimalPoint, max: this.maxPoint });
        }
    }

    /**
     * 获取当前运行状态
     */
    getStatus() {
        const lastPoint = this.performanceHistory.length > 0
            ? this.performanceHistory[this.performanceHistory.length - 1]
            : null;
        return {
            running: this.startTime !== null,
            detectedOptimal: this.detectedOptimal,
            detectedMax: this.detectedMax,
            optimalPoint: this.optimalPoint,
            maxPoint: this.maxPoint,
            currentVUs: lastPoint ? lastPoint.vus : 0,
            dataPoints: this.dataPointCount,
            algorithm: this.algorithmName,
            history: {
                vus: this.performanceHistory.map(p => ({ t: p.timestamp, v: p.vus })),
                latency: this.performanceHistory.map(p => ({ t: p.timestamp, v: p.latency })),
                rps: this.performanceHistory.map(p => ({ t: p.timestamp, v: p.rps })),
                errors: this.performanceHistory.map(p => ({ t: p.timestamp, v: p.errorRate })),
                resources: this.performanceHistory.map(p => ({
                    t: p.timestamp,
                    cpu: p.resourceUtilization?.cpu || 0,
                    memory: p.resourceUtilization?.memory || 0,
                    io: p.resourceUtilization?.io || 0,
                    disk: p.resourceUtilization?.disk || 0
                }))
            }
        };
    }

    /**
     * 获取已检测到的拐点
     */
    getInflectionPoints() {
        return {
            optimal: this.optimalPoint,
            max: this.maxPoint
        };
    }

    /**
     * 生成标准格式的数据报告
     * @param {Object} sessionInfo - {sessionId, session2Id, target, mode}
     */
    generateReport(sessionInfo) {
        const { sessionId, session2Id, target, mode } = sessionInfo;
        const inflectionPoints = this.getInflectionPoints();

        if (!inflectionPoints.optimal && !inflectionPoints.max) {
            throw new Error('尚未检测到任何拐点，无法生成数据报告');
        }

        // 构建性能数据序列
        const performanceData = this.performanceHistory.map((p, index) => ({
            index,
            timestamp: p.timestamp,
            vus: p.vus,
            latency: parseFloat(p.latency.toFixed(2)),
            rps: parseFloat(p.rps.toFixed(2)),
            errorRate: p.errorRate || 0,
            resourceUtilization: p.resourceUtilization || { cpu: 0, memory: 0, io: 0, disk: 0 }
        }));

        // 按VUs负载分组聚合统计
        const vusLoadMap = new Map();
        for (const item of this.performanceHistory) {
            const vusKey = item.vus || 0;
            if (!vusLoadMap.has(vusKey)) {
                vusLoadMap.set(vusKey, { latencies: [], rpsValues: [], errorRates: [], resources: [] });
            }
            const bucket = vusLoadMap.get(vusKey);
            bucket.latencies.push(item.latency);
            bucket.rpsValues.push(item.rps);
            bucket.errorRates.push(item.errorRate || 0);
            bucket.resources.push(item.resourceUtilization || { cpu: 0, memory: 0, io: 0, disk: 0 });
        }
        const vusLoadData = Array.from(vusLoadMap.entries()).map(([vus, bucket]) => {
            const sortedLat = bucket.latencies.sort((a, b) => a - b);
            const avgLatency = bucket.latencies.reduce((a, b) => a + b, 0) / bucket.latencies.length;
            const p95Index = Math.floor(sortedLat.length * 0.95);
            const p95Latency = sortedLat[p95Index] || sortedLat[sortedLat.length - 1] || 0;
            const avgRps = bucket.rpsValues.reduce((a, b) => a + b, 0) / bucket.rpsValues.length;
            const avgErrorRate = bucket.errorRates.reduce((a, b) => a + b, 0) / bucket.errorRates.length;
            const avgCpu = bucket.resources.reduce((a, b) => a + b.cpu, 0) / bucket.resources.length;
            const avgMemory = bucket.resources.reduce((a, b) => a + b.memory, 0) / bucket.resources.length;
            return {
                vus,
                avgLatency: parseFloat(avgLatency.toFixed(2)),
                p95Latency: parseFloat(p95Latency.toFixed(2)),
                minLatency: parseFloat((sortedLat[0] || 0).toFixed(2)),
                maxLatency: parseFloat((sortedLat[sortedLat.length - 1] || 0).toFixed(2)),
                tps: parseFloat(avgRps.toFixed(2)),
                errorRate: parseFloat(avgErrorRate.toFixed(2)),
                cpuUtilization: parseFloat(avgCpu.toFixed(2)),
                memoryUtilization: parseFloat(avgMemory.toFixed(2))
            };
        }).sort((a, b) => a.vus - b.vus);

        return {
            sessionId,
            session2Id,
            target: target || 'unknown',
            generatedAt: new Date().toISOString(),
            mode: mode || 'unknown',
            config: {
                algorithm: this.algorithmName,
                monitorInterval: this.config.monitorInterval,
                windowSize: this.config.windowSize,
                threshold: this.config.threshold,
                batchSize: this.config.batchSize,
                baselinePoints: this.config.baselinePoints
            },
            inflectionPoints: {
                optimal: inflectionPoints.optimal ? {
                    type: 'optimal',
                    vus: inflectionPoints.optimal.vus,
                    latency: inflectionPoints.optimal.latency,
                    rps: inflectionPoints.optimal.rps,
                    timestamp: inflectionPoints.optimal.timestamp
                } : null,
                max: inflectionPoints.max ? {
                    type: 'max',
                    vus: inflectionPoints.max.vus,
                    latency: inflectionPoints.max.latency,
                    rps: inflectionPoints.max.rps,
                    timestamp: inflectionPoints.max.timestamp
                } : null
            },
            performanceData,
            vusLoadData
        };
    }

    /**
     * 重置所有状态
     */
    reset() {
        this.startTime = null;
        this.detectedOptimal = false;
        this.detectedMax = false;
        this.optimalPoint = null;
        this.maxPoint = null;
        this.performanceHistory = [];
        this.dataPointCount = 0;
        this._resetAlgorithm();
        this.logger.info(`[${this.constructor.name}] 策略已重置`);
    }

    // ═══════════════════════════════════════════════
    //  子类必须实现的抽象方法
    // ═══════════════════════════════════════════════

    /**
     * 算法核心逻辑：每收到一个数据点时调用
     * @param {Object} point - 标准化数据点 {timestamp, vus, latency, rps, errorRate}
     * @param {number} elapsedMs - 已运行时间
     */
    _detect(point, elapsedMs) {
        throw new Error('子类必须实现 _detect 方法');
    }

    /**
     * 是否已触发拐点
     */
    _isTriggered() {
        throw new Error('子类必须实现 _isTriggered 方法');
    }

    /**
     * 获取拐点结果
     */
    _getResult() {
        throw new Error('子类必须实现 _getResult 方法');
    }

    /**
     * 重置算法内部状态（检测第二个拐点时调用）
     */
    _resetAlgorithm() {
        throw new Error('子类必须实现 _resetAlgorithm 方法');
    }
}

module.exports = BaseStrategy;
