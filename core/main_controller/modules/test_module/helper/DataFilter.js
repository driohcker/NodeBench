/**
 * DataFilter - k6测试数据过滤器
 * 根据配置的过滤参数，从k6原始输出中提取有用数据
 * 大波动（Spike）过滤：实时读取配置，对异常跳变数据点进行安全过滤
 */
class DataFilter {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        // 默认过滤的指标
        this.allowedMetrics = new Set(config.metricFilters || ['vus', 'http_reqs', 'http_req_duration', 'http_req_failed']);
        // 是否过滤值为0的无效数据，默认开启
        this.filterZeroValues = config.filterZeroValues !== false;
        // 指定哪些指标需要过滤0值（默认全部）
        this.filterZeroMetrics = new Set(config.filterZeroMetrics || []);
        // 是否过滤null/undefined/NaN等无效值，默认开启
        this.filterInvalidValues = config.filterInvalidValues !== false;

        // 状态：指标历史滑动窗口
        this.metricHistory = new Map(); // metric -> [values]
    }

    /**
     * 重置大波动过滤状态（每次新测试子流程开始时调用）
     */
    reset() {
        this.metricHistory.clear();
    }

    /**
     * 实时读取当前大波动过滤配置
     * 关键：每次调用都从 ConfigManager 代理重新读取，确保 GUI 开关/保存后立即生效
     */
    _getSpikeConfig() {
        const spikeCfg = this.config.spikeFilter || {};
        return {
            enabled: spikeCfg.enabled !== false,
            windowSize: spikeCfg.windowSize || 10,
            threshold: spikeCfg.threshold || 3.0,
            minAbsoluteThreshold: spikeCfg.minAbsoluteThreshold || 10,
            minHistory: spikeCfg.minHistory || 3,
            metrics: new Set(spikeCfg.metrics || ['http_req_duration'])
        };
    }

    /**
     * 检测是否为统计意义上的大波动（Spike）
     *
     * 对 http_req_duration（延迟）：
     *   使用滑动窗口中位数的相对偏差检测。
     *   ramp-up 期间延迟自然增长不会被误判（中位数会跟随趋势滑动），
     *   只过滤与近期稳态水平严重背离的极端异常点（如 50ms → 5000ms）。
     *
     * 对 http_reqs（累计请求数）：
     *   只检测累计值回退（当前值 < 前值），这是 k6 数据流中明确的数据错误。
     *   不做增量异常检测，因为采样间隔不均匀会导致正常增量剧烈波动，极易误判。
     */
    _isSpike(metric, value) {
        const cfg = this._getSpikeConfig();
        if (!cfg.enabled || !cfg.metrics.has(metric)) return false;

        let history = this.metricHistory.get(metric);
        if (!history) {
            history = [];
            this.metricHistory.set(metric, history);
        }

        // ─── http_reqs：累计值，只检测回退 ───
        if (metric === 'http_reqs') {
            if (history.length > 0 && value < history[history.length - 1]) {
                this.logger.info(`[DataFilter] 过滤${metric}累计值回退: value=${value}, prev=${history[history.length - 1]}`);
                // 回退值不加入历史窗口
                return true;
            }
            history.push(value);
            if (history.length > cfg.windowSize) history.shift();
            return false;
        }

        // ─── http_req_duration 等其他指标：相对偏差检测 ───
        // 先加入历史窗口，确保即使当前值被判定为 spike，窗口也能跟随真实趋势滑动，
        // 避免历史窗口停滞在低值导致后续正常上涨数据被连续误过滤。
        history.push(value);
        if (history.length > cfg.windowSize) history.shift();

        if (history.length < cfg.minHistory) {
            return false;
        }

        // 用加入当前值后的窗口计算中位数（这样中位数能反映最新趋势）
        const sorted = [...history].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];

        if (median === 0) {
            return false;
        }

        const deviation = Math.abs(value - median);
        const relativeDeviation = deviation / median;

        // 同时满足相对偏差和绝对偏差阈值，防止小数值场景过度敏感
        if (relativeDeviation > cfg.threshold && deviation > cfg.minAbsoluteThreshold) {
            this.logger.info(`[DataFilter] 过滤${metric}大波动: value=${value.toFixed(2)}, median=${median.toFixed(2)}, relativeDeviation=${(relativeDeviation * 100).toFixed(1)}%`);
            return true;
        }

        return false;
    }

    /**
     * 判断一行k6输出是否应该被保留
     * @param {string} line - k6 stdout的一行输出
     * @returns {boolean}
     */
    shouldKeep(line) {
        try {
            const obj = JSON.parse(line);
            if (obj.type === 'Point' && this.allowedMetrics.has(obj.metric)) {
                const value = obj.data?.value;
                const metric = obj.metric;

                // 过滤null/undefined/NaN等无效值
                if (this.filterInvalidValues && (value === null || value === undefined || Number.isNaN(value))) {
                    return false;
                }

                // 过滤值为0的无效数据，避免监测端数据剧烈波动
                // 支持按指标精确控制（若filterZeroMetrics未指定则全部过滤）
                // http_req_failed 的 0 值表示请求成功，是有效数据，必须保留以正确计算错误率
                if (this.filterZeroValues && value === 0 && metric !== 'http_req_failed') {
                    if (this.filterZeroMetrics.size === 0 || this.filterZeroMetrics.has(metric)) {
                        return false;
                    }
                }
                return true;
            }
            // 保留summary和子流程标记
            if (obj.type === 'Summary' || obj.subFlowComplete) {
                return true;
            }
        } catch (e) {
            // 非JSON行，根据模式决定是否保留
            // 在实时模式下，非JSON行（如横幅、进度）通常丢弃
            return false;
        }
        return false;
    }

    /**
     * 过滤并格式化一行数据
     * @param {string} line
     * @returns {string|null} 过滤后的行，如果不符合则返回null
     */
    filterLine(line) {
        try {
            const obj = JSON.parse(line);
            if (obj.type === 'Point' && this.allowedMetrics.has(obj.metric)) {
                const value = obj.data?.value;
                const metric = obj.metric;

                // 过滤null/undefined/NaN等无效值
                if (this.filterInvalidValues && (value === null || value === undefined || Number.isNaN(value))) {
                    return null;
                }

                // 过滤值为0的无效数据，避免监测端数据剧烈波动
                // http_req_failed 的 0 值表示请求成功，是有效数据，必须保留以正确计算错误率
                if (this.filterZeroValues && value === 0 && metric !== 'http_req_failed') {
                    if (this.filterZeroMetrics.size === 0 || this.filterZeroMetrics.has(metric)) {
                        return null;
                    }
                }

                // 大波动（Spike）过滤：检测与近期趋势严重偏离的异常点
                if (this._isSpike(metric, value)) {
                    return null;
                }

                // 精简输出，只保留关键字段
                const filtered = {
                    type: 'Point',
                    metric: obj.metric,
                    data: {
                        time: obj.data?.time,
                        value: obj.data?.value
                    }
                };
                return JSON.stringify(filtered);
            }
            if (obj.type === 'Summary' || obj.type === 'SubFlowComplete' || obj.subFlowComplete) {
                return line;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    /**
     * 从汇总数据中提取关键性能指标
     */
    extractSummaryMetrics(summaryContent) {
        try {
            const summary = typeof summaryContent === 'string' ? JSON.parse(summaryContent) : summaryContent;
            const metrics = summary.metrics || {};
            
            return {
                vus: metrics.vus?.value,
                http_req_duration_avg: metrics.http_req_duration?.avg,
                http_req_duration_p95: metrics.http_req_duration?.['p(95)'],
                http_reqs_rate: metrics.http_reqs?.rate,
                http_req_failed_rate: metrics.http_req_failed?.rate
            };
        } catch (e) {
            this.logger.warn(`[DataFilter] 提取summary指标失败: ${e.message}`);
            return null;
        }
    }
}

module.exports = DataFilter;
