const { EventEmitter } = require('events');

/**
 * BaseStrategy - 分析策略基类
 *
 * 架构设计（2026-05 重构后）：
 *   支持两种工作模式，自动识别：
 *   1. 新模式：子类覆盖 _createMaxDetector() 和 _createOptimalDetector()，
 *      返回纯突变点检测器实例。BaseStrategy 负责驱动检测器、进行 RPS 数学变换、
 *      结合资源负载/错误率等指标判断性能拐点、管理状态、生成报告。
 *   2. 旧模式（兼容）：子类继续实现 _detect / _isTriggered / _getResult / _resetAlgorithm，
 *      BaseStrategy 按原有模板方法模式调用。
 *
 * 拐点识别职责分离：
 *   - detectors/ 下的检测器：只接收一维数据流，识别突变点（change point）。
 *   - BaseStrategy：接收突变点，适当结合其他指标判断性能拐点（最优/最大），
 *     记录完整数据流，生成数据报告。
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

        // 测试目标（cpu/memory/io/disk）
        this.target = config.target || 'unknown';

        // 历史最大资源负载（用于日志记录）
        this.maxResourceLoad = 0;

        // 启动时间（用于计算 elapsedMs）
        this.startTime = null;

        // 数据点计数
        this.dataPointCount = 0;

        // 防止 complete 事件重复发射
        this._completeEmitted = false;

        // ═══════════════════════════════════════════════════════
        //  模式检测：子类是否实现了新架构的检测器工厂方法
        // ═══════════════════════════════════════════════════════
        this.maxDetector = this._createMaxDetector();
        this.optimalDetector = this._createOptimalDetector();
        this._useNewMode = this.maxDetector !== null && this.optimalDetector !== null;

        if (this._useNewMode) {
            this.logger.info(`[${this.constructor.name}] 启用新模式：纯检测器 + 策略拐点判断分离`);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  新架构默认工厂方法（返回 null 表示子类未启用新模式）
    // ═══════════════════════════════════════════════════════

    /**
     * 创建用于最大拐点的突变检测器（错误率序列）
     * @returns {BaseDetector|null}
     */
    _createMaxDetector() {
        return null;
    }

    /**
     * 创建用于最优拐点的突变检测器（RPS 变换后序列）
     * @returns {BaseDetector|null}
     */
    _createOptimalDetector() {
        return null;
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
        this.maxResourceLoad = 0;
        this._completeEmitted = false;

        // RPS 变换基线状态重置
        this._rpsBaselinePoints = null;
        this._rpsBaselineEstablished = false;
        this.rpsBaselineSlope = null;
        this.rpsBaselineIntercept = null;

        if (this._useNewMode) {
            if (this.maxDetector) this.maxDetector.reset();
            if (this.optimalDetector) this.optimalDetector.reset();
        } else {
            this._resetAlgorithm();
        }

        this.logger.info(`[${this.constructor.name}] 策略已启动，算法=${this.algorithmName}`);
    }

    /**
     * 接收一个标准化数据点
     * @param {Object} point - {timestamp, vus, latency, rps, errorRate}
     */
    onDataPoint(point) {
        if (!this.startTime) return;

        // 更新历史最大资源负载
        const currentLoad = this._getCurrentResourceLoad(point);
        if (currentLoad > this.maxResourceLoad) {
            this.maxResourceLoad = currentLoad;
        }

        // 保存性能历史（完整保留，不截断）
        this.performanceHistory.push(point);
        this.dataPointCount++;

        // 计算已运行时间
        const elapsedMs = point.timestamp - this.startTime;

        if (this._useNewMode) {
            this._onDataPointNewMode(point, elapsedMs);
        } else {
            // 旧模式：模板方法调用子类算法核心
            this._detect(point, elapsedMs);
            if (this._isTriggered()) {
                const result = this._getResult();
                this._handleInflection(result, point, elapsedMs);
            }
        }
    }

    /**
     * 新模式数据点处理：驱动检测器 + 拐点判断
     */
    _onDataPointNewMode(point, elapsedMs) {
        // ═══════════════════════════════════════════════════════
        //  1. 更新最大拐点检测器（错误率序列）
        // ═══════════════════════════════════════════════════════
        this.maxDetector.feed(point.errorRate || 0);

        // ═══════════════════════════════════════════════════════
        //  2. 更新最优拐点检测器（RPS 变换序列）
        //     转接器：将 "RPS 随 VUs 从增加到平缓" 变换为
        //     "偏差值先平缓后攀升"，再送入突变检测器。
        // ═══════════════════════════════════════════════════════
        const rpsDeviation = this._getRpsDeviationForDetection(point);
        if (rpsDeviation !== null) {
            this.optimalDetector.feed(rpsDeviation);
        }

        // ═══════════════════════════════════════════════════════
        //  3. 阶段一：检测最优拐点
        // ═══════════════════════════════════════════════════════
        if (!this.detectedOptimal) {
            const currentLoad = this._getCurrentResourceLoad(point);
            const minResourceLoad = this._getOptimalMinResourceLoad();

            // 快速路径：直接用 RPS 平缓检测（对低配置机器更友好，避免纯依赖
            // DoubleWindowDetector 对线性增长 deviation 不敏感导致的过晚识别）
            if (currentLoad >= minResourceLoad && this._isRpsPlateauing()) {
                this._handleOptimalCandidate(point, elapsedMs);
            } else if (this.optimalDetector.isChangePointDetected()) {
                this._handleOptimalCandidate(point, elapsedMs);
            }
        }

        // ═══════════════════════════════════════════════════════
        //  4. 阶段二：检测最大拐点（只有最优拐点已确认后才处理）
        // ═══════════════════════════════════════════════════════
        if (this.detectedOptimal && !this.detectedMax) {
            if (this.maxDetector.isChangePointDetected()) {
                this._handleMaxCandidate(point, elapsedMs);
            } else if (this._isHardOverload(point)) {
                // memory 测试兜底：无错误率突变时，用硬过载条件触发最大拐点
                this._forceMaxInflection(point, elapsedMs);
            }
        }

        // ═══════════════════════════════════════════════════════
        //  5. 两个拐点均检测到，通知完成（仅一次）
        // ═══════════════════════════════════════════════════════
        if (this.detectedOptimal && this.detectedMax && !this._completeEmitted) {
            this._completeEmitted = true;
            this.emit('complete', { optimal: this.optimalPoint, max: this.maxPoint });
        }
    }

    /**
     * 获取 RPS 偏差值（专用于突变检测）。
     * 与 _getRpsDeviation 的区别：基线未建立时返回 null，不污染检测器数据流。
     * 转接器核心：用早期 RPS/VU 建立线性基线，计算 deviation = max(0, 预期RPS - 实际RPS)。
     * 系统健康时 deviation≈0，饱和时 deviation 突然变大，形状同错误率突变。
     */
    _getRpsDeviationForDetection(point) {
        if (!this.rpsBaselineSlope) {
            if (!this._rpsBaselinePoints) this._rpsBaselinePoints = [];
            // 按 VU 去重：每个 VU 阶段只保留最新的 RPS，避免数据密度影响基线斜率
            const existingIdx = this._rpsBaselinePoints.findIndex(p => p.vus === point.vus);
            if (existingIdx >= 0) {
                this._rpsBaselinePoints[existingIdx].rps = point.rps || 0;
            } else {
                this._rpsBaselinePoints.push({ vus: point.vus, rps: point.rps || 0 });
            }
            if (this._rpsBaselinePoints.length < 5) return null;

            // 线性回归: RPS = slope * VU + intercept
            const n = this._rpsBaselinePoints.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            for (const p of this._rpsBaselinePoints) {
                sumX += p.vus;
                sumY += p.rps;
                sumXY += p.vus * p.rps;
                sumXX += p.vus * p.vus;
            }
            const denom = n * sumXX - sumX * sumX;
            if (Math.abs(denom) > 1e-10) {
                this.rpsBaselineSlope = (n * sumXY - sumX * sumY) / denom;
                this.rpsBaselineIntercept = (sumY - this.rpsBaselineSlope * sumX) / n;
            } else {
                this.rpsBaselineSlope = 0;
                this.rpsBaselineIntercept = sumY / n;
            }
            this._rpsBaselineEstablished = true;
        }

        const expectedRps = this.rpsBaselineSlope * point.vus + this.rpsBaselineIntercept;
        const actualRps = point.rps || 0;
        // 只取正值：RPS 低于预期才是饱和信号
        return Math.max(0, expectedRps - actualRps);
    }

    /**
     * 获取当前测试目标对应的最优拐点最小资源负载阈值
     * 不同资源类型的瓶颈特性不同，阈值应差异化：
     *   - cpu: 95%（CPU 利用率随并发快速上升，饱和点明确）
     *   - memory: 50%（内存利用率上升缓慢，RPS 瓶颈远早于内存满载）
     *   - io/disk: 85%（中间态）
     */
    _getOptimalMinResourceLoad() {
        // 优先使用用户按 target 配置的阈值
        // const byTarget = this.config.optimalMinResourceLoadByTarget;
        // if (byTarget && typeof byTarget[this.target] === 'number') {
        //     return byTarget[this.target];
        // }
        // // 其次使用全局统一配置
        // if (typeof this.config.optimalMinResourceLoad === 'number') {
        //     return this.config.optimalMinResourceLoad;
        // }
        // 默认按 target 类型差异化
        // memory 阈值从 50% 提高到 80%：小内存机器上内存占用率上升极快，
        // 50% 阈值在测试早期（VU 很低时）就被触发，导致最优拐点严重偏低。
        const defaults = { cpu: 95.0, memory: 60.0, io: 85.0, disk: 85.0 };
        return defaults[this.target] ?? 95.0;
    }

    /**
     * 处理最优拐点候选：突变检测器已触发，需结合环境指标确认
     */
    _handleOptimalCandidate(point, elapsedMs) {
        const minResourceLoad = this._getOptimalMinResourceLoad();
        const recentHistory = this.performanceHistory.slice(-5);
        const recentLoads = recentHistory.map(p => this._getCurrentResourceLoad(p));
        const highLoadCount = recentLoads.filter(l => l >= minResourceLoad).length;
        const currentLoad = this._getCurrentResourceLoad(point);

        if (highLoadCount < 3) {
            this.logger.info(`[${this.constructor.name}] 最优拐点突变检测触发但资源负载未达阈值(最近${recentLoads.length}点中${highLoadCount}个≥${minResourceLoad}%，当前${this.target}=${currentLoad.toFixed(1)}%)，暂不确认，等待资源负载持续高位`);
            // 不 reset 检测器，保持已触发的突变信号。
            // 资源负载采样（尤其 CPU 差分法）存在波动，reset 会导致好不容易积累的突变条件丢失。
            // 只要检测器仍报告触发，后续数据点会继续进入此判断，直到高负载点足够后确认。
            return;
        }

        this.detectedOptimal = true;
        this.optimalPoint = {
            type: 'optimal',
            timestamp: new Date().toISOString(),
            vus: point.vus,
            latency: point.latency,
            rps: parseFloat((point.rps || 0).toFixed(2)),
            algorithm: this.algorithmName,
            elapsedMs
        };
        this.logger.info(`[${this.constructor.name}] 最优拐点检测! VUs=${this.optimalPoint.vus}, 延迟=${this.optimalPoint.latency}ms, ${this.target}负载=${currentLoad.toFixed(1)}%`);
        this.emit('optimal', this.optimalPoint);

        // 确认最优拐点后，重置最大拐点检测器，使其从当前点开始重新检测，
        // 避免检测器在"等待最优拐点确认"期间提前触发导致的最大拐点超前。
        if (this.maxDetector) {
            this.maxDetector.reset();
            this.logger.info(`[${this.constructor.name}] 最优拐点已确认，重置最大拐点检测器，开始监测最大拐点`);
        }
    }

    /**
     * 处理最大拐点候选：突变检测器已触发，需结合错误率趋势确认
     */
    _handleMaxCandidate(point, elapsedMs) {
        if (!this._isErrorRateClimbing()) {
            this.logger.info(`[${this.constructor.name}] 最大拐点突变检测触发但错误率未攀升，忽略此次触发，继续监测最大拐点`);
            this.maxDetector.reset();
            return;
        }

        this.detectedMax = true;
        this.maxPoint = {
            type: 'max',
            timestamp: new Date().toISOString(),
            vus: point.vus,
            latency: point.latency,
            rps: parseFloat((point.rps || 0).toFixed(2)),
            algorithm: this.algorithmName,
            elapsedMs
        };
        this.logger.info(`[${this.constructor.name}] 最大拐点检测! VUs=${this.maxPoint.vus}, 延迟=${this.maxPoint.latency}ms, 错误率攀升确认`);
        this.emit('max', this.maxPoint);
    }

    /**
     * 判断是否为"硬过载"状态（无错误率突变时的兜底条件）
     * 主要针对 memory 测试：hold 模式下错误率始终为 0，但内存竞争导致延迟飙升
     */
    _isHardOverload(point) {
        if (this.target === 'memory') {
            const memoryLoad = point.resourceUtilization?.memory || 0;
            const latency = point.latency || 0;
            // 硬过载兜底：memory hold 模式下错误率始终为 0，需要资源指标辅助判定最大拐点。
            // 原阈值 400ms 过低，在 Windows 端高负载但未饱和时极易误触（如延迟 700~900ms）。
            // 提高到 1200ms 并支持配置覆盖，避免过早强制结束测试。
            const latencyThreshold = this.config.memoryHardOverloadLatencyMs || 1200;
            if (memoryLoad > 90 && latency > latencyThreshold) {
                this.logger.info(`[${this.constructor.name}] memory 硬过载判定: 内存=${memoryLoad.toFixed(1)}%, 延迟=${latency.toFixed(1)}ms (阈值=${latencyThreshold}ms)`);
                return true;
            }
        }
        return false;
    }

    /**
     * 强制设置最大拐点（硬过载兜底）
     */
    _forceMaxInflection(point, elapsedMs) {
        this.detectedMax = true;
        this.maxPoint = {
            type: 'max',
            timestamp: new Date().toISOString(),
            vus: point.vus,
            latency: point.latency,
            rps: parseFloat((point.rps || 0).toFixed(2)),
            algorithm: this.algorithmName,
            elapsedMs,
            note: '硬过载兜底'
        };
        this.logger.info(`[${this.constructor.name}] 最大拐点硬过载检测! VUs=${this.maxPoint.vus}, 延迟=${this.maxPoint.latency}ms, ${this.target}负载=${this._getCurrentResourceLoad(point).toFixed(1)}%`);
        this.emit('max', this.maxPoint);

        if (!this._completeEmitted) {
            this._completeEmitted = true;
            this.emit('complete', { optimal: this.optimalPoint, max: this.maxPoint });
        }
    }

    /**
     * 根据测试目标获取当前资源负载值
     * @param {Object} point - 数据点
     * @returns {number} 资源负载百分比
     */
    _getCurrentResourceLoad(point) {
        const res = point.resourceUtilization || {};
        switch (this.target) {
            case 'cpu': return res.cpu || 0;
            case 'memory': return res.memory || 0;
            case 'io': return res.io || 0;
            case 'disk': return res.disk || 0;
            default:
                // 未指定目标时取最大值
                return Math.max(res.cpu || 0, res.memory || 0, res.io || 0, res.disk || 0);
        }
    }

    /**
     * 通用拐点处理（旧模式）：先检测最优拐点，重置后再检测最大拐点
     *
     * 改进：加入环境判断
     *   - 最优拐点：要求当前资源负载达到绝对阈值（默认≥85%）或已达历史最大负载的90%以上，
     *               防止低负载时误判，同时适配低资源机器
     *   - 最大拐点：要求错误率正在攀升，确保最大拐点在错误率上升的左右
     */
    _handleInflection(result, point, elapsedMs) {
        if (!this.detectedOptimal) {
            // ═══════════════════════════════════════════════════════
            //  最优拐点环境判断：最近 5 个数据点中至少 3 个达到绝对阈值（默认≥95%）
            //  避免瞬时峰值导致的误触发，确保系统处于持续高负载状态。
            //  注意：不使用相对历史最大负载，因为测试早期 maxResourceLoad
            //  很低，relativeToMax 会虚高导致早期误触发。
            // ═══════════════════════════════════════════════════════
            const minResourceLoad = this._getOptimalMinResourceLoad();
            const recentHistory = this.performanceHistory.slice(-5);
            const recentLoads = recentHistory.map(p => this._getCurrentResourceLoad(p));
            const highLoadCount = recentLoads.filter(l => l >= minResourceLoad).length;
            const currentLoad = this._getCurrentResourceLoad(point);

            if (highLoadCount < 3) {
                this.logger.info(`[${this.constructor.name}] 算法触发但资源负载未达阈值(最近${recentLoads.length}点中${highLoadCount}个≥${minResourceLoad}%，当前${this.target}=${currentLoad.toFixed(1)}%)，忽略此次触发，继续监测最优拐点`);
                this._resetAlgorithm();
                return;
            }

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
            this.logger.info(`[${this.constructor.name}] 最优拐点检测! VUs=${this.optimalPoint.vus}, 延迟=${this.optimalPoint.latency}ms, ${this.target}负载=${currentLoad.toFixed(1)}%`);
            this.emit('optimal', this.optimalPoint);

            // 重置算法继续检测最大拐点
            this._resetAlgorithm();
        } else if (!this.detectedMax) {
            // ═══════════════════════════════════════════════════════
            //  最大拐点环境判断：错误率必须正在攀升
            // ═══════════════════════════════════════════════════════
            if (!this._isErrorRateClimbing()) {
                this.logger.info(`[${this.constructor.name}] 算法触发但错误率未攀升，忽略此次触发，继续监测最大拐点`);
                this._resetAlgorithm();
                return;
            }

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
            this.logger.info(`[${this.constructor.name}] 最大拐点检测! VUs=${this.maxPoint.vus}, 延迟=${this.maxPoint.latency}ms, 错误率攀升确认`);
            this.emit('max', this.maxPoint);
            this.emit('complete', { optimal: this.optimalPoint, max: this.maxPoint });
        }
    }

    /**
     * 判断错误率是否正在攀升
     * 策略：
     *   1. 最新错误率超过阈值（默认 1.0%）
     *   2. 或最近 N 个数据点中错误率呈明显上升趋势（≥60% 的连续比较都在上升）
     */
    _isErrorRateClimbing() {
        const trendWindow = this.config.maxErrorRateTrendWindow || 5;
        const threshold = this.config.maxErrorRateThreshold || 1.0;
        const history = this.performanceHistory;

        if (history.length < trendWindow) {
            this.logger.info(`[${this.constructor.name}] 错误率趋势数据不足(${history.length}/${trendWindow})，暂不判定攀升`);
            return false;
        }

        const recent = history.slice(-trendWindow).map(p => p.errorRate || 0);
        const lastErrorRate = recent[recent.length - 1];

        // 条件1：最新错误率超过阈值
        if (lastErrorRate > threshold) {
            this.logger.info(`[${this.constructor.name}] 错误率攀升确认：最新错误率 ${lastErrorRate.toFixed(2)}% > 阈值 ${threshold}%`);
            return true;
        }

        // 条件2：错误率呈明显上升趋势
        let increasingCount = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] > recent[i - 1]) increasingCount++;
        }
        const totalComparisons = recent.length - 1;
        const isTrendUp = increasingCount >= Math.ceil(totalComparisons * 0.6);

        if (isTrendUp) {
            this.logger.info(`[${this.constructor.name}] 错误率攀升确认：最近 ${trendWindow} 点中 ${increasingCount}/${totalComparisons} 次连续上升`);
        }
        return isTrendUp;
    }

    /**
     * 后处理推断拐点
     * 当实时流检测未触发时，基于完整历史数据按资源负载比例 + 延迟倍数推断拐点。
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

        // 2. 按 VU 分组聚合（同时收集资源利用率）
        const groups = new Map();
        for (const p of rampUp) {
            const vus = p.vus || 0;
            if (!groups.has(vus)) {
                groups.set(vus, { latencies: [], rps: [], errors: [], resources: [] });
            }
            const g = groups.get(vus);
            g.latencies.push(p.latency);
            g.rps.push(p.rps || 0);
            g.errors.push(p.errorRate || 0);
            g.resources.push(p.resourceUtilization || { cpu: 0, memory: 0, io: 0, disk: 0 });
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

        // 计算每个 VU 阶段的平均资源负载
        const avgResourceLoad = vuList.map(v => {
            const g = groups.get(v);
            const loads = g.resources.map(r => {
                switch (this.target) {
                    case 'cpu': return r.cpu || 0;
                    case 'memory': return r.memory || 0;
                    case 'io': return r.io || 0;
                    case 'disk': return r.disk || 0;
                    default: return Math.max(r.cpu || 0, r.memory || 0, r.io || 0, r.disk || 0);
                }
            });
            return loads.reduce((a, b) => a + b, 0) / loads.length;
        });

        const maxResourceLoad = Math.max(...avgResourceLoad);

        // 3. 计算全局 baseline 延迟（前 20% 数据点的平均）
        const baselineEnd = Math.max(1, Math.floor(vuList.length * 0.2));
        const baselineLatency = avgLatency.slice(0, baselineEnd).reduce((a, b) => a + b, 0) / baselineEnd;

        // 后处理配置参数（可配置）
        const pp = this.config.postProcess || {};
        const optimalMultiplier = pp.optimalMultiplier || 4.0;
        const maxBaselineRatio = pp.maxBaselineRatio || 10.0;
        const maxOptimalRatio = pp.maxOptimalRatio || 2.5;
        // 改进：最优拐点后处理只使用绝对资源负载阈值（默认≥95%）
        const optimalMinResourceLoad = pp.optimalMinResourceLoad ?? this._getOptimalMinResourceLoad();
        // 改进：最大拐点后处理也要求资源负载处于高位（默认≥80%）
        const maxMinResourceLoad = pp.maxMinResourceLoad ?? 80.0;

        // 4. 推断最优拐点：资源负载达到绝对阈值且延迟超过阈值
        let optimalVu = null;
        let optimalLatency = null;

        for (let i = 0; i < vuList.length; i++) {
            if (avgResourceLoad[i] >= optimalMinResourceLoad && avgLatency[i] > baselineLatency * optimalMultiplier) {
                optimalVu = vuList[i];
                optimalLatency = avgLatency[i];
                break;
            }
        }

        // 兜底：取资源负载≥绝对阈值范围内延迟最高的点
        if (optimalVu === null) {
            let bestIdx = -1;
            let bestLatency = 0;
            for (let i = 0; i < vuList.length; i++) {
                if (avgResourceLoad[i] >= optimalMinResourceLoad && avgLatency[i] > bestLatency) {
                    bestLatency = avgLatency[i];
                    bestIdx = i;
                }
            }
            if (bestIdx >= 0) {
                optimalVu = vuList[bestIdx];
                optimalLatency = avgLatency[bestIdx];
            }
        }

        // 5. 推断最大拐点：资源负载≥80% 且错误率攀升或延迟极高
        let maxVu2 = null;
        let maxLatency = null;

        // 改进：优先级 1 —— 错误率首次超过阈值（默认 1%）且资源负载在高区
        const errorRateThreshold = pp.maxErrorRateThreshold || 1.0;
        for (let i = 0; i < vuList.length; i++) {
            if (avgResourceLoad[i] >= maxMinResourceLoad && avgErrors[i] > errorRateThreshold) {
                maxVu2 = vuList[i];
                maxLatency = avgLatency[i];
                break;
            }
        }

        // 改进：优先级 2 —— 错误率呈明显上升趋势（即使未超过阈值）
        if (maxVu2 === null) {
            for (let i = 2; i < vuList.length; i++) {
                if (avgResourceLoad[i] >= maxMinResourceLoad) {
                    if (avgErrors[i] > avgErrors[i - 1] && avgErrors[i - 1] > avgErrors[i - 2] && avgErrors[i] > 0) {
                        maxVu2 = vuList[i];
                        maxLatency = avgLatency[i];
                        break;
                    }
                }
            }
        }

        // 优先级 3：延迟超过 optimal × ratio 或 baseline × ratio 或绝对阈值
        if (maxVu2 === null && optimalLatency !== null) {
            // memory 测试兜底绝对阈值：饱和后并发竞争会导致延迟显著上升
            const absoluteLatencyThreshold = this.target === 'memory' ? 400 : 0;
            for (let i = 0; i < vuList.length; i++) {
                if (avgResourceLoad[i] >= maxMinResourceLoad) {
                    if (avgLatency[i] > optimalLatency * maxOptimalRatio ||
                        avgLatency[i] > baselineLatency * maxBaselineRatio ||
                        (absoluteLatencyThreshold > 0 && avgLatency[i] > absoluteLatencyThreshold)) {
                        maxVu2 = vuList[i];
                        maxLatency = avgLatency[i];
                        break;
                    }
                }
            }
        }

        // 兜底：取资源负载≥80% 范围内延迟最高的点
        if (maxVu2 === null) {
            let bestIdx = -1;
            let bestLatency = 0;
            for (let i = 0; i < vuList.length; i++) {
                if (avgResourceLoad[i] >= maxMinResourceLoad && avgLatency[i] > bestLatency) {
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
        // 如果数据足够，尝试后处理推断缺失的拐点
        // 即使已检测到部分拐点，也可能需要补全另一个（如 memory 测试中最优拐点
        // 被过早触发但最大拐点始终未检测到的情况）
        if (this.performanceHistory.length >= 20) {
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
        this.maxResourceLoad = 0;
        this._completeEmitted = false;

        // RPS 变换基线状态重置
        this._rpsBaselinePoints = null;
        this._rpsBaselineEstablished = false;
        this.rpsBaselineSlope = null;
        this.rpsBaselineIntercept = null;

        if (this._useNewMode) {
            if (this.maxDetector) this.maxDetector.reset();
            if (this.optimalDetector) this.optimalDetector.reset();
        } else {
            this._resetAlgorithm();
        }

        this.logger.info(`[${this.constructor.name}] 策略已重置`);
    }

    /**
     * 检测 RPS 是否从增长变为平缓（最优拐点核心）
     * 策略：比较前中后三个窗口的 RPS 均值，近期增长明显放缓即为平缓。
     */
    _isRpsPlateauing() {
        // 从 performanceHistory 获取 RPS 序列（兼容新模式与旧模式）
        const rpsHistory = this.performanceHistory.map(p => p.rps || 0);
        if (rpsHistory.length < 12) return false;

        const n = 3;
        const w1 = rpsHistory.slice(-n * 3, -n * 2);
        const w2 = rpsHistory.slice(-n * 2, -n);
        const w3 = rpsHistory.slice(-n);

        const avg1 = w1.reduce((a, b) => a + b, 0) / n;
        const avg2 = w2.reduce((a, b) => a + b, 0) / n;
        const avg3 = w3.reduce((a, b) => a + b, 0) / n;

        // 早期平均 RPS（确认之前确实在快速增长）
        const early = rpsHistory.slice(0, n);
        const earlyAvg = early.reduce((a, b) => a + b, 0) / n;
        const wasGrowing = avg1 > earlyAvg * 2;

        // 增长连续放缓：近期比中期低/持平，中期比前期低/持平
        const slowing = avg3 <= avg2 * 1.05 && avg2 <= avg1 * 1.15;

        return wasGrowing && slowing;
    }

    /**
     * 计算 RPS 偏差值：将"RPS先增长后平缓"变换为"先平缓后突变"
     * 用前 N 个点的 RPS/VU 建立线性基线，计算预期 RPS 与实际 RPS 的偏差。
     * 系统健康时 deviation≈0，饱和时 deviation 突然变大，形状同错误率突变。
     */
    _getRpsDeviation(point) {
        if (!this.rpsBaselineSlope) {
            // 首次调用，收集基线数据
            if (!this._rpsBaselinePoints) this._rpsBaselinePoints = [];
            // 按 VU 去重：每个 VU 阶段只保留最新的 RPS，避免数据密度影响基线斜率
            const existingIdx = this._rpsBaselinePoints.findIndex(p => p.vus === point.vus);
            if (existingIdx >= 0) {
                this._rpsBaselinePoints[existingIdx].rps = point.rps || 0;
            } else {
                this._rpsBaselinePoints.push({ vus: point.vus, rps: point.rps || 0 });
            }
            if (this._rpsBaselinePoints.length < 5) return 0;

            // 线性回归: RPS = slope * VU + intercept
            const n = this._rpsBaselinePoints.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            for (const p of this._rpsBaselinePoints) {
                sumX += p.vus;
                sumY += p.rps;
                sumXY += p.vus * p.rps;
                sumXX += p.vus * p.vus;
            }
            const denom = n * sumXX - sumX * sumX;
            if (Math.abs(denom) > 1e-10) {
                this.rpsBaselineSlope = (n * sumXY - sumX * sumY) / denom;
                this.rpsBaselineIntercept = (sumY - this.rpsBaselineSlope * sumX) / n;
            } else {
                this.rpsBaselineSlope = 0;
                this.rpsBaselineIntercept = sumY / n;
            }
        }

        const expectedRps = this.rpsBaselineSlope * point.vus + this.rpsBaselineIntercept;
        const actualRps = point.rps || 0;
        // 只取正值：RPS 低于预期才是饱和信号
        return Math.max(0, expectedRps - actualRps);
    }

    // ═══════════════════════════════════════════════
    //  子类必须实现的抽象方法（旧模式兼容）
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
