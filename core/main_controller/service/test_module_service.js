const testModule = require('../modules/test_module/moduleIndex');

class TestModuleService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;

        this.testModule = null;

        this.initialize();
    }

    async initialize() {
        try {
            this.testModule = new testModule(this.config, this.logger);
            this.logger.info('测试模块服务初始化成功！');
        } catch (error) {
            this.logger.error(`测试模块服务初始化失败: ${error.message}`);
        }
    }

    async getCommand() {
        return this.testModule.getCommand();
    }
}

module.exports = TestModuleService;
