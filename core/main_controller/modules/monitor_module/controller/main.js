const StrategyService = require('../service/strategy_service');
const ReportGenerator = require('../helper/ReportGenerator');

class MainController {
    constructor(config, logger) {
        this.logger = logger;
        this.config = config;
        
        this.strategyService = new StrategyService(this.config, this.logger);
        this.reportGenerator = new ReportGenerator(this.config, this.logger);
    }


    async startAnalyze(sessionId, scriptName) {
        const strategy = scriptName || this.config.analysisStrategy;
        try {
            this.logger.info(`开始执行分析脚本 ${strategy}`);

            const analyzeResult = await this.strategyService.startAnalyze(strategy, sessionId);

            this.logger.info(`分析脚本 ${strategy} 执行完成`);

            // 如果分析成功，生成性能标定报告
            if (analyzeResult && analyzeResult.success) {
                try {
                    const reportPath = this.reportGenerator.generate(sessionId, analyzeResult);
                    analyzeResult.reportPath = reportPath;
                } catch (reportError) {
                    this.logger.error(`生成报告失败:`, { error: reportError.message });
                }
            }

            return analyzeResult;
        } catch (error) {
            this.logger.error(`执行分析脚本 ${strategy} 失败:`, { error: error.message, stack: error.stack });
            throw error;
        }
    }    

    async listStrategies() {
        try {
            const scripts = await this.strategyService.getAnalyzeScripts();
            this.logger.info('============================================');
            this.logger.info('            可用的分析脚本');
            this.logger.info('============================================');
            if (scripts.length === 0) {
                this.logger.info('没有找到分析脚本');
            } else {
                scripts.forEach(script => {
                    this.logger.info(`- ${script.name}`);
                });
            }
            this.logger.info('============================================');
            return scripts;
        } catch (error) {
            this.logger.error('获取脚本列表失败', { error: error.message });
        }
    }
    

    async getConfig() {
        try {
            const conf = this.config;
            this.logger.info('============================================');
            this.logger.info('            分析端配置');
            this.logger.info('============================================');
            Object.keys(conf).forEach(key => {
                this.logger.info(`${key}: ${conf[key]}`);
            });
            this.logger.info('============================================');
            return conf;
        } catch (error) {
            this.logger.error('获取配置失败', { error: error.message });
        }
    }

    async exit(exit = "true"){
        this.logger.info('正在停止分析服务...');
        
        this.logger.info('分析服务已停止，正在退出程序...');
        if(exit === "true"){
            this.logger.info('MonitorModule: 退出程序');
            process.exit(0);
        }
    }
}

module.exports = MainController;