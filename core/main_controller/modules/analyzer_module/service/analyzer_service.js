const fs = require('fs');
const path = require('path');
const BenchmarkReportGenerator = require('../helper/BenchmarkReportGenerator');

/**
 * AnalyzerService - 分析服务
 * 提供数据报告分析、标定报告生成、报告转码等功能
 * 通过插件化分析策略执行事后数据分析
 */
class AnalyzerService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.benchmarkReportGenerator = new BenchmarkReportGenerator(config, logger);
        this.currentStrategy = null;
        this._loadDefaultStrategy();
    }

    /**
     * 加载默认策略
     */
    _loadDefaultStrategy() {
        const defaultStrategyName = this.config.analysisStrategy || 'DoubleWindowStrategy.js';
        try {
            this.selectStrategy(defaultStrategyName);
        } catch (e) {
            this.logger.warn(`[AnalyzerService] 加载默认策略失败: ${e.message}`);
        }
    }

    /**
     * 选择分析策略
     * @param {string} strategyName - 策略文件名
     */
    selectStrategy(strategyName) {
        if (!strategyName) {
            throw new Error('策略名称不能为空');
        }
        const strategyDir = path.join(process.cwd(), this.config.strategyDir || 'scripts/analyze_strategy');
        const strategyPath = path.join(strategyDir, strategyName);
        if (!fs.existsSync(strategyPath)) {
            throw new Error(`分析策略不存在: ${strategyPath}`);
        }

        // 清理 require 缓存，确保策略文件更新后能热重载
        delete require.cache[require.resolve(strategyPath)];
        const StrategyClass = require(strategyPath);
        // 优先读取策略独立配置，同时合并 strategies 顶层通用字段
        const strategyKey = strategyName.replace('.js', '');
        let strategyConfig = this.config;
        try {
            const configPath = path.join(process.cwd(), 'core', 'main_controller', 'utils', 'config');
            const ConfigManager = require(configPath);
            const allConfig = ConfigManager.getAll();
            if (allConfig.strategies) {
                const { DoubleWindowStrategy, CusumStrategy, SlopeChangeStrategy, postProcess, ...commonStrategyConfig } = allConfig.strategies;
                const specificConfig = allConfig.strategies[strategyKey] || {};
                strategyConfig = { ...this.config, ...commonStrategyConfig, ...specificConfig };
            }
        } catch (e) {
            // 静默回退到 analyzer 配置
        }
        this.currentStrategy = new StrategyClass(strategyConfig, this.logger);
        this.logger.info(`[AnalyzerService] 分析策略已选择: ${strategyName} (${this.currentStrategy.constructor.name})`);
        return { success: true, strategy: strategyName };
    }

    /**
     * 分析数据报告
     * @param {string} sessionId - 测试流程sessionId
     */
    async analyzeDataReport(sessionId) {
        try {
            if (!this.currentStrategy) {
                throw new Error('未选择分析策略，请先执行 selectStrategy');
            }
            this.logger.info(`[AnalyzerService] 分析数据报告: sessionId=${sessionId}, 策略=${this.currentStrategy.constructor.name}`);

            const testDataDir = path.join(process.cwd(), this.config.dataOutputDir || 'data/test', sessionId);
            if (!fs.existsSync(testDataDir)) {
                throw new Error(`测试数据目录不存在: ${testDataDir}`);
            }

            const entries = fs.readdirSync(testDataDir, { withFileTypes: true });
            const subDirs = entries.filter(e => e.isDirectory()).map(e => e.name);

            if (subDirs.length === 0) {
                throw new Error(`未找到任何子流程数据目录`);
            }

            const results = [];
            const StrategyClass = this.currentStrategy.constructor;

            for (const subDir of subDirs) {
                const session2Id = subDir;
                const dataPointsPath = path.join(testDataDir, subDir, 'data_points.jsonl');

                if (!fs.existsSync(dataPointsPath)) {
                    this.logger.warn(`[AnalyzerService] 跳过缺失数据: ${dataPointsPath}`);
                    continue;
                }

                this.logger.info(`[AnalyzerService] 分析子流程: ${session2Id}`);

                // 创建新的策略实例（每个子流程独立分析）
                const strategyKey = this.currentStrategy.constructor.name;
                let strategyConfig = this.config;
                try {
                    const configPath = path.join(process.cwd(), 'core', 'main_controller', 'utils', 'config');
                    const ConfigManager = require(configPath);
                    const allConfig = ConfigManager.getAll();
                    if (allConfig.strategies) {
                        const { DoubleWindowStrategy, CusumStrategy, SlopeChangeStrategy, postProcess, ...commonStrategyConfig } = allConfig.strategies;
                        const specificConfig = allConfig.strategies[strategyKey] || {};
                        strategyConfig = { ...this.config, ...commonStrategyConfig, ...specificConfig };
                    }
                } catch (e) {
                    // 静默回退到 analyzer 配置
                }
                const strategy = new StrategyClass(strategyConfig, this.logger);
                strategy.init();

                // 读取 RealtimeDataAdapter 持久化的标准化数据点，直接喂给策略
                const content = fs.readFileSync(dataPointsPath, 'utf-8');
                const lines = content.split('\n').filter(l => l.trim());
                let pointCount = 0;
                for (const line of lines) {
                    try {
                        const point = JSON.parse(line);
                        if (point && typeof point.timestamp === 'number') {
                            strategy.onDataPoint(point);
                            pointCount++;
                        }
                    } catch (e) {
                        // 忽略解析错误
                    }
                }
                this.logger.info(`[AnalyzerService] 从 data_points.jsonl 读取 ${pointCount} 个数据点`);

                // 从 target.info 读取 target（测试端写入）
                let targetName = 'unknown';
                try {
                    const targetInfoPath = path.join(testDataDir, subDir, 'target.info');
                    if (fs.existsSync(targetInfoPath)) {
                        targetName = fs.readFileSync(targetInfoPath, 'utf-8').trim();
                    }
                } catch (e) {}

                // 生成数据报告
                const inflectionPoints = strategy.getInflectionPoints();
                if (!inflectionPoints.optimal && !inflectionPoints.max) {
                    this.logger.warn(`[AnalyzerService] 子流程 ${session2Id} 未检测到拐点，跳过报告生成`);
                    continue;
                }

                const report = strategy.generateReport({
                    sessionId,
                    session2Id,
                    target: targetName,
                    mode: 'post_analysis'
                });

                // 保存数据报告，按 sessionId 分组
                // 文件名包含策略名，使不同策略分析同一 session 的报告能并存
                const reportDir = path.join(process.cwd(), this.config.dataReportDir || 'data/analyzer', sessionId);
                fs.mkdirSync(reportDir, { recursive: true });
                const strategyName = strategy.constructor.name;
                const reportPath = path.join(reportDir, `data_report_${session2Id}_${targetName}_${strategyName}.json`);
                fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

                this.logger.info(`[AnalyzerService] 数据报告已生成: ${reportPath}`);
                results.push({ success: true, reportPath, report });
            }

            this.logger.info(`[AnalyzerService] 分析完成，共 ${results.length} 份子流程数据报告`);
            return {
                success: true,
                sessionId,
                reports: results
            };
        } catch (error) {
            this.logger.error(`[AnalyzerService] 分析数据报告失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 生成标定报告
     * @param {string} sessionId - 测试流程sessionId
     */
    async generateBenchmarkReport(sessionId) {
        try {
            this.logger.info(`[AnalyzerService] 生成标定报告: sessionId=${sessionId}`);

            // 收集所有相关的数据报告
            const dataReports = this._collectDataReports(sessionId);

            if (dataReports.length === 0) {
                throw new Error(`未找到sessionId=${sessionId}的数据报告，请先执行分析`);
            }

            const reportPath = this.benchmarkReportGenerator.generateBenchmarkReport(sessionId, dataReports);

            this.logger.info(`[AnalyzerService] 标定报告已生成: ${reportPath}`);
            return {
                success: true,
                sessionId,
                reportPath,
                dataReportCount: dataReports.length
            };
        } catch (error) {
            this.logger.error(`[AnalyzerService] 生成标定报告失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 收集指定sessionId的所有数据报告
     */
    _collectDataReports(sessionId) {
        const reports = [];
        const seen = new Set(); // 按 session2Id + target 去重

        // 从监测端报告目录查找（按 sessionId 分组）
        const monitorReportDir = path.join(process.cwd(), this.config.dataReportDirMonitor || 'data/monitor', sessionId);
        if (fs.existsSync(monitorReportDir)) {
            const files = fs.readdirSync(monitorReportDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const content = fs.readFileSync(path.join(monitorReportDir, file), 'utf-8');
                    const report = JSON.parse(content);
                    const key = `${report.session2Id || ''}_${report.target || ''}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        reports.push(report);
                    }
                }
            }
        }

        // 从分析端报告目录查找（按 sessionId 分组）
        const analyzerReportDir = path.join(process.cwd(), this.config.dataReportDir || 'data/analyzer', sessionId);
        if (fs.existsSync(analyzerReportDir)) {
            const files = fs.readdirSync(analyzerReportDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(analyzerReportDir, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const report = JSON.parse(content);
                    const key = `${report.session2Id || ''}_${report.target || ''}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        reports.push(report);
                    }
                }
            }
        }

        return reports;
    }

    /**
     * 转码标定报告
     * @param {string} sessionId - 测试流程sessionId
     * @param {string} format - pdf | excel
     */
    async transcodeReport(sessionId, format) {
        try {
            const reportDir = path.join(process.cwd(), this.config.reportDir || 'reports');
            const reportPath = path.join(reportDir, `benchmark_report_${sessionId}.html`);

            if (!fs.existsSync(reportPath)) {
                throw new Error(`标定报告不存在: ${reportPath}，请先生成标定报告`);
            }

            this.logger.info(`[AnalyzerService] 转码标定报告: ${reportPath} -> ${format}`);
            const result = await this.benchmarkReportGenerator.transcodeReport(reportPath, format);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error(`[AnalyzerService] 转码报告失败: ${error.message}`);
            throw error;
        }
    }

    /**
     * 获取可用策略列表
     */
    listStrategies() {
        const strategyDir = path.join(process.cwd(), this.config.strategyDir || 'scripts/analyze_strategy');
        if (!fs.existsSync(strategyDir)) {
            return [];
        }
        const files = fs.readdirSync(strategyDir)
            .filter(f => f.endsWith('.js') && !f.startsWith('_'))
            .map(f => ({ name: f, path: path.join(strategyDir, f) }));
        return files;
    }
}

module.exports = AnalyzerService;
