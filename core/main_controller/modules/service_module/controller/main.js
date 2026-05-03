const express_service = require('../service/express_service');

class MainController {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;

        this.expressService = new express_service(this.config, this.logger);
    }

    async startExpressService(){
        await this.expressService.startExpressService();
    }
    
    async stopExpressService(){
        await this.expressService.stopExpressService();
    }

    async getStatusExpressService(){
        let status = await this.expressService.getStatusExpressService();
        this.logger.info('服务状态检查完成', status);
        return status;
    }

    async getConfig(){
        this.logger.info('获取服务配置信息');
        this.logger.info('============================================');
        this.logger.info('            被测服务配置');
        this.logger.info('============================================');
        Object.keys(this.config).forEach(key => {
            this.logger.info(`${key}: ${this.config[key]}`);
        });
        this.logger.info('============================================');
        return this.config;
    }

    async updateConfig(config){
        this.config = config;
    }

    async exit(exit = "true"){
        this.logger.info('正在停止被测服务...');
        await this.stopExpressService();
        this.logger.info('被测服务已停止，正在退出程序...');
        if(exit === "true"){
            this.logger.info('ServerModule: 退出程序');
            process.exit(0);
        }
    }
}

module.exports = MainController;