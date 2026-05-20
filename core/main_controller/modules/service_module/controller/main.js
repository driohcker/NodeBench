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
        // this.logger.info('服务状态检查完成', status);
        return status;
    }

    async getConfig(){
        this.logger.info('获取服务配置信息');
        this.logger.info('============================================');
        this.logger.info('            被测服务配置');
        this.logger.info('============================================');
        // 将 Proxy 转为普通对象，确保跨进程传输正确
        const plainConfig = {};
        for (const key in this.config) {
            const val = this.config[key];
            plainConfig[key] = (val && typeof val === 'object' && !Array.isArray(val))
                ? JSON.parse(JSON.stringify(val))
                : val;
        }
        Object.keys(plainConfig).forEach(key => {
            this.logger.info(`${key}: ${plainConfig[key]}`);
        });
        this.logger.info('============================================');
        return plainConfig;
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