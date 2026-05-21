const fs = require('fs');
const path = require('path');
const metaExtractor = require('./metaExtractor');

/**
 * 插件注册表
 * 负责扫描目录、提取元数据、缓存和管理三种类型的插件：
 * - server_method: 被测服务脚本 (*_method.js)
 * - test_script: 测试脚本 (*_test.js)
 * - strategy: 拐点分析策略 (*Strategy.js)
 */
class PluginRegistry {
    constructor(logger) {
        this.logger = logger;
        this.plugins = {
            server_method: [],
            test_script: [],
            strategy: []
        };
    }

    /**
     * 扫描指定类型的插件
     * @param {string} type - 插件类型: 'server_method' | 'test_script' | 'strategy'
     * @param {string} dir - 扫描目录
     * @param {RegExp} filePattern - 文件名匹配正则
     * @param {Function} metaExtractorFn - 元数据提取函数
     * @returns {Array<{name, fileName, filePath, meta}>}
     */
    scanPlugins(type, dir, filePattern, metaExtractorFn) {
        const plugins = [];
        if (!fs.existsSync(dir)) {
            this.logger.warn(`[PluginRegistry] 插件目录不存在: ${dir}`);
            this.plugins[type] = plugins;
            return plugins;
        }

        const files = fs.readdirSync(dir).filter(f => filePattern.test(f) && !f.startsWith('_'));
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const meta = metaExtractorFn(filePath) || {};
                const defaultName = this._deriveName(file, type);
                const name = meta.name || defaultName;

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
                this.logger.warn(`[PluginRegistry] 扫描插件失败: ${file}, 错误: ${e.message}`);
                // 即使提取失败，也加入列表（fallback 到文件名）
                const defaultName = this._deriveName(file, type);
                plugins.push({
                    name: defaultName,
                    fileName: file,
                    filePath,
                    meta: {
                        displayName: defaultName,
                        description: '',
                        category: type,
                        params: [],
                        targets: [],
                        error: e.message
                    }
                });
            }
        }

        this.plugins[type] = plugins;
        this.logger.info(`[PluginRegistry] 扫描完成: ${type} = ${plugins.length} 个插件`);
        return plugins;
    }

    /**
     * 获取指定类型的所有插件
     * @param {string} type
     * @returns {Array}
     */
    getPlugins(type) {
        return this.plugins[type] || [];
    }

    /**
     * 获取指定类型的单个插件
     * @param {string} type
     * @param {string} name
     * @returns {object|null}
     */
    getPlugin(type, name) {
        const list = this.plugins[type] || [];
        return list.find(p => p.name === name) || null;
    }

    /**
     * 重新扫描指定类型插件
     * @param {string} type
     * @param {string} dir
     * @param {RegExp} filePattern
     * @param {Function} metaExtractorFn
     */
    refresh(type, dir, filePattern, metaExtractorFn) {
        return this.scanPlugins(type, dir, filePattern, metaExtractorFn);
    }

    _deriveName(fileName, type) {
        if (type === 'server_method') {
            return fileName.replace('_method.js', '');
        }
        if (type === 'test_script') {
            return fileName.replace('_test.js', '');
        }
        if (type === 'strategy') {
            const base = fileName.replace('Strategy.js', '');
            return base.charAt(0).toLowerCase() + base.slice(1);
        }
        return fileName.replace('.js', '');
    }
}

module.exports = PluginRegistry;
