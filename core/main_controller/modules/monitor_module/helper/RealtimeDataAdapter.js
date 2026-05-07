/**
 * RealtimeDataAdapter - 实时数据流适配器
 * 负责接收 k6 原始指标流，解析并计算标准化数据点，然后推送给分析策略。
 * 不依赖任何具体策略实现。
 */
class RealtimeDataAdapter {
    constructor(config, logger, strategy, resourceCollector) {
        this.config = config;
        this.logger = logger;
        this.strategy = strategy;
        this.resourceCollector = resourceCollector;

        this.batchSize = config.batchSize || 5;
        this.maxHistoryPoints = config.maxHistoryPoints || 300;

        this.batch = [];
        this.vusHistory = [];
        this.rpsHistory = [];
        this.errorHistory = [];
    }

    /**
     * 启动适配器（同时启动绑定的策略）
     */
    start() {
        this.batch = [];
        this.vusHistory = [];
        this.rpsHistory = [];
        this.errorHistory = [];
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
            const timestamp = Date.now();

            if (metric === 'vus') {
                this.vusHistory.push({ t: timestamp, v: value });
                if (this.vusHistory.length > this.maxHistoryPoints) {
                    this.vusHistory.shift();
                }
            } else if (metric === 'http_reqs') {
                this.rpsHistory.push({ t: timestamp, v: value });
                if (this.rpsHistory.length > this.maxHistoryPoints) {
                    this.rpsHistory.shift();
                }
            } else if (metric === 'http_req_failed') {
                this.errorHistory.push({ t: timestamp, v: value || 0 });
                if (this.errorHistory.length > this.maxHistoryPoints) {
                    this.errorHistory.shift();
                }
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
        const currentVUs = this.vusHistory.length > 0
            ? this.vusHistory[this.vusHistory.length - 1].v
            : 0;

        // 计算RPS和错误率（最近5秒内的请求数/错误数累加）
        const cutoff = timestamp - 5000;
        const recentReqs = this.rpsHistory.filter(r => r.t > cutoff);
        const recentErrors = this.errorHistory.filter(r => r.t > cutoff);

        let rps = 0;
        let errorRate = 0;
        if (recentReqs.length >= 2) {
            const first = recentReqs[0];
            const last = recentReqs[recentReqs.length - 1];
            const dt = (last.t - first.t) / 1000;
            const totalRequests = recentReqs.reduce((sum, r) => sum + r.v, 0);
            const totalErrors = recentErrors.reduce((sum, r) => sum + r.v, 0);
            rps = dt > 0 ? totalRequests / dt : 0;
            errorRate = totalRequests > 0
                ? parseFloat(((totalErrors / totalRequests) * 100).toFixed(2))
                : 0;
        }

        // 采集系统资源利用率
        const resourceUtilization = this.resourceCollector
            ? this.resourceCollector.collect()
            : { cpu: 0, memory: 0, io: 0, disk: 0 };

        const dataPoint = {
            timestamp,
            vus: currentVUs,
            latency: parseFloat(avgLatency.toFixed(2)),
            rps: parseFloat(rps.toFixed(2)),
            errorRate,
            resourceUtilization
        };

        this.strategy.onDataPoint(dataPoint);
    }
}

module.exports = RealtimeDataAdapter;
