const MainController = require('./controller/main');
const Command = require('./command/command');
const Logger = require('./utils/logger');
const Config = require('./utils/config');
const BannerGenerator = require('./utils/banner');

class MainModule {
    constructor() {
        this.config = Config;
        this.logger = new Logger(this.config.getMainConfig().logDir);
        this.banner = new BannerGenerator(this.logger);

        this.mainController = null;
        this.command = null;

        this.initialized = false;

        this.start();
    }

    async initialize() {
        try {
            this.logger.info('正在初始化主控模块...');

            this.mainController = new MainController(this.config, this.logger);
            this.command = new Command(this.mainController);

            this.initialized = true;

            this.logger.info('主控模块初始化成功！');
        } catch (error) {
            this.logger.error(`初始化失败: ${error.message}`);
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
    }
    
    async getCommand(){
        return this.command;
    }
}
