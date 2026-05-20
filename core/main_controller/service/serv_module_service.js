const serviceModule = require('../modules/service_module/moduleIndex');

class ServModuleService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;

        this.serviceModule = null;

        this.initialize()
    }

    async initialize() {
        try {
            this.serviceModule = new serviceModule(this.config, this.logger);
            this.logger.info('服务模块服务初始化成功！');
        } catch (error) {
            this.logger.error(`服务模块服务初始化失败: ${error.message}`);
        }
    }

    async getCommand() {
        return this.serviceModule.getCommand();
    }
}

module.exports = ServModuleService;
