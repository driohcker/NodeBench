const MainController = require('./controller/main');

class ExpressService {
    constructor() {
        this.mainController = new MainController();
    }

    async initialize() {
        try{
            await this.mainController.initialize();
            this.initialized = true;
        }catch (error) {
            console.error(`初始化失败: ${error.message}`);
            process.exit(1);
        }
        return true;
    }
    
    async start() {
        if (!this.initialized) {
            await this.initialize();
        }
        await this.mainController.start();
    }

    async stop() {
        await this.mainController.stop();
    }

    async getController() {
        return this.mainController;
    }
}

process.on('SIGINT', async () => {
    console.log('\n正在停止服务...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n正在停止服务...');
    process.exit(0);
});

module.exports = ExpressService;

