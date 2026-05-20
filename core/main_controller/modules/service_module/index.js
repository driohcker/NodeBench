require('../../utils/fixEncoding');
const MainController = require('./controller/main');
const CommandConsole = require('./command/command_console');
const logger = require('../../utils/logger');
const Config = require('../../utils/config');

class serviceModule {
    constructor() {
        this.config = Config.getServerConfig();
        this.logger = new logger(this.config.logDir);
        
        this.mainController = null;
        this.commandConsole = null;
        this.initialized = false;
    }

    async initialize() {
        try {
            this.logger.info('正在初始化服务模块...');

            this.mainController = new MainController(this.config, this.logger);
            this.commandConsole = new CommandConsole(this.mainController);

            this.initialized = true;

            this.logger.info('服务模块初始化成功！');
        } catch (error) {
            this.logger.error(`初始化失败: ${error.message}`);
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
    this.logger.info('\n正在停止服务...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    this.logger.info('\n正在停止服务...');
    process.exit(0);
});

const service = new serviceModule();
service.start();
