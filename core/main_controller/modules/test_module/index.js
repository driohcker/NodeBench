require('../../utils/fixEncoding');
const MainController = require('./controller/main');
const CommandConsole = require('./command/command_console');
const Logger = require('../../utils/logger');
const Config = require('../../utils/config');

class testModule {
    constructor() {
        this.config = Config.getTestConfig();
        this.logger = new Logger(this.config.logDir);

        this.mainController = null;
        this.commandConsole = null;
        this.initialized = false;
    }

    async initialize() {
        try {
            console.log('正在初始化测试模块...');

            this.mainController = new MainController(this.config, this.logger);
            this.commandConsole = new CommandConsole(this.mainController);

            this.initialized = true;

            console.log('测试模块初始化成功！');
        } catch (error) {
            console.error(`初始化失败: ${error.message}`);
            process.exit(1);
        }
        return true;
    }
    
    async start() {
        if (!this.initialized) {
            await this.initialize();
        }
        this.commandConsole.start();
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

const test = new testModule();
test.start();