const fs = require('fs');
const path = require('path');
const MetricsAnalyzer = require('../helper/MetricsAnalyzer');
const SummaryAnalyzer = require('../helper/SummaryAnalyzer');

/**
 * 结果处理器服务
 * 提供对已完成测试会话的后期处理功能，例如重新分析。
 */
class ResultProcessorService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.metricsAnalyzer = new MetricsAnalyzer(this.config, this.logger);
        this.summaryAnalyzer = new SummaryAnalyzer(this.config, this.logger);
    }

    /**
     * 仅重新分析 metrics 文件，返回 test_result_session_${sessionId}.json 路径
     * @param {string} sessionId
     * @returns {Promise<string>}
     */
    async analyzeMetrics(sessionId) {
        return await this.metricsAnalyzer.analyze(sessionId);
    }

    /**
     * 仅重新分析 summary 文件，返回 summary_result_session_${sessionId}.json 路径
     * @param {string} sessionId
     * @returns {Promise<string>}
     */
    async analyzeSummary(sessionId) {
        return await this.summaryAnalyzer.analyze(sessionId);
    }

    /**
     * 根据指定的会话ID，重新分析其metrics.json文件，并覆盖更新测试结果。
     * @param {string} sessionId - 不包含 "session_" 前缀的会话ID。
     * @returns {Promise<string>} - 成功更新后的结果文件路径。
     */
    async reanalyzeTestSession(sessionId, target = 'metrics') {
        this.logger.info(`请求重新分析测试会话: ${sessionId}`);
        if (target === 'metrics') {
            return await this.analyzeMetrics(sessionId);
        } else if (target === 'summary') {
            return await this.analyzeSummary(sessionId);
        }
        throw new Error(`无效的目标分析类型: ${target}`);
    }
}

module.exports = ResultProcessorService;