const ScriptLoader = require('../util/scriptLoader');

class MethodService {
    constructor(logger) {
        this.logger = logger;
        this.scriptLoader = new ScriptLoader(logger);
    }

    async executeCpuTest(params = {}) {
        try {
            this.logger.info('执行CPU测试', params);
            const result = await this.scriptLoader.executeScript('cpu', params);
            return {
                success: true,
                method: 'cpu',
                data: result
            };
        } catch (error) {
            this.logger.error('CPU测试执行失败', { error: error.message });
            return {
                success: false,
                method: 'cpu',
                error: error.message
            };
        }
    }

    async executeMemoryTest(params = {}) {
        try {
            this.logger.info('执行内存测试', params);
            const result = await this.scriptLoader.executeScript('memory', params);
            return {
                success: true,
                method: 'memory',
                data: result
            };
        } catch (error) {
            this.logger.error('内存测试执行失败', { error: error.message });
            return {
                success: false,
                method: 'memory',
                error: error.message
            };
        }
    }

    async executeDiskTest(params = {}) {
        try {
            this.logger.info('执行磁盘测试', params);
            const result = await this.scriptLoader.executeScript('disk', params);
            return {
                success: true,
                method: 'disk',
                data: result
            };
        } catch (error) {
            this.logger.error('磁盘测试执行失败', { error: error.message });
            return {
                success: false,
                method: 'disk',
                error: error.message
            };
        }
    }

    async executeIoTest(params = {}) {
        try {
            this.logger.info('执行IO测试', params);
            const result = await this.scriptLoader.executeScript('io', params);
            return {
                success: true,
                method: 'io',
                data: result
            };
        } catch (error) {
            this.logger.error('IO测试执行失败', { error: error.message });
            return {
                success: false,
                method: 'io',
                error: error.message
            };
        }
    }

    getAvailableMethods() {
        const scripts = this.scriptLoader.getAvailableScripts();
        this.logger.info('获取可用测试方法', { methods: scripts });
        return scripts;
    }
}

module.exports = MethodService;
