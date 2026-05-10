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
     * 后处理推断拐点
     * 当实时流检测未触发时，基于完整历史数据按 VU 比例 + 延迟倍数推断拐点。
     */
    _postProcessInflection() {
        const history = this.performanceHistory;
        if (history.length < 20) return;

        // 1. 过滤 ramp-down 数据：找到最大 VU 的索引，只保留之前的数据
        let maxVuIdx = 0;
        for (let i = 1; i < history.length; i++) {
            if (history[i].vus >= history[maxVuIdx].vus) {
                maxVuIdx = i;
            }
        }
        const rampUp = history.slice(0, maxVuIdx + 1);
        if (rampUp.length < 10) return;

        // 2. 按 VU 分组聚合
        const groups = new Map();
        for (const p of rampUp) {
            const vus = p.vus || 0;
            if (!groups.has(vus)) {
                groups.set(vus, { latencies: [], rps: [], errors: [] });
            }
            const g = groups.get(vus);
            g.latencies.push(p.latency);
            g.rps.push(p.rps || 0);
            g.errors.push(p.errorRate || 0);
        }

        const vuList = Array.from(groups.keys()).sort((a, b) => a - b);
        const maxVu = vuList[vuList.length - 1];

        const avgLatency = vuList.map(v => {
            const g = groups.get(v);
            return g.latencies.reduce((a, b) => a + b, 0) / g.latencies.length;
        });

        const avgErrors = vuList.map(v => {
            const g = groups.get(v);
            return g.errors.reduce((a, b) => a + b, 0) / g.errors.length;
        });

        // 3. 计算全局 baseline 延迟（前 20% 数据点的平均）
        const baselineEnd = Math.max(1, Math.floor(vuList.length * 0.2));
        const baselineLatency = avgLatency.slice(0, baselineEnd).reduce((a, b) => a + b, 0) / baselineEnd;

        // 后处理配置参数（可配置）
        const pp = this.config.postProcess || {};
        const optimalMultiplier = pp.optimalMultiplier || 4.0;
        const maxBaselineRatio = pp.maxBaselineRatio || 10.0;
        const maxOptimalRatio = pp.maxOptimalRatio || 2.5;
        const optimalMinRatio = pp.optimalMinRatio || 0.15;
        const optimalMaxRatio = pp.optimalMaxRatio || 0.35;
        const maxMinRatio = pp.maxMinRatio || 0.55;
        const maxMaxRatio = pp.maxMaxRatio || 0.80;

        // 4. 推断最优拐点
        const optimalMinVu = maxVu * optimalMinRatio;
        const optimalMaxVu = maxVu * optimalMaxRatio;
        let optimalVu = null;
        let optimalLatency = null;

        for (let i = 0; i < vuList.length; i++) {
            if (vuList[i] >= optimalMinVu && vuList[i] <= optimalMaxVu && avgLatency[i] > baselineLatency * optimalMultiplier) {
                optimalVu = vuList[i];
                optimalLatency = avgLatency[i];
                break;
            }
        }

        // 兜底：取 optimal 范围内延迟最高的点
        if (optimalVu === null) {
            let bestIdx = -1;
            let bestLatency = 0;
            for (let i = 0; i < vuList.length; i++) {
                if (vuList[i] >= optimalMinVu && vuList[i] <= optimalMaxVu && avgLatency[i] > bestLatency) {
                    bestLatency = avgLatency[i];
                    bestIdx = i;
                }
            }
            if (bestIdx >= 0) {
                optimalVu = vuList[bestIdx];
                optimalLatency = avgLatency[bestIdx];
            }
        }

        // 5. 推断最大拐点
        const maxMinVu = maxVu * maxMinRatio;
        const maxMaxVu = maxVu * maxMaxRatio;
        let maxVu2 = null;
        let maxLatency = null;

        // 优先级 1：错误率首次超过 1%
        for (let i = 0; i < vuList.length; i++) {
            if (vuList[i] >= maxMinVu && vuList[i] <= maxMaxVu && avgErrors[i] > 1.0) {
                maxVu2 = vuList[i];
                maxLatency = avgLatency[i];
                break;
            }
        }

        // 优先级 2：延迟超过 optimal × ratio 或 baseline × ratio
        if (maxVu2 === null && optimalLatency !== null) {
            for (let i = 0; i < vuList.length; i++) {
                if (vuList[i] >= maxMinVu && vuList[i] <= maxMaxVu) {
                    if (avgLatency[i] > optimalLatency * maxOptimalRatio || avgLatency[i] > baselineLatency * maxBaselineRatio) {
                        maxVu2 = vuList[i];
                        maxLatency = avgLatency[i];
                        break;
                    }
                }
            }
        }

        // 兜底：取 max 范围内延迟最高的点
        if (maxVu2 === null) {
            let bestIdx = -1;
            let bestLatency = 0;
            for (let i = 0; i < vuList.length; i++) {
                if (vuList[i] >= maxMinVu && vuList[i] <= maxMaxVu && avgLatency[i] > bestLatency) {
                    bestLatency = avgLatency[i];
                    bestIdx = i;
                }
            }
            if (bestIdx >= 0) {
                maxVu2 = vuList[bestIdx];
                maxLatency = avgLatency[bestIdx];
            }
        }

        // 6. 设置拐点并触发事件
        if (optimalVu !== null && !this.detectedOptimal) {
            this.detectedOptimal = true;
            this.optimalPoint = {
                type: 'optimal',
                timestamp: new Date().toISOString(),
                vus: optimalVu,
                latency: parseFloat(optimalLatency.toFixed(2)),
                rps: 0,
                ratio: parseFloat((optimalLatency / baselineLatency).toFixed(2)),
                algorithm: this.algorithmName,
                elapsedMs: Date.now() - (this.startTime || Date.now()),
                note: '后处理推断'
            };
            this.logger.info(`[${this.constructor.name}] 后处理推断最优拐点: VUs=${optimalVu}, 延迟=${optimalLatency.toFixed(2)}ms, 基线=${baselineLatency.toFixed(2)}ms`);
            this.emit('optimal', this.optimalPoint);
        }

        if (maxVu2 !== null && !this.detectedMax) {
            this.detectedMax = true;
            this.maxPoint = {
                type: 'max',
                timestamp: new Date().toISOString(),
                vus: maxVu2,
                latency: parseFloat(maxLatency.toFixed(2)),
                rps: 0,
                ratio: parseFloat((maxLatency / baselineLatency).toFixed(2)),
                algorithm: this.algorithmName,
                elapsedMs: Date.now() - (this.startTime || Date.now()),
                note: '后处理推断'
            };
            this.logger.info(`[${this.constructor.name}] 后处理推断最大拐点: VUs=${maxVu2}, 延迟=${maxLatency.toFixed(2)}ms`);
            this.emit('max', this.maxPoint);
            this.emit('complete', { optimal: this.optimalPoint, max: this.maxPoint });
        }
    }

    /**
     * 获取已检测到的拐点
     */
    getInflectionPoints() {
        // 如果尚未检测到任何拐点，尝试后处理推断
        if (!this.detectedOptimal && !this.detectedMax && this.performanceHistory.length >= 20) {
            this._postProcessInflection();
        }
        return {
            optimal: this.optimalPoint,
            max: this.maxPoint
        };
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
