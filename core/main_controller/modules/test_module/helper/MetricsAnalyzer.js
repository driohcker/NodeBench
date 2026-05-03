const fs = require('fs');
const path = require('path');

/**
 * k6度量分析器
 * 用于解析k6输出的metrics.json文件，并按阶段生成性能趋势报告
 */
class MetricsAnalyzer {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    /**
     * 对外简易接口：仅需 sessionId 即可完成全部分析与落盘
     * @param {string} sessionId - 测试会话ID
     * @returns {Promise<string>} - 输出报告路径
     */
    async analyze(sessionId) {
        const sessionDir = path.join(process.cwd(), 'logs', 'test', `test_session_${sessionId}`);
        if (!fs.existsSync(sessionDir)) {
            throw new Error(`会话目录不存在: ${sessionDir}`);
        }

        // 1. 扫描所有 metrics_*.json
        const metricFiles = fs.readdirSync(sessionDir)
            .filter(f => f.startsWith('metrics_') && f.endsWith('.json'))
            .sort((a, b) => {
                // 按步数排序：metrics_0.json < metrics_1.json < ...
                const na = parseInt(a.replace(/metrics_|\.json/g, ''), 10);
                const nb = parseInt(b.replace(/metrics_|\.json/g, ''), 10);
                return na - nb;
            });

        if (metricFiles.length === 0) {
            throw new Error('未找到任何 metrics_*.json 文件');
        }

        // 2. 合并所有 metrics 内容
        const allMetrics = [];
        for (const file of metricFiles) {
            const content = fs.readFileSync(path.join(sessionDir, file), 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());
            lines.forEach(l => allMetrics.push(JSON.parse(l)));
        }

        // 3. 反推 testConfig（简单策略：从文件名数量得 steps，从第一条 metric 估算 duration 与 VUs）
        const steps = metricFiles.length;
        const firstPoint = allMetrics.find(m => m.type === 'Point' && m.metric === 'http_req_duration');
        if (!firstPoint) throw new Error('metrics 中缺少 http_req_duration 数据');

        const startTime = new Date(firstPoint.data.time).getTime();
        const lastPoint = [...allMetrics].reverse().find(m => m.type === 'Point' && m.metric === 'http_req_duration');
        const endTime = new Date(lastPoint.data.time).getTime();
        const totalDurationMs = endTime - startTime;

        // 每阶段 duration 按 6s 估算（与步进脚本对齐），initVUs / maxVUs 从 vus 点估算
        const vusPoints = allMetrics.filter(m => m.metric === 'vus');
        const vusValues = vusPoints.map(p => p.data.value);
        const initVUs = Math.min(...vusValues);
        const maxVUs = Math.max(...vusValues);
        const durationPerStep = '6s'; // 固定与步进脚本一致，可再调

        const testConfig = { iterations: steps, duration: durationPerStep, initVUs, maxVUs };

        // 4. 调用内部分析
        const report = this._analyze(allMetrics, testConfig);

        // 5. 二次包装并输出 JSON
        const finalResult = {
            sessionId,
            config: this.config,
            analyzedAt: new Date().toISOString(),
            performance_trend: report
        };
        const outPath = path.join(sessionDir, `test_result_session_${sessionId}.json`);
        fs.writeFileSync(outPath, JSON.stringify(finalResult, null, 2));
        this.logger.info(`MetricsAnalyzer 报告已生成: ${outPath}`);
        return outPath;
    }

    /**
     * 内部分析逻辑（与原 analyze 相同，仅入口参数由文件路径改为合并后的 metrics 数组）
     * @private
     * @param {Array} metricsList - 合并后的 metrics 数组
     * @param {object} testConfig - 测试配置
     * @returns {Array} - 各阶段性能数组
     */
    _analyze(metricsList, testConfig) {
        this.logger.info(`开始分析合并后的 metrics，共 ${metricsList.length} 条记录`);

        const { iterations: steps, duration: durationPerStepStr, initVUs, maxVUs } = testConfig;
        const durationMs = this.parseDuration(durationPerStepStr);
        
        if (durationMs === 0) {
            this.logger.error('每个阶段的持续时间不能为0');
            return [];
        }

        const metrics = metricsList; // 直接复用已合并的数组

        const httpReqDurationPoints = metrics.filter(m => m.type === 'Point' && m.metric === 'http_req_duration');
        const httpReqsPoints = metrics.filter(m => m.type === 'Point' && m.metric === 'http_reqs');
        const vusPoints = metrics.filter(m => m.type === 'Point' && m.metric === 'vus');

        if (httpReqDurationPoints.length === 0) {
            this.logger.warn('度量文件中缺少http_req_duration数据，无法进行分析。');
            return [];
        }

        const startTime = new Date(metrics.find(m => m.type === 'Point').data.time).getTime();
        const report = [];

        const rampUpTimeMs = 1000; // 对应 stepped_load_test.js 中 { duration: '1s', target } 的爬升阶段
        const stepDurationMs = rampUpTimeMs + durationMs; // 每个完整步进的总时长

        // 重新计算期望的VUs目标，用于报告
        const expectedVusSteps = this.calculateExpectedVus(initVUs, maxVUs, steps);

        for (let i = 0; i < expectedVusSteps.length; i++) {
            const vusTarget = expectedVusSteps[i];
            const currentStepStartTime = startTime + (i * stepDurationMs);
            
            // 分析窗口应该是跳过“爬升时间”后的“稳定维持”阶段
            const stageAnalysisStartTime = currentStepStartTime + rampUpTimeMs;
            const stageAnalysisEndTime = stageAnalysisStartTime + durationMs;

            const stageDurations = httpReqDurationPoints
                .filter(p => {
                    const pointTime = new Date(p.data.time).getTime();
                    return pointTime >= stageAnalysisStartTime && pointTime < stageAnalysisEndTime;
                })
                .map(p => p.data.value);

            if (stageDurations.length === 0) {
                this.logger.warn(`阶段 ${i + 1} (目标VUs: ${vusTarget}) 在时间窗口 [${new Date(stageAnalysisStartTime).toISOString()}, ${new Date(stageAnalysisEndTime).toISOString()}] 内没有记录到任何请求，将被跳过。`);
                continue;
            }

            const stageReqCount = httpReqsPoints.filter(p => {
                const pointTime = new Date(p.data.time).getTime();
                return pointTime >= stageAnalysisStartTime && pointTime < stageAnalysisEndTime;
            }).length;

            const avgLatency = stageDurations.reduce((a, b) => a + b, 0) / stageDurations.length;
            const p95Latency = this.calculatePercentile(stageDurations, 95);
            const rps = stageReqCount / (durationMs / 1000);

            report.push({
                stage: i + 1,
                vus: vusTarget,
                avg_latency_ms: parseFloat(avgLatency.toFixed(2)),
                p95_latency_ms: parseFloat(p95Latency.toFixed(2)),
                rps: parseFloat(rps.toFixed(2))
            });
        }

        this.logger.info('度量文件分析完成');
        return report;
    }

    calculateExpectedVus(initVUs, maxVUs, steps) {
        if (steps <= 0) return [];
        if (steps === 1) return [maxVUs > 0 ? maxVUs : initVUs];

        const vus = new Set();
        for (let i = 0; i < steps; i++) {
            const progress = i / (steps - 1);
            const targetVUs = Math.round(initVUs + (maxVUs - initVUs) * progress);
            if (targetVUs > 0) {
                vus.add(targetVUs);
            }
        }
        return Array.from(vus).sort((a, b) => a - b);
    }

    createVusLookup(vusPoints) {
        // 返回一个函数，该函数可以找到任何给定时间戳的VUs值
        return (timestamp) => {
            // 二分查找来提高效率
            let low = 0, high = vusPoints.length - 1;
            let bestIndex = -1;

            while(low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (new Date(vusPoints[mid].data.time).getTime() <= timestamp) {
                    bestIndex = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            return bestIndex !== -1 ? vusPoints[bestIndex].data.value : 0;
        };
    }

    bucketRequestsByVus(reqPoints, vusLookup, expectedVusSteps) {
        const buckets = new Map(expectedVusSteps.map(vus => [vus, []]));

        reqPoints.forEach(req => {
            const reqTime = new Date(req.data.time).getTime();
            const actualVus = vusLookup(reqTime);

            // 找到最接近的期望VUs台阶
            let closestStep = -1;
            let minDiff = Infinity;

            for (const step of expectedVusSteps) {
                const diff = Math.abs(actualVus - step);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestStep = step;
                }
            }

            if (closestStep !== -1) {
                // 将请求延迟值放入对应的桶中
                buckets.get(closestStep).push(req.data.value);
            }
        });

        return buckets;
    }

    /**
     * 将k6的时间字符串 (e.g., "10s", "1m") 转换为毫秒
     * @param {string} durationStr 
     * @returns {number}
     */
    parseDuration(durationStr) {
        const match = durationStr.match(/^(\d+)(ms|s|m|h)$/);
        if (!match) return 0;

        const value = parseInt(match[1], 10);
        const unit = match[2];

        switch (unit) {
            case 'ms': return value;
            case 's': return value * 1000;
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            default: return 0;
        }
    }

    /**
     * 计算百分位数
     * @param {Array<number>} data - 已排序的数字数组
     * @param {number} percentile - 百分位 (0-100)
     * @returns {number}
     */
    calculatePercentile(data, percentile) {
        if (data.length === 0) return 0;
        data.sort((a, b) => a - b);
        const index = (percentile / 100) * (data.length - 1);
        if (Number.isInteger(index)) {
            return data[index];
        }
        const lower = Math.floor(index);
        const upper = lower + 1;
        const weight = index - lower;
        return data[lower] * (1 - weight) + data[upper] * weight;
    }
}

module.exports = MetricsAnalyzer;