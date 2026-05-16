const monitorModule = require('../modules/monitor_module/moduleIndex');

class MonitorModuleService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;

        this.monitorModule = null;

        this.initialize();
    }

    async initialize() {
        try {
            this.monitorModule = new monitorModule(this.config, this.logger);
            this.logger.info('监控模块服务初始化成功！');
        } catch (error) {
            this.logger.error(`监控模块服务初始化失败: ${error.message}`);
        }
    }

    async getCommand() {
        return this.monitorModule.getCommand();
    }
}

module.exports = MonitorModuleService;
