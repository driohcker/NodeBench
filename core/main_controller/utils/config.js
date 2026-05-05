const config = require('config');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const logger = require('./logger');

/**
 * 配置管理中心 - 全局单例，支持实时读取与热重载
 *
 * 核心设计：
 * 1. 全局单例：整个进程只有一个 ConfigManager 实例，各模块通过 require 共享
 * 2. 实时代理：namespace() 返回 Proxy，每次属性访问都实时读取底层配置最新值
 * 3. 去硬编码：getXxxConfig() 不再枚举配置项，而是返回命名空间代理
 * 4. 事件驱动：配置变更时广播 configChanged 事件，各模块可监听响应
 * 5. 向后兼容：保留 get(key)、getXxxConfig() 等旧 API
 */
class ConfigManager extends EventEmitter {
    constructor() {
        super();
        this.config = config;
        this.logger = new logger(this.get('main.logDir', 'logs/main'));
        this.watchers = new Map();
        this._nsProxies = new Map();   // namespace Proxy 缓存
        this._nsMappings = new Map();  // 带字段映射的 Proxy 缓存
        this._reloadDebounce = null;   // 防抖定时器
        this.setupFileWatchers();
        this.initialized = true;

        this.logger.info(`配置管理器初始化完成，当前环境: ${process.env.NODE_ENV || 'development'}`);
    }

    // ─── 文件监听 ───
    setupFileWatchers() {
        const configDir = path.join(process.cwd(), 'config');
        const configFiles = ['default.json', 'development.json', 'production.json', 'test.json', 'local.json'];

        configFiles.forEach(file => {
            const filePath = path.join(configDir, file);
            if (fs.existsSync(filePath)) {
                try {
                    const watcher = fs.watch(filePath, (eventType) => {
                        if (eventType === 'change') {
                            this.handleConfigChange(file);
                        }
                    });
                    this.watchers.set(file, watcher);
                } catch (error) {
                    this.logger.warn(`无法监听配置文件 ${file}: ${error.message}`);
                }
            }
        });
    }

    // ─── 配置重载（带防抖）───
    handleConfigChange(changedFile) {
        if (this._reloadDebounce) {
            clearTimeout(this._reloadDebounce);
        }
        this._reloadDebounce = setTimeout(() => {
            this._reloadDebounce = null;
            this._doReload(changedFile);
        }, 300);
    }

    _doReload(changedFile) {
        this.logger.info(`配置文件 ${changedFile} 发生变化，重新加载配置...`);

        try {
            // 清除 config 模块缓存，强制重新加载
            const configModulePath = require.resolve('config');
            delete require.cache[configModulePath];
            // 同时清除 config 内部依赖的缓存
            Object.keys(require.cache).forEach(key => {
                if (key.includes('/config/') || key.includes('\\config\\')) {
                    delete require.cache[key];
                }
            });

            // 重新加载
            const newConfig = require('config');
            this.config = newConfig;

            // 清空 namespace 缓存，让下次访问重新创建（虽然 Proxy 内部引用的是 this.config，但清空更安全）
            this._nsProxies.clear();
            this._nsMappings.clear();

            // 收集变更详情
            const changedKeys = this._detectChanges();

            this.emit('configChanged', {
                file: changedFile,
                timestamp: new Date().toISOString(),
                changedKeys,
                config: this.getAll()
            });

            this.logger.info('配置重载成功！');
        } catch (error) {
            this.logger.error(`配置重载失败: ${error.message}`);
            this.emit('configError', {
                file: changedFile,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // 检测哪些顶层配置键发生了变化（简化版）
    _detectChanges() {
        // 这里可以扩展为深度比较，目前简单返回所有顶层键
        try {
            return Object.keys(this.getAll());
        } catch {
            return [];
        }
    }

    // ─── 核心读取 API ───

    /**
     * 读取配置值（实时读取，不缓存）
     */
    get(key, defaultValue = null) {
        try {
            return this.config.has(key) ? this.config.get(key) : defaultValue;
        } catch (error) {
            return defaultValue;
        }
    }

    getNumber(key, defaultValue = 0) {
        const value = this.get(key);
        if (value === null || value === undefined) return defaultValue;
        const num = parseInt(value, 10);
        return isNaN(num) ? defaultValue : num;
    }

    getBoolean(key, defaultValue = false) {
        const value = this.get(key);
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultValue;
    }

    /**
     * 获取配置命名空间代理 —— 核心改进
     * 返回的 Proxy 每次属性访问都会实时读取底层配置最新值
     *
     * 用法：
     *   const testConf = Config.namespace('test');
     *   testConf.duration        // → 实时读取 config.get('test.duration')
     *   testConf['maxVUs']       // → 实时读取 config.get('test.maxVUs')
     *   Object.keys(testConf)    // → 列出 test 命名空间下所有键
     */
    namespace(ns) {
        if (this._nsProxies.has(ns)) {
            return this._nsProxies.get(ns);
        }

        const self = this;
        const proxy = new Proxy({}, {
            get(target, prop) {
                if (typeof prop === 'symbol') {
                    if (prop === Symbol.toStringTag) return 'ConfigNamespace';
                    if (prop === Symbol.iterator) return undefined;
                    if (prop === Symbol.for('nodejs.util.inspect.custom')) return undefined;
                    return undefined;
                }
                if (prop === '_namespace') return ns;
                if (prop === '_raw') return self.get(ns, {});
                if (prop === 'toJSON') {
                    return () => self.get(ns, {});
                }
                const key = `${ns}.${prop}`;
                if (self.config.has(key)) {
                    const val = self.config.get(key);
                    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                        return self.namespace(key);
                    }
                    return val;
                }
                // 如果精确路径不存在，尝试从父对象获取（兼容扁平配置）
                if (self.config.has(ns)) {
                    const parentVal = self.config.get(ns);
                    if (parentVal && typeof parentVal === 'object' && prop in parentVal) {
                        const val = parentVal[prop];
                        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                            return self.namespace(key);
                        }
                        return val;
                    }
                }
                return undefined;
            },

            has(target, prop) {
                if (typeof prop !== 'string') return false;
                const key = `${ns}.${prop}`;
                if (self.config.has(key)) return true;
                if (self.config.has(ns)) {
                    const parentVal = self.config.get(ns);
                    return parentVal && typeof parentVal === 'object' && prop in parentVal;
                }
                return false;
            },

            ownKeys(target) {
                if (!self.config.has(ns)) return [];
                const val = self.config.get(ns);
                if (!val || typeof val !== 'object') return [];
                return Object.keys(val).filter(k => typeof k === 'string');
            },

            getOwnPropertyDescriptor(target, prop) {
                if (typeof prop !== 'string') return undefined;
                const key = `${ns}.${prop}`;
                const exists = self.config.has(key) || (
                    self.config.has(ns) &&
                    self.config.get(ns) &&
                    typeof self.config.get(ns) === 'object' &&
                    prop in self.config.get(ns)
                );
                if (!exists) return undefined;
                return { enumerable: true, configurable: true };
            }
        });

        this._nsProxies.set(ns, proxy);
        return proxy;
    }

    /**
     * 创建带字段映射的命名空间代理
     * 用于处理不同环境配置结构不一致的情况（向后兼容）
     *
     * @param {string} ns - 命名空间，如 'server'
     * @param {Object} mappings - 字段映射表，如 { expressLogDir: { path: 'server.express.logDir', default: 'logs/express_service' } }
     */
    _createMappedNamespace(ns, mappings = {}) {
        const cacheKey = `${ns}::mapped`;
        if (this._nsMappings.has(cacheKey)) {
            return this._nsMappings.get(cacheKey);
        }

        const self = this;
        const base = this.namespace(ns);
        const proxy = new Proxy(base, {
            get(target, prop) {
                if (typeof prop === 'symbol') return target[prop];
                if (prop === '_namespace') return ns;
                if (prop === '_mappings') return mappings;
                if (prop in mappings) {
                    const mapping = mappings[prop];
                    return self.get(mapping.path, mapping.default);
                }
                return target[prop];
            },
            has(target, prop) {
                if (typeof prop !== 'string') return false;
                if (prop in mappings) return true;
                return prop in target;
            },
            ownKeys(target) {
                const keys = new Set(Object.keys(target));
                Object.keys(mappings).forEach(k => keys.add(k));
                return Array.from(keys);
            },
            getOwnPropertyDescriptor(target, prop) {
                if (typeof prop !== 'string') return undefined;
                if (prop in mappings) return { enumerable: true, configurable: true };
                return Object.getOwnPropertyDescriptor(target, prop);
            }
        });

        this._nsMappings.set(cacheKey, proxy);
        return proxy;
    }

    // ─── 模块化配置访问（向后兼容，但返回实时代理）───

    getMainConfig() {
        return this.namespace('main');
    }

    getGlobalConfig() {
        return this.namespace('global');
    }

    getServerConfig() {
        // server 配置在不同环境文件中的结构有差异，需要映射兼容
        // default.json: 字段在 server.* 顶层
        // development.json: 字段在 server.express.* 嵌套层
        return this._createMappedNamespace('server', {
            serverUrl:     { path: 'server.express.serverUrl',     default: 'http://localhost:10000' },
            controlUrl:    { path: 'server.express.controlUrl',    default: 'http://localhost:10001' },
            mode:          { path: 'server.express.mode',          default: 'cluster' },
            workers:       { path: 'server.express.workers',       default: 16 },
            expressLogDir: { path: 'server.express.logDir',        default: 'logs/express_service' },
            methodsDir:    { path: 'server.express.methodsDir',    default: 'scripts/server_methods' }
        });
    }

    getTestConfig() {
        return this.namespace('test');
    }

    getMonitorConfig() {
        return this.namespace('monitor');
    }

    // ─── 全局配置对象（用于前端展示等场景）───

    getAll() {
        return this.config.util.toObject();
    }

    has(key) {
        return this.config.has(key);
    }

    getConfigSources() {
        return this.config.util.getConfigSources();
    }

    getEnvironment() {
        return process.env.NODE_ENV || 'development';
    }

    // ─── 配置更新 ───

    update(changes) {
        try {
            const localPath = path.join(process.cwd(), 'config', 'local.json');
            let localConfig = {};

            if (fs.existsSync(localPath)) {
                const content = fs.readFileSync(localPath, 'utf8');
                localConfig = content.trim() ? JSON.parse(content) : {};
            }

            for (const [key, value] of Object.entries(changes)) {
                const parts = key.split('.');
                let target = localConfig;
                for (let i = 0; i < parts.length - 1; i++) {
                    if (!target[parts[i]] || typeof target[parts[i]] !== 'object') {
                        target[parts[i]] = {};
                    }
                    target = target[parts[i]];
                }
                target[parts[parts.length - 1]] = value;
            }

            fs.writeFileSync(localPath, JSON.stringify(localConfig, null, 2) + '\n', 'utf8');
            this.logger.info('配置已更新并写入 local.json');

            this.handleConfigChange('local.json');

            return { success: true };
        } catch (error) {
            this.logger.error(`配置更新失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    resetToDefaults() {
        try {
            const localPath = path.join(process.cwd(), 'config', 'local.json');
            if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
                this.logger.info('已删除 local.json，配置重置为默认值');
            }
            this.handleConfigChange('local.json');
            return { success: true };
        } catch (error) {
            this.logger.error(`配置重置失败: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    reload() {
        this.logger.info('手动重载配置...');
        this.handleConfigChange('manual');
    }

    getStats() {
        const sources = this.getConfigSources();
        return {
            environment: this.getEnvironment(),
            sourcesCount: sources.length,
            sources: sources.map(s => ({
                name: s.name,
                path: s.path
            })),
            watchersCount: this.watchers.size,
            initialized: this.initialized
        };
    }

    destroy() {
        this.watchers.forEach((watcher, filename) => {
            try {
                watcher.close();
                this.logger.info(`已关闭配置文件监听器: ${filename}`);
            } catch (error) {
                this.logger.warn(`关闭监听器失败: ${error.message}`);
            }
        });
        this.watchers.clear();
        this._nsProxies.clear();
        this._nsMappings.clear();
        this.removeAllListeners();
    }
}

// ─── 全局单例 ───
const configManager = new ConfigManager();

process.on('SIGINT', () => {
    configManager.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    configManager.destroy();
    process.exit(0);
});

module.exports = configManager;
