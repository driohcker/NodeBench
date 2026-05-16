const analyzerModule = require('../modules/analyzer_module/moduleIndex');

class AnalyzerModuleService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;

        this.analyzerModule = null;

        this.initialize();
    }

    async initialize() {
        try {
            this.analyzerModule = new analyzerModule(this.config, this.logger);
            this.logger.info('分析模块服务初始化成功！');
        } catch (error) {
            this.logger.error(`分析模块服务初始化失败: ${error.message}`);
        }
    }

    async getCommand() {
        return this.analyzerModule.getCommand();
    }
}

module.exports = AnalyzerModuleService;
