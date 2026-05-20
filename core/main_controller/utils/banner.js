/**
 * NodeBench ASCII艺术标题生成器
 * 为控制台提供炫酷的启动界面
 */
const chalk = require('chalk'); // 使用兼容的 chalk v4 版本
const figlet = require('figlet');

class BannerGenerator {
    constructor(logger) {
        this.logger = logger;

        this.version = '1.0.0';
        this.author = 'NodeBench Team';
    }

    /**
     * 生成NodeBench主标题
     */
    async generateMainBanner() {
        try {
            // 使用figlet生成ASCII艺术字
            const banner = figlet.textSync('NodeBench', {
                font: 'Big',
                horizontalLayout: 'default',
                verticalLayout: 'default'
            });

            // 添加装饰边框和版本信息
            const decoratedBanner = this.decorateBanner(banner);
            
            return decoratedBanner;
        } catch (error) {
            // 如果figlet不可用，使用简单的ASCII艺术
            return this.generateSimpleBanner();
        }
    }

    /**
     * 获取颜色函数 - 兼容chalk未加载的情况
     */
    getColorFunc() {
        if (!chalk) {
            // 如果chalk未加载，返回原样字符串函数
            return (str) => str;
        }
        return chalk;
    }

    /**
     * 装饰横幅 - 添加颜色和边框
     */
    decorateBanner(banner) {
        const color = this.getColorFunc();
        const lines = banner.split('\n');
        const maxLength = Math.max(...lines.map(line => line.length));
        
        // 创建顶部边框
        const topBorder = color('╔' + '═'.repeat(maxLength + 4) + '╗');
        const bottomBorder = color('╚' + '═'.repeat(maxLength + 4) + '╝');
        
        // 装饰每一行
        const decoratedLines = lines.map(line => {
            const padding = ' '.repeat(maxLength - line.length);
            return color('║ ') + line + color(padding + ' ║');
        });

        // 添加版本和作者信息
        const versionLine = color('║  ') + `Version: ${this.version}` + ' '.repeat(maxLength - 15) + color('  ║');
        const authorLine = color('║  ') + `Author: ${this.author}` + ' '.repeat(maxLength - 16) + color('  ║');
        
        return [
            '',
            topBorder,
            ...decoratedLines,
            color('╠' + '═'.repeat(maxLength + 4) + '╣'),
            versionLine,
            authorLine,
            bottomBorder,
            '',
            '🚀 高性能Node.js基准测试框架',
            '⚡ 支持多模块并发测试与实时监控',
            ''
        ].join('\n');
    }

    /**
     * 生成简单的ASCII横幅（备用方案）
     */
    generateSimpleBanner() {
        const color = this.getColorFunc();
        return [
            '',
            color.yellow('╔══════════════════════════════════════════════════════════════╗'),
            color.yellow('║                                                              ║'),
            color.yellow('║   ██╗  ██╗ ██████╗ ███████╗██████╗ ███████╗ ██████╗ ██████╗  ║'),
            color.yellow('║   ██║ ██╔╝██╔═══██╗██╔════╝██╔══██╗██╔════╝██╔═══██╗██╔══██╗ ║'),
            color.yellow('║   █████╔╝ ██║   ██║█████╗  ██████╔╝█████╗  ██║   ██║██████╔╝ ║'),
            color.yellow('║   ██╔═██╗ ██║   ██║██╔══╝  ██╔══██╗██╔══╝  ██║   ██║██╔══██╗ ║'),
            color.yellow('║   ██║  ██╗╚██████╔╝███████╗██║  ██║██║     ╚██████╔╝██║  ██║ ║'),
            color.yellow('║   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═╝  ╚═╝ ║'),
            color.yellow('║                                                              ║'),
            color.yellow('║                    B E N C H M A R K                        ║'),
            color.yellow('║                                                              ║'),
            color.yellow('╠══════════════════════════════════════════════════════════════╣'),
            color.yellow('║  Version: 1.0.0                    Author: NodeBench Team   ║'),
            color.yellow('╚══════════════════════════════════════════════════════════════╝'),
            '',
            color.cyan('🚀 高性能Node.js基准测试框架'),
            color.cyan('⚡ 支持多模块并发测试与实时监控'),
            ''
        ].join('\n');
    }

    /**
     * 生成模块启动横幅
     */
    async generateModuleBanner(moduleName, description) {
        try {
            const moduleBanner = figlet.textSync(moduleName, {
                font: 'Small',
                horizontalLayout: 'default'
            });

            const color = this.getColorFunc();
            const green = color.green || (str => str);
            const yellow = color.yellow || (str => str);
            const blue = color.blue || (str => str);

            return [
                '',
                green('╔' + '═'.repeat(50) + '╗'),
                green('║') + yellow(moduleBanner) + green('║'),
                green('╠' + '═'.repeat(50) + '╣'),
                green('║ ') + blue(description) + ' '.repeat(49 - description.length) + green('║'),
                green('╚' + '═'.repeat(50) + '╝'),
                ''
            ].join('\n');
        } catch (error) {
            return this.generateSimpleModuleBanner(moduleName, description);
        }
    }

    /**
     * 简单的模块横幅（备用方案）
     */
    generateSimpleModuleBanner(moduleName, description) {
        const color = this.getColorFunc();
        const green = color.green || (str => str);
        const yellow = color.yellow || (str => str);
        const blue = color.blue || (str => str);
        return [
            '',
            green('╔══════════════════════════════════════════════════╗'),
            green('║  ') + yellow(`[ ${moduleName} ]`) + ' '.repeat(43 - moduleName.length) + green('║'),
            green('╠══════════════════════════════════════════════════╣'),
            green('║  ') + blue(description) + ' '.repeat(45 - description.length) + green('║'),
            green('╚══════════════════════════════════════════════════╝'),
            ''
        ].join('\n');
    }

    /**
     * 显示启动信息
     */
    async showStartupInfo(config) {
        const mainBanner = await this.generateMainBanner();
        this.logger.info(mainBanner);
        
        const color = this.getColorFunc();
        // 显示系统信息
        this.logger.info(color.white('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        this.logger.info(color.white('系统信息:') + color.green(` Node.js ${process.version}`));
        this.logger.info(color.white('运行环境:') + color.green(` ${process.platform} ${process.arch}`));
        this.logger.info(color.white('进程PID:') + color.green(` ${process.pid}`));
        this.logger.info(color.white('日志目录:') + color.green(` ${config.logDir || './logs'}`));
        this.logger.info(color.white('配置环境:') + color.green(` ${config.env || 'development'}`));
        this.logger.info(color.white('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        this.logger.info('');
    }

    /**
     * 显示加载动画
     */
    async showLoadingAnimation(text = '系统初始化中', duration = 2000) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let frameIndex = 0;
        const color = this.getColorFunc();
        const cyan = color.cyan || (str => str);

        return new Promise(resolve => {
            const interval = setInterval(() => {
                process.stdout.write(cyan(`\r${frames[frameIndex]} ${text}...`));
                frameIndex = (frameIndex + 1) % frames.length;
            }, 80);
            
            setTimeout(() => {
                clearInterval(interval);
                process.stdout.write('\r' + ' '.repeat(text.length + 5) + '\r');
                resolve();
            }, duration);
        });
    }
}

module.exports = BannerGenerator;