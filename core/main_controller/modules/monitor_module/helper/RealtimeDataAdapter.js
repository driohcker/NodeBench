/**
 * LatencySmoother - 延迟数据平缓器
 * 使用滑动窗口中位数滤波 + 异常值截断，消除数据抖动和极端异常值对拐点识别的影响。
 */
class LatencySmoother {
    constructor(windowSize = 15, outlierMultiplier = 5.0) {
        this.windowSize = windowSize;
        this.outlierMultiplier = outlierMultiplier;
        this.window = [];
    }

    reset() {
        this.window = [];
    }

    /**
     * 对单个 latency 值进行平滑处理
     * @param {number} value - 原始 latency 值（batch 平均）
     * @returns {number} 平滑后的 latency 值
     */
    smooth(value) {
        this.window.push(value);
        if (this.window.length > this.windowSize) {
            this.window.shift();
        }

        // 计算当前窗口中位数（对异常值天然免疫）
        const sorted = [...this.window].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        let median;
        if (sorted.length % 2 === 0) {
            median = (sorted[mid - 1] + sorted[mid]) / 2;
        } else {
            median = sorted[mid];
        }

        // 异常值截断：若当前值远超中位数，视为异常值，用中位数替代
        if (this.window.length >= 3 && value > median * this.outlierMultiplier) {
            return parseFloat(median.toFixed(2));
        }

        // 返回滑动窗口中位数（比原始 batch 均值更稳定，同时能跟随真实趋势）
        return parseFloat(median.toFixed(2));
    }
}

/**
 * RealtimeDataAdapter - 实时数据流适配器
 * 负责接收 k6 原始指标流，解析并计算标准化数据点，然后推送给分析策略。
 * 不依赖任何具体策略实现。
 * 
 * 设计原则：完整保留所有数据点，不截断历史，确保图表展示全貌。
 * rpsHistory/errorHistory 仅保留最近 10 秒的数据用于 RPS/错误率计算。
 */
class RealtimeDataAdapter {
    constructor(config, logger, strategy, resourceCollector) {
        this.config = config;
        this.logger = logger;
        this.strategy = strategy;
        this.resourceCollector = resourceCollector;

        // batchSize 增大到 30，每个 batch 包含更多请求，更能代表当前 VU 阶段的稳态性能
        this.batchSize = config.batchSize || 30;

        this.batch = [];
        this.batchVus = 0; // 当前 batch 对应的 VU 值
        this.currentVus = 0;
        this.rpsHistory = [];
        this.errorHistory = [];

        // 基于 batch 间隔的 RPS 计算状态
        this.lastBatchTime = null;
        this.batchReqCount = 0;
        this.batchErrorCount = 0;

        // 延迟数据平缓器（窗口增大到15，异常值倍数增大到5）
        this.latencySmoother = new LatencySmoother(
            config.latencySmoothWindowSize || 15,
            config.latencyOutlierMultiplier || 5.0
        );
    }

    /**
     * 启动适配器（同时启动绑定的策略）
     */
    start() {
        this.batch = [];
        this.batchVus = 0;
        this.currentVus = 0;
        this.rpsHistory = [];
        this.errorHistory = [];
        this.lastBatchTime = null;
        this.batchReqCount = 0;
        this.batchErrorCount = 0;
        this.latencySmoother.reset();
        if (this.strategy) {
            this.strategy.init();
        }
        this.logger.info('[RealtimeDataAdapter] 实时数据流适配器已启动');
    }

    /**
     * 停止适配器
     */
    stop() {
        this.logger.info('[RealtimeDataAdapter] 实时数据流适配器已停止');
    }

    /**
     * 接收原始指标数据（来自 k6 --out json）
     * @param {string|Object} data - 一行 k6 JSON 输出
     */
    feed(data) {
        if (!this.strategy) return;

        try {
            let point = typeof data === 'string' ? JSON.parse(data) : data;

            if (point.type !== 'Point') return;

            const metric = point.metric;
            const value = point.data?.value;
            // 优先使用k6原始时间戳，更准确；fallback到接收时间
            const rawTime = point.data?.time;
            const timestamp = rawTime ? new Date(rawTime).getTime() : Date.now();

            if (metric === 'vus') {
                this.currentVus = value;
            } else if (metric === 'http_reqs') {
                this.rpsHistory.push({ t: timestamp, v: value });
                this.batchReqCount += (value || 0);
            } else if (metric === 'http_req_failed') {
                this.errorHistory.push({ t: timestamp, v: value || 0 });
                this.batchErrorCount += (value || 0);
            } else if (metric === 'http_req_duration') {
                // VU 阶段变化检测：若当前 batch 的 VU 与当前 VU 不一致，重置 batch
                // 避免 stage 切换时混合不同 VU 阶段的数据，导致 batch 均值失真
                if (this.batch.length > 0 && this.batchVus !== this.currentVus) {
                    this.logger.info(`[RealtimeDataAdapter] VU 阶段变化: ${this.batchVus} → ${this.currentVus}，重置当前 batch`);
                    this.batch = [];
                }
                this.batchVus = this.currentVus;
                this.batch.push(value);
                if (this.batch.length >= this.batchSize) {
                    this._processBatch();
                }
            }
        } catch (e) {
            // 忽略解析错误
        }
    }

    /**
     * 处理一个 batch：计算标准化数据点并推送给策略
     */
    _processBatch() {
        const rawAvgLatency = this.batch.reduce((a, b) => a + b, 0) / this.batch.length;
        const batchVu = this.batchVus;
        this.batch = [];

        const timestamp = Date.now();

        // 清理超过 10 秒的旧数据（仅保留计算窗口所需的数据）
        const cleanupCutoff = timestamp - 10000;
        this.rpsHistory = this.rpsHistory.filter(r => r.t > cleanupCutoff);
        this.errorHistory = this.errorHistory.filter(r => r.t > cleanupCutoff);

        // 计算RPS和错误率（使用滑动窗口，避免batch间隔不均导致的剧烈波动）
        const windowMs = 3000; // 3秒滑动窗口
        const windowCutoff = timestamp - windowMs;
        const recentReqs = this.rpsHistory.filter(r => r.t > windowCutoff);
        const recentErrors = this.errorHistory.filter(r => r.t > windowCutoff);
        const reqCount = recentReqs.reduce((sum, r) => sum + (r.v || 0), 0);
        const errCount = recentErrors.reduce((sum, r) => sum + (r.v || 0), 0);

        // 使用窗口实际时长计算平均RPS（避免边界抖动）
        let rps = 0;
        let errorRate = 0;
        if (recentReqs.length > 0) {
            const actualWindowMs = Math.max(windowMs, timestamp - recentReqs[0].t);
            const actualWindowSec = actualWindowMs / 1000;
            if (actualWindowSec > 0) {
                rps = reqCount / actualWindowSec;
            }
        }
        if (reqCount > 0) {
            errorRate = parseFloat(((errCount / reqCount) * 100).toFixed(2));
        }

        // 重置 batch 计数器（保留兼容性，但不再用于RPS主计算）
        this.lastBatchTime = timestamp;
        this.batchReqCount = 0;
        this.batchErrorCount = 0;

        // 采集系统资源利用率
        const resourceUtilization = this.resourceCollector
            ? this.resourceCollector.collect()
            : { cpu: 0, memory: 0, io: 0, disk: 0 };

        // 对 latency 进行平滑处理，消除极端抖动和异常值
        const smoothedLatency = this.latencySmoother.smooth(rawAvgLatency);
        if (Math.abs(smoothedLatency - rawAvgLatency) > 0.01) {
            this.logger.info(`[RealtimeDataAdapter] latency 平滑: ${rawAvgLatency.toFixed(2)}ms → ${smoothedLatency.toFixed(2)}ms (VU=${batchVu})`);
        }

        const dataPoint = {
            timestamp,
            vus: batchVu,
            latency: smoothedLatency,
            rps: parseFloat(rps.toFixed(2)),
            errorRate,
            resourceUtilization
        };

        this.strategy.onDataPoint(dataPoint);
    }
}

module.exports = RealtimeDataAdapter;
