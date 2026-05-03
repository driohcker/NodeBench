const path = require('path');
const fs = require('fs');

class StrategyService {
    constructor(config, logger) {
        this.logger = logger;
        this.config = config; // 直接使用外部传入的config
        this.currentScript = null;
    }

    /**
     * 获取可用的测试脚本列表
     */
    getAnalyzeScripts() {
        const scriptDir = path.join(process.cwd(), this.config.strategyDir || 'scripts/analyze_strategy');
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
    async startAnalyze(scriptName, sessionId) {

        if (!scriptName) {
            throw new Error('脚本名称不能为空');
        }
        if (!sessionId) {
            throw new Error('会话ID不能为空');
        }

        const scripts = this.getAnalyzeScripts();
        const script = scripts.find(s => s.name === scriptName);

        if (!script) {
            throw new Error(`分析脚本不存在: ${scriptName}`);
        }

        this.currentScript = scriptName;
        this.logger.info(`准备运行分析脚本: ${scriptName}`);

        try {
            // 动态加载测试脚本
            const Strategy = require(script.path);
            const analyzeStrategyInstance = new Strategy(this.config, this.logger);

            // 检查测试脚本是否有run方法
            if (typeof analyzeStrategyInstance.run !== 'function') {
                throw new Error('分析脚本必须导出具有run方法的类');
            }

            // 执行测试脚本的run方法，并注入依赖
            await analyzeStrategyInstance.run(sessionId);

        } catch (error) {
            this.logger.error(`运行分析脚本 ${scriptName} 失败:`, { error: error.message, stack: error.stack });
            // 确保即使脚本执行失败，也能尝试停止k6
            await this.stopTest();
            throw error;
        } finally {
            this.currentScript = null;
        }
    }
}

module.exports = StrategyService;