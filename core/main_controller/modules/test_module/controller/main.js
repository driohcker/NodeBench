const TestRunnerService = require('../service/test_runner_service');

class MainController {
    constructor(config, logger) {
        this.logger = logger;
        this.config = config;
        this.testRunnerService = new TestRunnerService(this.config, this.logger);
    }

    /**
     * 启动测试流程
     * @param {string} overridesJson - JSON格式的临时覆盖配置（可选）
     */
    async startTest(overridesJson) {
        try {
            let overrides = {};
            if (overridesJson) {
                try {
                    overrides = JSON.parse(overridesJson);
                } catch (e) {
                    this.logger.warn(`[TestController] 覆盖配置解析失败，使用默认配置: ${e.message}`);
                }
            }
            this.logger.info('[TestController] 启动测试流程');
            const result = await this.testRunnerService.startTest(overrides);
            this.logger.info(`[TestController] 测试流程已启动，sessionId=${result.sessionId}`);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[TestController] 启动测试失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 停止测试流程
     */
    async stopTest() {
        try {
            this.logger.info('[TestController] 停止测试流程');
            await this.testRunnerService.stopTest();
            this.logger.info('[TestController] 测试流程已停止');
            return { success: true };
        } catch (error) {
            this.logger.error('[TestController] 停止测试失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取测试状态
     */
    async getTestStatus() {
        try {
            const status = this.testRunnerService.getTestStatus();
            // this.logger.info('[TestController] 获取测试状态');
            // this.logger.info('============================================');
            // this.logger.info('            测试状态');
            // this.logger.info('============================================');
            // this.logger.info(`运行中: ${status.isRunning ? '是' : '否'}`);
            // this.logger.info(`SessionId: ${status.sessionId || '无'}`);
            // this.logger.info(`当前目标: ${status.currentTarget || '无'}`);
            // this.logger.info(`当前子流程: ${status.currentSession2Id || '无'}`);
            // this.logger.info(`测试目标序列: ${(status.targets || []).join(', ')}`);
            // this.logger.info(`输出模式: ${status.outputMode}`);
            // this.logger.info('============================================');
            return status;
        } catch (error) {
            this.logger.error('[TestController] 获取测试状态失败', { error: error.message });
            return { isRunning: false, error: error.message };
        }
    }

    /**
     * 设置输出模式
     * @param {string} mode - file | pipe | rest
     */
    async setOutputMode(mode) {
        try {
            this.logger.info(`[TestController] 设置输出模式: ${mode}`);
            this.testRunnerService.setOutputMode(mode);
            return { success: true, mode };
        } catch (error) {
            this.logger.error('[TestController] 设置输出模式失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 接收主控端信号
     * @param {string} signal - stop | reset
     */
    async onSignal(signal) {
        try {
            this.logger.info(`[TestController] 接收信号: ${signal}`);
            this.testRunnerService.onSignal(signal);
            return { success: true, signal };
        } catch (error) {
            this.logger.error('[TestController] 处理信号失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取测试端配置
     */
    async getConfig() {
        try {
            this.logger.info('[TestController] 获取测试端配置');
            this.logger.info('============================================');
            this.logger.info('            测试端配置');
            this.logger.info('============================================');
            const conf = this.config;
            Object.keys(conf).forEach(key => {
                const val = conf[key];
                if (typeof val !== 'function') {
                    this.logger.info(`${key}: ${JSON.stringify(val)}`);
                }
            });
            this.logger.info('============================================');
            return conf;
        } catch (error) {
            this.logger.error('[TestController] 获取配置失败', { error: error.message });
            return {};
        }
    }

    async exit(exit = 'true') {
        this.logger.info('[TestController] 正在停止测试服务...');
        await this.stopTest();
        this.logger.info('[TestController] 测试服务已停止');
        if (exit === 'true') {
            this.logger.info('TestModule: 退出程序');
            process.exit(0);
        }
    }
}

module.exports = MainController;
