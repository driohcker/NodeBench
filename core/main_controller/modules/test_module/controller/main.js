const K6ScriptRunnerService = require('../service/k6ScriptRunner_service');
const ResultProcessorService = require('../service/ResultProcessor_service');

class MainController {
    constructor(config, logger) {
        this.logger = logger;
        this.config = config;
        
        this.k6ScriptRunnerService = new K6ScriptRunnerService(this.config, this.logger);
        this.resultProcessorService = new ResultProcessorService(this.config, this.logger);
    }

    async reanalyze(sessionId, target = 'metrics') {
        if (!sessionId) {
            this.logger.error(`重新分析失败：必须提供会话ID。用法: result <sessionId> <target>`);
            return;
        }
        try {
            this.logger.info(`请求重新分析会话: ${sessionId}`);
            const resultPath = await this.resultProcessorService.reanalyzeTestSession(sessionId, target);
            this.logger.info(`分析完成，结果已保存到: ${resultPath}`);
        } catch (error) {
            this.logger.error(`重新分析会话 ${sessionId} 失败:`, { error: error.message });
        }
    }

    async startTest(scriptName) {
        try {
            const script = scriptName || this.config.testScript;
            this.logger.info(`启动测试，脚本: ${script}`);
            await this.k6ScriptRunnerService.runScript(script);
        } catch (error) {
            this.logger.error('启动测试失败', { error: error.message });
        }
    }

    async stopTest() {
        try {
            this.logger.info('停止测试');
            await this.k6ScriptRunnerService.stopTest();
        } catch (error) {
            this.logger.error('停止测试失败', { error: error.message });
        }
    }

    async getTestStatus() {
        try {
            const status = this.k6ScriptRunnerService.getTestStatus();
            this.logger.info('============================================');
            this.logger.info('            测试状态');
            this.logger.info('============================================');
            this.logger.info(`是否运行: ${status.isRunning ? '是' : '否'}`);
            this.logger.info(`当前脚本: ${status.currentScript || '无'}`);
            this.logger.info(`测试结果数: ${status.testResults.length}`);
            this.logger.info('============================================');
            return status;
        } catch (error) {
            this.logger.error('获取测试状态失败', { error: error.message });
        }
    }

    getConfig() {
        try {
            const conf = this.config;
            this.logger.info('============================================');
            this.logger.info('            测试端配置');
            this.logger.info('============================================');
            Object.keys(conf).forEach(key => {
                this.logger.info(`${key}: ${conf[key]}`);
            });
            this.logger.info('============================================');
            return conf;
        } catch (error) {
            this.logger.error('获取配置失败', { error: error.message });
        }
    }

    listScripts() {
        try {
            const scripts = this.k6ScriptRunnerService.getAvailableScripts();
            this.logger.info('============================================');
            this.logger.info('            可用的测试脚本');
            this.logger.info('============================================');
            if (scripts.length === 0) {
                this.logger.info('没有找到测试脚本');
            } else {
                scripts.forEach(script => {
                    this.logger.info(`- ${script.name}`);
                });
            }
            this.logger.info('============================================');
            return scripts;
        } catch (error) {
            this.logger.error('获取脚本列表失败', { error: error.message });
        }
    }

    getServerStatus(req, res) {
        const status = this.k6ScriptRunnerService.getTestStatus();
        res.json({
            success: true,
            status: status,
            timestamp: new Date().toISOString()
        });
    }

    healthCheck(req, res) {
        res.json({
            success: true,
            message: '测试端服务正常',
            timestamp: new Date().toISOString()
        });
    }
    
    async exit(exit = "true"){
        this.logger.info('正在停止测试服务...');
        await this.stopTest();
        this.logger.info('测试服务已停止，正在退出程序...');
        if(exit === "true"){
            this.logger.info('TestModule: 退出程序');
            process.exit(0);
        }
    }
}

module.exports = MainController;