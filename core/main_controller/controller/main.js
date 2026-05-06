const ServModuleService = require('../service/serv_module_service');
const TestModuleService = require('../service/test_module_service');
const Logger = require('../utils/logger');


/**
 * 主控端控制器 - 统一管理所有子模块
 * 提供对测试端、监测端、服务器端的统一控制
 */
class MainController {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        
        // 子模块服务管理器
        // 服务模块使用独立的 logger，避免日志写入主控目录
        const serverLogger = new Logger(this.config.getServerConfig().logDir);
        this.servModuleService = new ServModuleService(this.config.getServerConfig(), serverLogger);
        // 测试模块使用独立的 logger，避免日志写入主控目录
        const testLogger = new Logger(this.config.getTestConfig().logDir);
        this.testModuleService = new TestModuleService(this.config.getTestConfig(), testLogger);
    }

    

    async handleServerModuleCommand(command) {
        const serverCommandObj = await this.servModuleService.getCommand();
        await serverCommandObj.executeCommand(command);
    }

    async handleTestModuleCommand(command) {
        const testCommandObj = await this.testModuleService.getCommand();
        await testCommandObj.executeCommand(command);
    }

    async runAllModules(){
        await this.handleServerModuleCommand('start');
        await this.handleTestModuleCommand('start');
    }

    async getConfig(isAll = ""){

        try {
            const globalConfig = this.config.getGlobalConfig();
            this.logger.info('============================================');
            this.logger.info('            全局配置');
            this.logger.info('============================================');
            Object.keys(globalConfig).forEach(key => {
                this.logger.info(`${key}: ${globalConfig[key]}`);
            });
            this.logger.info('============================================');

            const conf = this.config.getMainConfig();
            this.logger.info('============================================');
            this.logger.info('            主控端端配置');
            this.logger.info('============================================');
            Object.keys(conf).forEach(key => {
                this.logger.info(`${key}: ${conf[key]}`);
            });
            this.logger.info('============================================');

            if (isAll === "all"){
                await this.handleServerModuleCommand('config');
                await this.handleTestModuleCommand('config');
            }
            return conf;
        } catch (error) {
            this.logger.error('获取配置失败', { error: error.message });
        }
    }

    async exit(exit = "true"){
        await this.handleServerModuleCommand('exit false');
        await this.handleTestModuleCommand('exit false');
        if(exit === "true"){
            this.logger.info('MainModule: 退出程序');
            process.exit(0);
        }
    }
}

module.exports = MainController;