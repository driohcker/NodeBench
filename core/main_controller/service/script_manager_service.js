const fs = require('fs');
const path = require('path');
const metaExtractor = require('../utils/metaExtractor');

/**
 * ScriptManagerService - 插件脚本管理服务
 * 统一管理三种插件化脚本的增删查改：
 * - server_method: 被测服务脚本 (scripts/server_methods/*_method.js)
 * - test_script: 测试脚本 (scripts/test_scripts/*_test.js)
 * - strategy: 拐点分析策略 (scripts/analyze_strategy/*Strategy.js)
 *
 * 设计原则：所有文件操作在此服务中完成，GUI 层仅通过 IPC 调用，实现前后端解耦。
 */
class ScriptManagerService {
    constructor(logger) {
        this.logger = logger;
        this.typeMap = {
            server_method: {
                dir: path.join(process.cwd(), 'scripts', 'server_methods'),
                pattern: /_method\.js$/,
                suffix: '_method.js',
                metaExtractor: metaExtractor.extractMetaFromCommonJS,
                defaultName: (fileName) => fileName.replace('_method.js', '')
            },
            test_script: {
                dir: path.join(process.cwd(), 'scripts', 'test_scripts'),
                pattern: /_test\.js$/,
                suffix: '_test.js',
                metaExtractor: metaExtractor.extractMetaFromK6Script,
                defaultName: (fileName) => fileName.replace('_test.js', '')
            },
            strategy: {
                dir: path.join(process.cwd(), 'scripts', 'analyze_strategy'),
                pattern: /Strategy\.js$/,
                suffix: 'Strategy.js',
                metaExtractor: metaExtractor.extractMetaFromClass,
                defaultName: (fileName) => {
                    const base = fileName.replace('Strategy.js', '');
                    return base.charAt(0).toLowerCase() + base.slice(1);
                }
            }
        };
    }

    _getTypeConfig(type) {
        const config = this.typeMap[type];
        if (!config) {
            throw new Error(`不支持的脚本类型: ${type}`);
        }
        return config;
    }

    _resolveFilePath(type, name) {
        const config = this._getTypeConfig(type);
        const fileName = name.endsWith(config.suffix) ? name : name + config.suffix;
        const filePath = path.join(config.dir, fileName);
        // 安全检查：确保路径在目标目录内
        if (!filePath.startsWith(config.dir + path.sep)) {
            throw new Error('无效的文件路径');
        }
        return { filePath, fileName };
    }

    /**
     * 列出指定类型的所有脚本
     * @param {string} type - server_method | test_script | strategy
     * @returns {Array<{name, fileName, filePath, meta}>}
     */
    listScripts(type) {
        const config = this._getTypeConfig(type);
        const plugins = [];
        if (!fs.existsSync(config.dir)) {
            this.logger.warn(`[ScriptManager] 脚本目录不存在: ${config.dir}`);
            return plugins;
        }

        const files = fs.readdirSync(config.dir).filter(f => config.pattern.test(f) && !f.startsWith('_'));
        for (const file of files) {
            const filePath = path.join(config.dir, file);
            try {
                const meta = config.metaExtractor(filePath) || {};
                const name = meta.name || config.defaultName(file);
                plugins.push({
                    name,
                    fileName: file,
                    filePath,
                    meta: {
                        displayName: meta.displayName || name,
                        description: meta.description || '',
                        category: meta.category || type,
                        params: meta.params || [],
                        targets: meta.targets || [],
                        ...meta
                    }
                });
            } catch (e) {
                this.logger.warn(`[ScriptManager] 扫描脚本失败: ${file}, 错误: ${e.message}`);
                const name = config.defaultName(file);
                plugins.push({
                    name,
                    fileName: file,
                    filePath,
                    meta: {
                        displayName: name,
                        description: '',
                        category: type,
                        params: [],
                        targets: [],
                        error: e.message
                    }
                });
            }
        }
        this.logger.info(`[ScriptManager] 列出脚本: ${type} = ${plugins.length} 个`);
        return plugins;
    }

    /**
     * 读取指定脚本的内容
     * @param {string} type
     * @param {string} name - 脚本标识名（不含后缀）
     * @returns {object}
     */
    readScript(type, name) {
        const { filePath, fileName } = this._resolveFilePath(type, name);
        if (!fs.existsSync(filePath)) {
            throw new Error(`脚本文件不存在: ${fileName}`);
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        this.logger.info(`[ScriptManager] 读取脚本: ${fileName}`);
        return {
            name,
            fileName,
            content,
            size: stats.size,
            modified: stats.mtime.toISOString()
        };
    }

    /**
     * 保存/创建脚本
     * @param {string} type
     * @param {string} name - 脚本标识名（不含后缀）
     * @param {string} content - 脚本内容
     * @returns {object}
     */
    saveScript(type, name, content) {
        const config = this._getTypeConfig(type);
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeName) {
            throw new Error('无效的脚本名称');
        }
        if (!fs.existsSync(config.dir)) {
            fs.mkdirSync(config.dir, { recursive: true });
        }
        const fileName = safeName + config.suffix;
        const filePath = path.join(config.dir, fileName);
        if (!filePath.startsWith(config.dir + path.sep)) {
            throw new Error('无效的文件路径');
        }
        fs.writeFileSync(filePath, content, 'utf-8');
        this.logger.info(`[ScriptManager] 保存脚本: ${fileName}`);
        return { success: true, fileName, filePath };
    }

    /**
     * 删除脚本
     * @param {string} type
     * @param {string} name - 脚本标识名（不含后缀）
     * @returns {object}
     */
    deleteScript(type, name) {
        const { filePath, fileName } = this._resolveFilePath(type, name);
        if (!fs.existsSync(filePath)) {
            throw new Error(`脚本文件不存在: ${fileName}`);
        }
        fs.unlinkSync(filePath);
        this.logger.info(`[ScriptManager] 删除脚本: ${fileName}`);
        return { success: true };
    }

    /**
     * 从模板复制创建新脚本
     * @param {string} type
     * @param {string} name - 脚本标识名（不含后缀）
     * @returns {object}
     */
    createFromTemplate(type, name) {
        const config = this._getTypeConfig(type);
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeName) {
            throw new Error('无效的脚本名称');
        }

        const templateMap = {
            server_method: 'server_method.js',
            test_script: 'test_script.js',
            strategy: 'strategy.js'
        };

        const templateFileName = templateMap[type];
        const templatePath = path.join(process.cwd(), 'data', 'templates', templateFileName);
        const fileName = safeName + config.suffix;
        const filePath = path.join(config.dir, fileName);

        if (!filePath.startsWith(config.dir + path.sep)) {
            throw new Error('无效的文件路径');
        }

        if (fs.existsSync(filePath)) {
            throw new Error(`脚本已存在: ${fileName}`);
        }

        if (!fs.existsSync(templatePath)) {
            throw new Error(`模板文件不存在: ${templateFileName}`);
        }

        let content = fs.readFileSync(templatePath, 'utf-8');

        // 替换占位符
        const className = safeName.charAt(0).toUpperCase() + safeName.slice(1) + 'Strategy';
        content = content.replace(/__NAME__/g, safeName);
        content = content.replace(/__CLASS_NAME__/g, className);

        fs.writeFileSync(filePath, content, 'utf-8');
        this.logger.info(`[ScriptManager] 从模板创建脚本: ${fileName}`);
        return { success: true, fileName, filePath };
    }

    /**
     * 获取脚本类型的目录路径
     * @param {string} type
     * @returns {string}
     */
    getScriptDir(type) {
        return this._getTypeConfig(type).dir;
    }
}

module.exports = ScriptManagerService;
