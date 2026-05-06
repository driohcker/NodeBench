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
            return { success: false, error: '必须提供会话ID' };
        }
        try {
            this.logger.info(`请求重新分析会话: ${sessionId}`);
            const resultPath = await this.resultProcessorService.reanalyzeTestSession(sessionId, target);
            this.logger.info(`分析完成，结果已保存到: ${resultPath}`);
            return { success: true, resultPath };
        } catch (error) {
            this.logger.error(`重新分析会话 ${sessionId} 失败:`, { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async generateResult(sessionId) {
        if (!sessionId) {
            return { success: false, error: '必须提供会话ID' };
        }
        return await this.reanalyze(sessionId, 'summary');
    }

    async startTest(scriptName, overrides) {
        let sessionId = null;
        try {
            const script = scriptName || this.config.testScript;
            this.logger.info(`启动测试，脚本: ${script}`);
            const result = this.k6ScriptRunnerService.runScript(script, overrides);
            sessionId = result?.sessionId || null;
        } catch (error) {
            this.logger.error('启动测试失败', { error: error.message });
            throw error;
        }

        // 测试在后台异步执行，此处立即返回 sessionId
        // 测试完成后自动总结结果（后台执行）
        if (sessionId) {
            this.k6ScriptRunnerService.onComplete = async () => {
                try {
                    this.logger.info(`测试完成，开始自动分析会话 ${sessionId} 的结果...`);
                    const resultPath = await this.resultProcessorService.analyzeSummary(sessionId);
                    this.logger.info(`自动分析完成，结果已保存到: ${resultPath}`);
                } catch (error) {
                    this.logger.error(`自动分析会话 ${sessionId} 失败:`, { error: error.message });
                }
            };
        }

        return { sessionId };
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
            this.logger.info(`测试结果数: ${(status.testResults || []).length}`);
            this.logger.info('============================================');
            return status;
        } catch (error) {
            this.logger.error('获取测试状态失败', { error: error.message });
            return { isRunning: false, currentScript: null, testResults: [] };
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

    readScript(scriptName) {
        try {
            const scripts = this.k6ScriptRunnerService.getAvailableScripts();
            const script = scripts.find(s => s.name === scriptName);
            if (!script) {
                return { success: false, error: '脚本不存在' };
            }
            const fs = require('fs');
            const content = fs.readFileSync(script.path, 'utf8');
            const stats = fs.statSync(script.path);
            return {
                success: true,
                data: {
                    name: script.name,
                    content: content,
                    size: stats.size,
                    modified: stats.mtime,
                    lines: content.split('\n').length
                }
            };
        } catch (error) {
            this.logger.error('读取脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    saveScript(scriptName, content) {
        try {
            const path = require('path');
            const fs = require('fs');
            const scriptDir = path.join(process.cwd(), this.config.scriptDir || 'scripts/test_scripts');
            const scriptPath = path.join(scriptDir, scriptName);

            // 安全检查：确保目标路径在脚本目录内
            if (!scriptPath.startsWith(scriptDir)) {
                return { success: false, error: '无效的文件路径' };
            }

            fs.writeFileSync(scriptPath, content, 'utf8');
            this.logger.info(`脚本已保存: ${scriptName}`);
            return { success: true };
        } catch (error) {
            this.logger.error('保存脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    deleteScript(scriptName) {
        try {
            const path = require('path');
            const fs = require('fs');
            const scripts = this.k6ScriptRunnerService.getAvailableScripts();
            const script = scripts.find(s => s.name === scriptName);
            if (!script) {
                return { success: false, error: '脚本不存在' };
            }
            fs.unlinkSync(script.path);
            this.logger.info(`脚本已删除: ${scriptName}`);
            return { success: true };
        } catch (error) {
            this.logger.error('删除脚本失败', { error: error.message });
            return { success: false, error: error.message };
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