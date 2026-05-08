const MonitorService = require('../service/monitor_service');

class MainController {
    constructor(config, logger) {
        this.logger = logger;
        this.config = config;
        this.monitorService = new MonitorService(this.config, this.logger);
    }

    /**
     * 启动监测进程
     * @param {string} sessionId - 测试流程sessionId
     * @param {string} session2Id - 子流程session2Id
     * @param {string} source - 监测源（文件路径，可选）
     */
    async startMonitor(sessionId, session2Id, source, target, strategyName) {
        try {
            if (!sessionId || !session2Id) {
                throw new Error('sessionId和session2Id不能为空');
            }
            this.logger.info(`[MonitorController] 启动监测进程: sessionId=${sessionId}, session2Id=${session2Id}, target=${target || 'unknown'}, strategy=${strategyName || 'default'}`);
            const result = this.monitorService.startMonitor(sessionId, session2Id, source, target, strategyName);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[MonitorController] 启动监测失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 停止监测进程
     */
    async stopMonitor() {
        try {
            this.logger.info('[MonitorController] 停止监测进程');
            const result = this.monitorService.stopMonitor();
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[MonitorController] 停止监测失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 选择监测模式
     * @param {string} mode - tail | pipe
     */
    async setMonitorMode(mode) {
        try {
            this.logger.info(`[MonitorController] 设置监测模式: ${mode}`);
            const result = this.monitorService.setMonitorMode(mode);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[MonitorController] 设置监测模式失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 选择拐点识别算法
     * @param {string} algorithm - doubleWindow | cusum | slopeChange
     */
    async setAlgorithm(algorithm) {
        try {
            this.logger.info(`[MonitorController] 设置拐点识别算法: ${algorithm}`);
            const result = this.monitorService.setAlgorithm(algorithm);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[MonitorController] 设置算法失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 输出当前测试数据
     */
    async getCurrentMetrics() {
        try {
            const metrics = this.monitorService.getCurrentMetrics();
            this.logger.info('[MonitorController] 当前测试数据:');
            this.logger.info('============================================');
            this.logger.info(`当前VUs: ${metrics.vus}`);
            this.logger.info(`当前TPS: ${metrics.tps}`);
            this.logger.info(`当前延迟: ${metrics.latency}ms`);
            this.logger.info(`数据点数: ${metrics.dataPoints}`);
            this.logger.info('============================================');
            return metrics;
        } catch (error) {
            this.logger.error('[MonitorController] 获取当前数据失败', { error: error.message });
            return { error: error.message };
        }
    }

    /**
     * 生成数据报告
     */
    async generateDataReport() {
        try {
            this.logger.info('[MonitorController] 生成数据报告');
            const result = this.monitorService.generateDataReport();
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[MonitorController] 生成数据报告失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 获取监测状态
     */
    async getMonitorStatus() {
        try {
            const status = this.monitorService.getMonitorStatus();
            // this.logger.info('[MonitorController] 监测状态:');
            // this.logger.info('============================================');
            // this.logger.info(`监测中: ${status.isMonitoring ? '是' : '否'}`);
            // this.logger.info(`SessionId: ${status.sessionId || '无'}`);
            // this.logger.info(`Session2Id: ${status.session2Id || '无'}`);
            // this.logger.info(`监测模式: ${status.mode}`);
            // this.logger.info(`算法: ${status.algorithm}`);
            // this.logger.info(`最优拐点: ${status.detectedOptimal ? '已检测' : '未检测'}`);
            // this.logger.info(`最大拐点: ${status.detectedMax ? '已检测' : '未检测'}`);
            // this.logger.info('============================================');
            return status;
        } catch (error) {
            this.logger.error('[MonitorController] 获取监测状态失败', { error: error.message });
            return { error: error.message };
        }
    }

    /**
     * 获取监测端配置
     */
    async getConfig() {
        try {
            this.logger.info('[MonitorController] 获取监测端配置');
            this.logger.info('============================================');
            this.logger.info('            监测端配置');
            this.logger.info('============================================');
            const conf = this.config;
            Object.keys(conf).forEach(key => {
                const val = conf[key];
                if (typeof val !== 'function') {
                    this.logger.info(`${key}: ${JSON.stringify(val)}`);
                }
            });
            this.logger.info('============================================');
            return conf;
        } catch (error) {
            this.logger.error('[MonitorController] 获取配置失败', { error: error.message });
            return {};
        }
    }

    async exit(exit = 'true') {
        this.logger.info('[MonitorController] 正在停止监测服务...');
        await this.stopMonitor();
        this.logger.info('[MonitorController] 监测服务已停止');
        if (exit === 'true') {
            this.logger.info('MonitorModule: 退出程序');
            process.exit(0);
        }
    }
}

module.exports = MainController;
