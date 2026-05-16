const AnalyzerService = require('../service/analyzer_service');

class MainController {
    constructor(config, logger) {
        this.logger = logger;
        this.config = config;
        this.analyzerService = new AnalyzerService(this.config, this.logger);
    }

    /**
     * 选择分析策略
     * @param {string} strategyName - 策略文件名
     */
    async selectStrategy(strategyName) {
        try {
            this.logger.info(`[AnalyzerController] 选择分析策略: ${strategyName}`);
            const result = this.analyzerService.selectStrategy(strategyName);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[AnalyzerController] 选择策略失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 分析数据报告
     * @param {string} sessionId - 测试流程sessionId
     */
    async analyzeDataReport(sessionId) {
        try {
            if (!sessionId) {
                throw new Error('sessionId不能为空');
            }
            this.logger.info(`[AnalyzerController] 分析数据报告: sessionId=${sessionId}`);
            const result = await this.analyzerService.analyzeDataReport(sessionId);
            this.logger.info(`[AnalyzerController] 分析完成，生成 ${result.reports.length} 份报告`);
            return result;
        } catch (error) {
            this.logger.error('[AnalyzerController] 分析数据报告失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 生成标定报告
     * @param {string} sessionId - 测试流程sessionId
     */
    async generateBenchmarkReport(sessionId) {
        try {
            if (!sessionId) {
                throw new Error('sessionId不能为空');
            }
            this.logger.info(`[AnalyzerController] 生成标定报告: sessionId=${sessionId}`);
            const result = await this.analyzerService.generateBenchmarkReport(sessionId);
            this.logger.info(`[AnalyzerController] 标定报告已生成: ${result.reportPath}`);
            return result;
        } catch (error) {
            this.logger.error('[AnalyzerController] 生成标定报告失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 转码标定报告
     * @param {string} sessionId - 测试流程sessionId
     * @param {string} format - pdf | excel
     */
    async transcodeReport(sessionId, format) {
        try {
            if (!sessionId) {
                throw new Error('sessionId不能为空');
            }
            format = format || 'pdf';
            this.logger.info(`[AnalyzerController] 转码标定报告: sessionId=${sessionId}, format=${format}`);
            const result = await this.analyzerService.transcodeReport(sessionId, format);
            return result;
        } catch (error) {
            this.logger.error('[AnalyzerController] 转码报告失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 列出可用策略
     */
    async listStrategies() {
        try {
            const strategies = this.analyzerService.listStrategies();
            this.logger.info('[AnalyzerController] 可用分析策略:');
            this.logger.info('============================================');
            if (strategies.length === 0) {
                this.logger.info('未找到分析策略');
            } else {
                strategies.forEach(s => this.logger.info(`- ${s.name}`));
            }
            this.logger.info('============================================');
            return strategies;
        } catch (error) {
            this.logger.error('[AnalyzerController] 获取策略列表失败', { error: error.message });
            return [];
        }
    }

    /**
     * 获取分析端配置
     */
    async getConfig() {
        try {
            this.logger.info('[AnalyzerController] 获取分析端配置');
            this.logger.info('============================================');
            this.logger.info('            分析端配置');
            this.logger.info('============================================');
            const conf = this.config;
            Object.keys(conf).forEach(key => {
                const val = conf[key];
                if (typeof val !== 'function') {
                    this.logger.info(`${key}: ${JSON.stringify(val)}`);
                }
            });
            this.logger.info('============================================');
            return conf;
        } catch (error) {
            this.logger.error('[AnalyzerController] 获取配置失败', { error: error.message });
            return {};
        }
    }

    async exit(exit = 'true') {
        this.logger.info('[AnalyzerController] 正在停止分析服务...');
        this.logger.info('[AnalyzerController] 分析服务已停止');
        if (exit === 'true') {
            this.logger.info('AnalyzerModule: 退出程序');
            process.exit(0);
        }
    }
}

module.exports = MainController;
