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

        this.batchSize = config.batchSize || 5;

        this.batch = [];
        this.currentVus = 0;
        this.rpsHistory = [];
        this.errorHistory = [];

        // 基于 batch 间隔的 RPS 计算状态
        this.lastBatchTime = null;
        this.batchReqCount = 0;
        this.batchErrorCount = 0;
    }

    /**
     * 启动适配器（同时启动绑定的策略）
     */
    start() {
        this.batch = [];
        this.currentVus = 0;
        this.rpsHistory = [];
        this.errorHistory = [];
        this.lastBatchTime = null;
        this.batchReqCount = 0;
        this.batchErrorCount = 0;
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
        const avgLatency = this.batch.reduce((a, b) => a + b, 0) / this.batch.length;
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

        const dataPoint = {
            timestamp,
            vus: this.currentVus,
            latency: parseFloat(avgLatency.toFixed(2)),
            rps: parseFloat(rps.toFixed(2)),
            errorRate,
            resourceUtilization
        };

        this.strategy.onDataPoint(dataPoint);
    }
}

module.exports = RealtimeDataAdapter;
