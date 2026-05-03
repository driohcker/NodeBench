const MainController = require('./controller/main');
const cluster = require('cluster');

require('dotenv').config();

class ExpressService {
    constructor() {
        this.mainController = new MainController();
        this.initialized = false;
    }

    async initialize() {
        try{
            if (cluster.isMaster) {
                console.log('正在初始化被测服务...');
            }
            this.initialized = true;
            if (cluster.isMaster) {
                console.log('被测服务初始化成功！');
            }
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
}

process.on('SIGINT', async () => {
    console.log('\n正在停止服务...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n正在停止服务...');
    process.exit(0);
});

const expressService = new ExpressService();
expressService.start();
