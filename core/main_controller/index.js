require('./utils/fixEncoding');
const MainController = require('./controller/main');
const CommandConsole = require('./command/command_console');
const Logger = require('./utils/logger');
const Config = require('./utils/config');
const BannerGenerator = require('./utils/banner');

class MainModule {
    constructor() {
        this.config = Config;
        this.logger = new Logger(this.config.getMainConfig().logDir);
        this.banner = new BannerGenerator(this.logger);

        this.mainController = null;
        this.commandConsole = null;

        this.initialized = false;
    }

    async initialize() {
        try {
            this.logger.info('正在初始化主控模块...');

            this.mainController = new MainController(this.config, this.logger);
            this.commandConsole = new CommandConsole(this.mainController);

            this.initialized = true;

            this.logger.info('主控模块初始化成功！');
        } catch (error) {
            this.logger.error(`初始化失败: ${error.message}`);
            process.exit(1);
        }
        return true;
    }
    
    async start() {
        // 显示主标题和系统信息
        await this.banner.showStartupInfo(this.config);

        // 显示模块启动横幅
        await this.banner.generateModuleBanner('ServiceModule', '被测服务管理模块');

        if (!this.initialized) {
            await this.initialize();
        }
        await this.commandConsole.start();
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

const mainModule = new MainModule();
mainModule.start();