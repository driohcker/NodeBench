const fs = require('fs');
const path = require('path');
const { extractMetaFromCommonJS } = require('../../../../../utils/metaExtractor');

class ScriptLoader {
    constructor(logger) {
        this.logger = logger;
        this.scripts = {};
        this.scriptsDir = path.join(process.cwd(), 'scripts', 'server_methods');
    }

    loadScript(methodName) {
        try {
            const scriptPath = path.join(this.scriptsDir, `${methodName}_method.js`);
            
            if (!fs.existsSync(scriptPath)) {
                throw new Error(`脚本文件不存在: ${scriptPath}`);
            }

            const mtime = fs.statSync(scriptPath).mtimeMs;

            if (this.scripts[methodName]) {
                // 文件已被修改，重新加载
                if (this.scripts[methodName]._mtime !== mtime) {
                    this.logger.info(`脚本 ${methodName} 有更新，重新加载`);
                    delete require.cache[require.resolve(scriptPath)];
                    const script = require(scriptPath);
                    script._mtime = mtime;
                    this.scripts[methodName] = script;
                    this.logger.info(`成功重新加载脚本: ${methodName}`, { path: scriptPath });
                    return script;
                }
                this.logger.debug(`脚本 ${methodName} 已加载，使用缓存`);
                return this.scripts[methodName];
            }

            delete require.cache[require.resolve(scriptPath)];
            const script = require(scriptPath);
            script._mtime = mtime;
            this.scripts[methodName] = script;
            this.logger.info(`成功加载脚本: ${methodName}`, { path: scriptPath });
            
            return script;
        } catch (error) {
            this.logger.error(`加载脚本失败: ${methodName}`, { error: error.message });
            throw error;
        }
    }

    executeScript(methodName, params = {}) {
        try {
            const script = this.loadScript(methodName);
            
            if (typeof script.execute !== 'function') {
                throw new Error(`脚本 ${methodName} 缺少 execute 方法`);
            }

            this.logger.debug(`执行脚本: ${methodName}`, { params });
            const result = script.execute(params);
            
            return result;
        } catch (error) {
            this.logger.error(`执行脚本失败: ${methodName}`, { error: error.message });
            throw error;
        }
    }

    reloadScript(methodName) {
        try {
            const scriptPath = path.join(this.scriptsDir, `${methodName}_method.js`);
            
            if (this.scripts[methodName]) {
                delete require.cache[require.resolve(scriptPath)];
                delete this.scripts[methodName];
            }
            
            this.loadScript(methodName);
            this.logger.info(`重新加载脚本: ${methodName}`);
        } catch (error) {
            this.logger.error(`重新加载脚本失败: ${methodName}`, { error: error.message });
            throw error;
        }
    }

    getAvailableScripts() {
        try {
            const files = fs.readdirSync(this.scriptsDir);
            const scripts = files
                .filter(file => file.endsWith('_method.js'))
                .map(file => {
                    const methodName = file.replace('_method.js', '');
                    const filePath = path.join(this.scriptsDir, file);
                    const meta = extractMetaFromCommonJS(filePath) || {
                        name: methodName,
                        displayName: methodName,
                        description: '',
                        category: 'server_method',
                        params: []
                    };
                    return {
                        name: meta.name || methodName,
                        fileName: file,
                        filePath,
                        meta: {
                            displayName: meta.displayName || methodName,
                            description: meta.description || '',
                            category: meta.category || 'server_method',
                            params: meta.params || [],
                            ...meta
                        }
                    };
                });
            
            this.logger.debug('获取可用脚本列表', { scripts: scripts.map(s => s.name) });
            return scripts;
        } catch (error) {
            this.logger.error('获取可用脚本列表失败', { error: error.message });
            return [];
        }
    }
}

module.exports = ScriptLoader;
