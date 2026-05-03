const fs = require('fs');
const path = require('path');

class SummaryAnalyzer {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    /**
     * 分析会话目录中的所有摘要文件，并创建合并报告。
     * @param {string} sessionId 
     * @returns {Promise<string>} 生成报告的路径。
     */
    async analyze(sessionId) {
        this.logger.info(`开始使用 SummaryAnalyzer 分析会话 ${sessionId} 的测试摘要...`);
        const sessionDir = path.join(process.cwd(), 'logs', 'test', `test_session_${sessionId}`);
        const outputPath = path.join(process.cwd(), 'data', `test_result_session_${sessionId}.json`);

        if (!fs.existsSync(sessionDir)) {
            this.logger.error(`会话目录不存在: ${sessionDir}`);
            throw new Error(`Session directory not found: ${sessionDir}`);
        }

        const summaryFiles = fs.readdirSync(sessionDir)
            .filter(file => file.startsWith('summary_') && file.endsWith('.json'))
            .sort((a, b) => {
                const stepA = this.extractStepFromFilename(a);
                const stepB = this.extractStepFromFilename(b);
                return stepA - stepB;
            });

        if (summaryFiles.length === 0) {
            this.logger.warn(`在 ${sessionDir} 中没有找到摘要文件 (summary_*.json)`);
            return null;
        }

        this.logger.info(`找到了 ${summaryFiles.length} 个摘要文件进行分析。`);

        const report = [];
        for (const file of summaryFiles) {
            try {
                const filePath = path.join(sessionDir, file);
                const summaryContent = fs.readFileSync(filePath, 'utf-8');
                const summary = JSON.parse(summaryContent);

                const step = this.extractStepFromFilename(file);

                const metrics = summary.metrics;

                const vus = metrics.vus.value;
                const http_req_duration = metrics.http_req_duration;
                const http_reqs = metrics.http_reqs;

                if (!http_req_duration || !http_reqs) {
                    this.logger.warn(`摘要文件 ${file} 缺少必要的度量(http_req_duration 或 http_reqs)，已跳过。`);
                    continue;
                }

                const avg_latency_ms = this.safeNum(http_req_duration, 'avg');
                const p95_latency_ms = this.safeNum(http_req_duration, 'p(95)');
                const rps            = this.safeNum(http_reqs, 'rate');

                if ([avg_latency_ms, p95_latency_ms, rps].some(v => v === null)) {
                    this.logger.warn(`摘要文件 ${file} 缺少必要 latency/rate 字段，已跳过。`);
                    continue;
                }

                // TODO: 信息还需丰富
                report.push({
                    stage: step,
                    vus: vus,
                    avg_latency_ms: parseFloat(avg_latency_ms.toFixed(2)),
                    p95_latency_ms: parseFloat(p95_latency_ms.toFixed(2)),
                    rps: parseFloat(rps.toFixed(2))
                });

            } catch (error) {
                this.logger.error(`处理摘要文件 ${file} 时出错`, { error: error.message, stack: error.stack });
            }
        }

        const finalResult = {
            sessionId,
            config: this.config,
            analyzedAt: new Date().toISOString(),
            performance_trend: report
        };
        fs.writeFileSync(outputPath, JSON.stringify(finalResult, null, 2));
        this.logger.info(`SummaryAnalyzer 报告已生成: ${outputPath}`);

        return outputPath;
    }

    extractStepFromFilename(filename) {
        const match = filename.match(/summary_(\d+).json/);
        return match ? parseInt(match[1], 10) : 0;
    }

    safeNum(obj, key, fallback = null) {
        return (obj && typeof obj[key] === 'number') ? obj[key] : fallback;
    }
}

module.exports = SummaryAnalyzer;