const Config = require('../../core/main_controller/utils/config');
const Logger = require('../../core/main_controller/utils/logger');
const ServModuleService = require('../../core/main_controller/service/serv_module_service');
const TestModuleService = require('../../core/main_controller/service/test_module_service');
const MonitorModule = require('../../core/main_controller/modules/monitor_module/moduleIndex');
const AnalyzerModule = require('../../core/main_controller/modules/analyzer_module/moduleIndex');
const state = require('./state');

async function initializeServices() {
    const config = Config;
    const mainLogger = new Logger(config.getMainConfig().logDir);

    state.services.config = config;
    state.services.logger = mainLogger;

    // 被测服务管理模块（使用独立的 serverLogger，避免日志写入主控目录）
    const serverLogger = new Logger(config.getServerConfig().logDir);
    state.services.serv = new ServModuleService(config.getServerConfig(), serverLogger);

    // 测试执行模块（使用独立的 testLogger，避免日志写入主控目录）
    const testLogger = new Logger(config.getTestConfig().logDir);
    state.services.test = new TestModuleService(config.getTestConfig(), testLogger);

    // 监控模块（实时监控）
    const monitorConfig = config.getMonitorConfig();
    const monitorLogger = new Logger(monitorConfig.logDir);
    state.services.monitor = new MonitorModule(monitorConfig, monitorLogger);

    // 分析模块（事后分析）
    const analyzerConfig = config.getAnalyzerConfig();
    const analyzerLogger = new Logger(analyzerConfig.logDir);
    state.services.analyzer = new AnalyzerModule(analyzerConfig, analyzerLogger);

    // 等待异步初始化完成（给各模块 initialize 一点时间）
    await new Promise(resolve => setTimeout(resolve, 300));
    mainLogger.info('Electron 主进程后端服务初始化完成');
}

module.exports = { initializeServices };
