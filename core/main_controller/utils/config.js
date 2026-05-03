const config = require('config');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const logger = require('./logger');

/**
 * 超级配置管理器 - 支持热重载、事件通知、类型验证
 * 基于config库，提供向后兼容的API
 */
class ConfigManager extends EventEmitter {
    constructor() {
        super();
        this.config = config;
        this.logger = new logger(this.getMainConfig().logDir);
        this.watchers = new Map();
        this.setupFileWatchers();
        this.initialized = true;
        
        this.logger.info(`配置管理器初始化完成，当前环境: ${process.env.NODE_ENV || 'development'}`);
    }

    /**
     * 设置配置文件监听器
     */
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

    /**
     * 处理配置变更
     */
    handleConfigChange(changedFile) {
        this.logger.info(`配置文件 ${changedFile} 发生变化，重新加载配置...`);
        
        try {
            // 清除config模块缓存
            delete require.cache[require.resolve('config')];
            
            // 重新加载配置
            const newConfig = require('config');
            this.config = newConfig;
            
            // 发出配置变更事件
            this.emit('configChanged', {
                file: changedFile,
                timestamp: new Date().toISOString(),
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

    /**
     * 获取配置值（向后兼容）
     */
    get(key, defaultValue = null) {
        try {
            return this.config.has(key) ? this.config.get(key) : defaultValue;
        } catch (error) {
            this.logger.warn(`获取配置 ${key} 失败: ${error.message}`);
            return defaultValue;
        }
    }

    /**
     * 获取数字类型配置（向后兼容）
     */
    getNumber(key, defaultValue = 0) {
        const value = this.config.get(key);
        if (value === null || value === undefined) return defaultValue;
        const num = parseInt(value, 10);
        return isNaN(num) ? defaultValue : num;
    }

    /**
     * 获取布尔类型配置（向后兼容）
     */
    getBoolean(key, defaultValue = false) {
        const value = this.config.get(key);
        if (value === 'true') return true;
        if (value === 'false') return false;
        if (typeof value === 'boolean') return value;
        return defaultValue;
    }

        /**
     * 获取主控配置（向后兼容）
     */
    getMainConfig() {
        return {
            url: this.config.get('main.url', 'http://localhost:3000'),
            logDir: this.config.get('main.logDir', 'logs/main')
        };
    }

    /**
     * 获取全局配置（向后兼容）
     */
    getGlobalConfig() {
        return {
            k6Dir: this.config.get('global.k6Dir', 'bin/k6'),
            nodeDir: this.config.get('global.nodeDir', 'bin/node')
        };
    }

    /**
     * 获取服务器配置（向后兼容）
     */
    getServerConfig() {
        return {
            logDir: this.config.get('server.logDir', 'logs/server'),
            serverUrl: this.config.get('server.express.serverUrl', 'http://localhost:10000'),
            mode: this.config.get('server.express.mode', 'cluster'),
            workers: this.config.get('server.express.workers', 16),
            expressLogDir: this.config.get('server.express.logDir', 'logs/express_service'),
            methodsDir: this.config.get('server.express.methodsDir', 'scripts/server_methods')
        };
    }

    /**
     * 获取测试配置（向后兼容）
     */
    getTestConfig() {
        return {
            initVUs: this.config.get('test.initVUs', 100),
            maxVUs: this.config.get('test.maxVUs', 500),
            duration: this.config.get('test.duration', '6s'),
            cooldownPerStep: this.config.get('test.cooldownPerStep', '5s'),
            minErrorRate: this.config.get('test.minErrorRate', 0.05),
            maxResponseTime: this.config.get('test.maxResponseTime', 2000),
            iterations: this.config.get('test.iterations', 30),
            logDir: this.config.get('test.logDir', 'logs/test'),
            scriptDir: this.config.get('test.scriptDir', 'scripts/test_scripts'),
            testScript: this.config.get('test.testScript', 'stepped_load_test.js')
        };
    }

    /**
     * 获取监控配置（向后兼容）
     */
    getMonitorConfig() {
        return {
            logDir: this.config.get('monitor.logDir', 'logs/monitor'),
            strategyDir: this.config.get('monitor.strategyDir', 'scripts/monitor_strategy'),
            dataDir: this.config.get('monitor.dataDir', 'data'),
            reportDir: this.config.get('monitor.reportDir', 'reports'),
            monitorInterval: this.config.get('monitor.monitorInterval', 1000),
            dataRetention: this.config.get('monitor.dataRetention', 86400000),
            analysisStrategy: this.config.get('monitor.analysisStrategy', 'default_strategy')
        };
    }

    /**
     * 获取完整配置对象
     */
    getAll() {
        return this.config.util.toObject();
    }

    /**
     * 检查配置是否存在
     */
    has(key) {
        return this.config.has(key);
    }

    /**
     * 获取配置源信息
     */
    getConfigSources() {
        return this.config.util.getConfigSources();
    }

    /**
     * 获取当前环境
     */
    getEnvironment() {
        return process.env.NODE_ENV || 'development';
    }

    /**
     * 手动重载配置
     */
    reload() {
        this.logger.info('手动重载配置...');
        this.handleConfigChange('manual');
    }

    /**
     * 获取配置统计信息
     */
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

    /**
     * 清理资源
     */
    destroy() {
        // 关闭所有文件监听器
        this.watchers.forEach((watcher, filename) => {
            try {
                watcher.close();
                this.logger.info(`已关闭配置文件监听器: ${filename}`);
            } catch (error) {
                this.logger.warn(`关闭监听器失败: ${error.message}`);
            }
        });
        this.watchers.clear();
        this.removeAllListeners();
    }
}

// 创建全局实例
const configManager = new ConfigManager();

// 优雅退出处理
process.on('SIGINT', () => {
    configManager.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    configManager.destroy();
    process.exit(0);
});

module.exports = configManager;