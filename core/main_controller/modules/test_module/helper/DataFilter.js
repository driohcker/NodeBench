/**
 * DataFilter - k6测试数据过滤器
 * 根据配置的过滤参数，从k6原始输出中提取有用数据
 * 新增大波动（Spike）过滤：基于一阶差分的MAD检测，过滤与近期趋势严重偏离的异常点
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

        // ─── 大波动（Spike）过滤配置 ───
        const spikeCfg = config.spikeFilter || {};
        this.spikeFilterEnabled = spikeCfg.enabled !== false;
        this.spikeFilterWindowSize = spikeCfg.windowSize || 10;
        this.spikeFilterThreshold = spikeCfg.threshold || 3.0; // MAD倍数
        this.spikeFilterMinAbsThreshold = spikeCfg.minAbsoluteThreshold || 10;
        this.spikeFilterMetrics = new Set(spikeCfg.metrics || ['http_reqs', 'http_req_duration']);
        this.spikeFilterMinHistory = spikeCfg.minHistory || 3;

        // 状态：指标历史值与差分历史
        this.metricHistory = new Map();   // metric -> [values]
        this.metricDiffHistory = new Map(); // metric -> [diffs]
    }

    /**
     * 重置大波动过滤状态（每次新测试子流程开始时调用）
     */
    reset() {
        this.metricHistory.clear();
        this.metricDiffHistory.clear();
    }

    /**
     * 检测是否为统计意义上的大波动（Spike）
     * 算法：基于一阶差分的MAD（Median Absolute Deviation）异常检测
     * 原理：维护最近windowSize个数据点，计算相邻点差分序列；
     *       若新点与上一节点的差分偏离差分中位数超过 K*MAD，则视为大波动。
     * 优点：对 ramp-up 趋势天然免疫，只过滤与近期变化规律严重背离的突变。
     */
    _isSpike(metric, value) {
        if (!this.spikeFilterEnabled || !this.spikeFilterMetrics.has(metric)) return false;

        let history = this.metricHistory.get(metric);
        let diffHistory = this.metricDiffHistory.get(metric);
        if (!history) {
            history = [];
            diffHistory = [];
            this.metricHistory.set(metric, history);
            this.metricDiffHistory.set(metric, diffHistory);
        }

        // 第一个点直接接受
        if (history.length === 0) {
            history.push(value);
            return false;
        }

        const prevValue = history[history.length - 1];
        const diff = value - prevValue;

        // 历史差分不足时直接接受并累积
        if (diffHistory.length < this.spikeFilterMinHistory) {
            history.push(value);
            diffHistory.push(diff);
            if (history.length > this.spikeFilterWindowSize) history.shift();
            if (diffHistory.length > this.spikeFilterWindowSize) diffHistory.shift();
            return false;
        }

        // 计算差分中位数
        const sortedDiffs = [...diffHistory].sort((a, b) => a - b);
        const mid = Math.floor(sortedDiffs.length / 2);
        const medianDiff = sortedDiffs.length % 2 === 0
            ? (sortedDiffs[mid - 1] + sortedDiffs[mid]) / 2
            : sortedDiffs[mid];

        // 计算 MAD = median(|diff_i - medianDiff|)
        const deviations = diffHistory.map(d => Math.abs(d - medianDiff));
        const sortedDevs = [...deviations].sort((a, b) => a - b);
        const mad = sortedDevs.length % 2 === 0
            ? (sortedDevs[mid - 1] + sortedDevs[mid]) / 2
            : sortedDevs[mid];

        // 阈值 = max(K * MAD, minAbsoluteThreshold)
        const threshold = Math.max(this.spikeFilterThreshold * mad, this.spikeFilterMinAbsThreshold);
        const deviation = Math.abs(diff - medianDiff);

        if (deviation > threshold) {
            this.logger.info(`[DataFilter] 过滤${metric}大波动: value=${value.toFixed(2)}, prev=${prevValue.toFixed(2)}, diff=${diff.toFixed(2)}, medianDiff=${medianDiff.toFixed(2)}, deviation=${deviation.toFixed(2)}, threshold=${threshold.toFixed(2)}`);
            return true;
        }

        // 正常点：更新历史
        history.push(value);
        diffHistory.push(diff);
        if (history.length > this.spikeFilterWindowSize) history.shift();
        if (diffHistory.length > this.spikeFilterWindowSize) diffHistory.shift();
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
