/**
 * DataFilter - k6测试数据过滤器
 * 根据配置的过滤参数，从k6原始输出中提取有用数据
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
                if (this.filterZeroValues && value === 0) {
                    if (this.filterZeroMetrics.size === 0 || this.filterZeroMetrics.has(metric)) {
                        return null;
                    }
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
