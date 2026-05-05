const path = require('path');
const fs = require('fs');
const K6Driver = require('../helper/k6Driver');

class K6ScriptRunnerService {
    constructor(config, logger) {
        this.logger = logger;
        this.config = config; // 直接使用外部传入的config
        this.k6Driver = new K6Driver(this.logger); // K6Driver不再需要config
        this.currentScript = null;
    }

    /**
     * 获取可用的测试脚本列表
     */
    getAvailableScripts() {
        const scriptDir = path.join(process.cwd(), this.config.scriptDir || 'scripts/test_scripts');
        if (!fs.existsSync(scriptDir)) {
            this.logger.warn(`测试脚本目录不存在: ${scriptDir}`);
            return [];
        }

        const files = fs.readdirSync(scriptDir);
        return files.filter(file => file.endsWith('.js')).map(file => ({
            name: file,
            path: path.join(scriptDir, file)
        }));
    }

    /**
     * 运行指定的测试脚本
     * @param {string} scriptName - 测试脚本名称
     */
    async runScript(scriptName) {
        const scripts = this.getAvailableScripts();
        const script = scripts.find(s => s.name === scriptName);

        if (!script) {
            throw new Error(`测试脚本不存在: ${scriptName}`);
        }

        if (this.k6Driver.isK6Running()) {
            throw new Error('测试正在运行中，请先停止当前测试');
        }

        this.currentScript = scriptName;
        this.logger.info(`准备运行测试脚本: ${scriptName}`);

        let testScriptInstance = null;
        try {
            // 动态加载测试脚本
            const TestScript = require(script.path);
            testScriptInstance = new TestScript(this.k6Driver, this.config, this.logger);

            // 检查测试脚本是否有run方法
            if (typeof testScriptInstance.run !== 'function') {
                throw new Error('测试脚本必须导出具有run方法的类');
            }

            // 执行测试脚本的run方法，并注入依赖
            await testScriptInstance.run();

            this.logger.info(`测试脚本 ${scriptName} 执行完成`);

        } catch (error) {
            this.logger.error(`运行测试脚本 ${scriptName} 失败:`, { error: error.message, stack: error.stack });
            // 确保即使脚本执行失败，也能尝试停止k6
            await this.stopTest();
            throw error;
        } finally {
            this.currentScript = null;
        }

        return { sessionId: testScriptInstance ? testScriptInstance.testSessionId : null };
    }

    /**
     * 停止当前测试
     */
    async stopTest() {
        if (!this.k6Driver.isK6Running()) {
            this.logger.info('没有正在运行的测试');
            return;
        }
        await this.k6Driver.stop();
        this.logger.info('测试已停止');
    }

    /**
     * 获取测试状态
     */
    getTestStatus() {
        return {
            isRunning: this.k6Driver.isK6Running(),
            currentScript: this.currentScript,
        };
    }
}

module.exports = K6ScriptRunnerService;