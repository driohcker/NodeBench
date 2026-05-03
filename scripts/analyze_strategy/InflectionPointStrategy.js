const fs = require('fs');
const path = require('path');

/**
 * 性能拐点分析策略
 * - 最优拐点：RPS/P95延迟 的效率最高点
 * - 最大拐点：系统吞吐量达到瓶颈，即将或已经出现性能下降（RPS下降或延迟急剧上升）的点
 */
class InflectionPointStrategy {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        // 从配置中获取数据目录，如果未配置，则默认为 'data'
        this.dataDir = path.join(process.cwd(), this.config.dataDir || 'data');
    }

    /**
     * 执行分析
     * @param {string} sessionId - 需要分析的测试会话ID
     * @returns {object} 分析结果
     */
    run(sessionId) {
        this.logger.info(`开始使用 InflectionPointStrategy 分析会话 ${sessionId}...`);

        const dataPath = path.join(this.dataDir, `test_result_session_${sessionId}.json`);

        if (!fs.existsSync(dataPath)) {
            const message = `分析失败：找不到会话 ${sessionId} 的测试结果文件于 ${dataPath}`;
            this.logger.error(message);
            return { success: false, message };
        }

        try {
            const rawData = fs.readFileSync(dataPath, 'utf-8');
            const testResult = JSON.parse(rawData);
            const performanceData = testResult.performance_trend;

            if (!performanceData || performanceData.length < 3) {
                const message = `分析中止：会话 ${sessionId} 的性能数据点不足（需要至少3个），无法进行趋势分析。`;
                this.logger.warn(message);
                return { success: false, message };
            }

            // 确保数据按VUs排序
            performanceData.sort((a, b) => a.vus - b.vus);

            const optimalPoint = this.findOptimalPoint(performanceData);
            const maxPoint = this.findMaxPoint(performanceData);

            return this.formatReport(sessionId, optimalPoint, maxPoint, performanceData);

        } catch (error) {
            const message = `分析会话 ${sessionId} 时发生意外错误: ${error.message}`;
            this.logger.error(error.stack);
            return { success: false, message };
        }
    }

    /**
     * 查找最优拐点 (性价比最高)
     * @param {Array} data - 性能数据点
     */
    findOptimalPoint(data) {
        let optimalPoint = null;
        let maxEfficiency = -1;

        for (const point of data) {
            // 避免除以0或负数
            if (point.p95_latency_ms > 0 && point.rps > 0) {
                const efficiency = point.rps / point.p95_latency_ms;
                if (efficiency > maxEfficiency) {
                    maxEfficiency = efficiency;
                    optimalPoint = point;
                }
            }
        }
        this.logger.info(`找到最优拐点: VUs=${optimalPoint?.vus}, RPS=${optimalPoint?.rps.toFixed(2)}, P95=${optimalPoint?.p95_latency_ms.toFixed(2)}ms`);
        return optimalPoint;
    }

    /**
     * 查找最大拐点 (系统能力上限)
     * @param {Array} data - 性能数据点
     */
    findMaxPoint(data) {
        if (!data || data.length === 0) {
            return null;
        }

        // 1. 找到RPS最高的点
        let maxRpsPoint = data[0];
        for (let i = 1; i < data.length; i++) {
            if (data[i].rps > maxRpsPoint.rps) {
                maxRpsPoint = data[i];
            }
        }

        const maxRpsIndex = data.indexOf(maxRpsPoint);

        // 2. 如果RPS在测试中途达到顶峰然后下降，那么这个峰值点就是最大拐点
        if (maxRpsIndex < data.length - 1) {
            this.logger.info(`发现RPS在VUs=${maxRpsPoint.vus}后下降，认定该点为最大拐点。`);
            return maxRpsPoint;
        }

        // 3. 如果RPS持续增长，再检查延迟是否出现急剧拐点
        for (let i = 0; i < data.length - 1; i++) {
            const currentPoint = data[i];
            const nextPoint = data[i + 1];

            // 延迟急剧增加的定义: P95延迟翻倍且绝对值增加超过50ms，或绝对值增加超过200ms
            const latencySpiked = (nextPoint.p95_latency_ms > currentPoint.p95_latency_ms * 2 && (nextPoint.p95_latency_ms - currentPoint.p95_latency_ms > 50)) ||
                                  (nextPoint.p95_latency_ms - currentPoint.p95_latency_ms > 200);

            if (latencySpiked) {
                this.logger.info(`发现延迟在VUs=${currentPoint.vus}后急剧增加，认定该点为最大拐点。`);
                return currentPoint; // 拐点是延迟急剧变化前的那个点
            }
        }

        // 4. 如果以上两种情况都未发生，说明未找到明确拐点
        this.logger.warn('未在测试中发现明显的性能拐点，可能尚未达到系统极限。将使用RPS最高的点作为观察到的最大性能点。');
        return maxRpsPoint;
    }

    /**
     * 格式化最终报告
     */
    formatReport(sessionId, optimalPoint, maxPoint, allData) {
        const lastPoint = allData[allData.length - 1];
        let summary = '';
        let performanceLimit = {};

        if (maxPoint && maxPoint.vus < lastPoint.vus) {
            // 找到了明确的拐点
            summary = `系统在 VUs=${maxPoint.vus} 时达到性能上限。`;
            performanceLimit = {
                vus: maxPoint.vus,
                rps: parseFloat(maxPoint.rps.toFixed(2)),
                p95_latency_ms: parseFloat(maxPoint.p95_latency_ms.toFixed(2))
            };
        } else {
            // 未找到明确拐点，测试可能未触及系统极限
            summary = `在当前测试范围（最高 ${lastPoint.vus} VUs）内，未探测到明确的性能拐点。观察到的最大性能为：`;
            performanceLimit = {
                vus: lastPoint.vus,
                rps: parseFloat(lastPoint.rps.toFixed(2)),
                p95_latency_ms: parseFloat(lastPoint.p95_latency_ms.toFixed(2))
            };
        }

        const report = {
            success: true,
            sessionId,
            summary,
            performanceLimit,
            optimalInflectionPoint: optimalPoint ? {
                vus: optimalPoint.vus,
                rps: parseFloat(optimalPoint.rps.toFixed(2)),
                p95_latency_ms: parseFloat(optimalPoint.p95_latency_ms.toFixed(2))
            } : null,
            maxInflectionPoint: maxPoint ? {
                vus: maxPoint.vus,
                rps: parseFloat(maxPoint.rps.toFixed(2)),
                p95_latency_ms: parseFloat(maxPoint.p95_latency_ms.toFixed(2))
            } : null,
        };

        this.logger.info(`分析完成，报告已生成。性能上限评估: ${report.summary}`);
        return report;
    }
}

module.exports = InflectionPointStrategy;