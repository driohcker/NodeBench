const ScriptLoader = require('../util/scriptLoader');

class MethodService {
    constructor(logger) {
        this.logger = logger;
        this.scriptLoader = new ScriptLoader(logger);
    }

    async executeMethod(methodName, params = {}) {
        try {
            this.logger.info(`执行测试方法: ${methodName}`, params);
            const result = await this.scriptLoader.executeScript(methodName, params);
            return {
                success: true,
                method: methodName,
                data: result
            };
        } catch (error) {
            this.logger.error(`测试方法执行失败: ${methodName}`, { error: error.message });
            return {
                success: false,
                method: methodName,
                error: error.message
            };
        }
    }

    getAvailableMethods() {
        const scripts = this.scriptLoader.getAvailableScripts();
        this.logger.info('获取可用测试方法', { methods: scripts.map(s => s.name) });
        return scripts;
    }
}

module.exports = MethodService;
