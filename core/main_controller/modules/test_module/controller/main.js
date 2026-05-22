const TestRunnerService = require('../service/test_runner_service');
const ScriptManagerService = require('../service/script_manager_service');

class MainController {
    constructor(config, logger) {
        this.logger = logger;
        this.config = config;
        this.testRunnerService = new TestRunnerService(this.config, this.logger);
        this.scriptManager = new ScriptManagerService(this.logger);
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
     * 发送重置信号
     */
    async resetTest() {
        try {
            this.logger.info('[TestController] 发送重置信号');
            this.testRunnerService.onSignal('reset');
            return { success: true, signal: 'reset' };
        } catch (error) {
            this.logger.error('[TestController] 重置失败', { error: error.message });
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

    // ─── 插件脚本管理 ───

    async listScripts(type) {
        try {
            const scripts = this.scriptManager.listScripts(type);
            this.logger.info(`[TestController] 列出 ${type} 脚本: ${scripts.length} 个`);
            console.log('============================================');
            console.log(`            ${type} 脚本列表`);
            console.log('============================================');
            scripts.forEach(s => {
                console.log(`${s.name.padEnd(20)} | ${s.meta.displayName || s.name}`);
            });
            console.log('============================================');
            return { success: true, data: scripts };
        } catch (error) {
            this.logger.error('[TestController] 列出脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async readScript(type, name) {
        try {
            const script = this.scriptManager.readScript(type, name);
            this.logger.info(`[TestController] 读取脚本: ${script.fileName}`);
            console.log('============================================');
            console.log(`            ${script.fileName}`);
            console.log('============================================');
            console.log(script.content);
            console.log('============================================');
            return { success: true, data: script };
        } catch (error) {
            this.logger.error('[TestController] 读取脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async saveScript(type, name, ...contentParts) {
        try {
            const content = contentParts.join(' ');
            const result = this.scriptManager.saveScript(type, name, content);
            this.logger.info(`[TestController] 保存脚本: ${result.fileName}`);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[TestController] 保存脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async deleteScript(type, name) {
        try {
            const result = this.scriptManager.deleteScript(type, name);
            this.logger.info(`[TestController] 删除脚本: ${name}`);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[TestController] 删除脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async createScript(type, name) {
        try {
            const result = this.scriptManager.createFromTemplate(type, name);
            this.logger.info(`[TestController] 创建脚本: ${result.fileName}`);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[TestController] 创建脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async handleScriptCommand(...args) {
        const command = args.join(' ');
        const parts = command.split(' ');
        const action = parts[0];
        const name = parts[1] || '';
        const content = parts.slice(2).join(' ') || '';
        const type = 'test_script';

        if (!action) {
            console.log('用法: script <list|read|save|delete|create> [name] [content]');
            return { success: false, error: '缺少操作参数' };
        }

        switch (action) {
            case 'list':
                return this.listScripts(type);
            case 'read':
                return this.readScript(type, name);
            case 'save':
                return this.saveScript(type, name, content);
            case 'delete':
                return this.deleteScript(type, name);
            case 'create':
                return this.createScript(type, name);
            default:
                console.log(`未知的脚本管理操作: ${action}`);
                return { success: false, error: `未知的脚本管理操作: ${action}` };
        }
    }
}

module.exports = MainController;
