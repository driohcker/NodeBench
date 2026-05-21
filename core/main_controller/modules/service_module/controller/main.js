const express_service = require('../service/express_service');
const ScriptManagerService = require('../service/script_manager_service');

class MainController {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;

        this.expressService = new express_service(this.config, this.logger);
        this.scriptManager = new ScriptManagerService(this.logger);
    }

    async startExpressService(){
        await this.expressService.startExpressService();
    }
    
    async stopExpressService(){
        await this.expressService.stopExpressService();
    }

    async getStatusExpressService(){
        let status = await this.expressService.getStatusExpressService();
        // this.logger.info('服务状态检查完成', status);
        return status;
    }

    async getConfig(){
        this.logger.info('获取服务配置信息');
        this.logger.info('============================================');
        this.logger.info('            被测服务配置');
        this.logger.info('============================================');
        // 将 Proxy 转为普通对象，确保跨进程传输正确
        const plainConfig = {};
        for (const key in this.config) {
            const val = this.config[key];
            plainConfig[key] = (val && typeof val === 'object' && !Array.isArray(val))
                ? JSON.parse(JSON.stringify(val))
                : val;
        }
        Object.keys(plainConfig).forEach(key => {
            this.logger.info(`${key}: ${plainConfig[key]}`);
        });
        this.logger.info('============================================');
        return plainConfig;
    }

    async updateConfig(config){
        this.config = config;
    }

    async exit(exit = "true"){
        this.logger.info('正在停止被测服务...');
        await this.stopExpressService();
        this.logger.info('被测服务已停止，正在退出程序...');
        if(exit === "true"){
            this.logger.info('ServerModule: 退出程序');
            process.exit(0);
        }
    }

    // ─── 插件脚本管理 ───

    async listScripts(type) {
        try {
            const scripts = this.scriptManager.listScripts(type);
            this.logger.info(`[ServerController] 列出 ${type} 脚本: ${scripts.length} 个`);
            console.log('============================================');
            console.log(`            ${type} 脚本列表`);
            console.log('============================================');
            scripts.forEach(s => {
                console.log(`${s.name.padEnd(20)} | ${s.meta.displayName || s.name}`);
            });
            console.log('============================================');
            return { success: true, data: scripts };
        } catch (error) {
            this.logger.error('[ServerController] 列出脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async readScript(type, name) {
        try {
            const script = this.scriptManager.readScript(type, name);
            this.logger.info(`[ServerController] 读取脚本: ${script.fileName}`);
            console.log('============================================');
            console.log(`            ${script.fileName}`);
            console.log('============================================');
            console.log(script.content);
            console.log('============================================');
            return { success: true, data: script };
        } catch (error) {
            this.logger.error('[ServerController] 读取脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async saveScript(type, name, ...contentParts) {
        try {
            const content = contentParts.join(' ');
            const result = this.scriptManager.saveScript(type, name, content);
            this.logger.info(`[ServerController] 保存脚本: ${result.fileName}`);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[ServerController] 保存脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async deleteScript(type, name) {
        try {
            const result = this.scriptManager.deleteScript(type, name);
            this.logger.info(`[ServerController] 删除脚本: ${name}`);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[ServerController] 删除脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async createScript(type, name) {
        try {
            const result = this.scriptManager.createFromTemplate(type, name);
            this.logger.info(`[ServerController] 创建脚本: ${result.fileName}`);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[ServerController] 创建脚本失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    async handleScriptCommand(...args) {
        const command = args.join(' ');
        const parts = command.split(' ');
        const action = parts[0];
        const name = parts[1] || '';
        const content = parts.slice(2).join(' ') || '';
        const type = 'server_method';

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