const AnalyzerService = require('../service/analyzer_service');
const fs = require('fs');
const path = require('path');

class MainController {
    constructor(config, logger) {
        this.logger = logger;
        this.config = config;
        this.analyzerService = new AnalyzerService(this.config, this.logger);
    }

    /**
     * 选择分析策略
     * @param {string} strategyName - 策略文件名
     */
    async selectStrategy(strategyName) {
        try {
            this.logger.info(`[AnalyzerController] 选择分析策略: ${strategyName}`);
            const result = this.analyzerService.selectStrategy(strategyName);
            return { success: true, ...result };
        } catch (error) {
            this.logger.error('[AnalyzerController] 选择策略失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 分析数据报告
     * @param {string} sessionId - 测试流程sessionId
     */
    async analyzeDataReport(sessionId) {
        try {
            if (!sessionId) {
                throw new Error('sessionId不能为空');
            }
            this.logger.info(`[AnalyzerController] 分析数据报告: sessionId=${sessionId}`);
            const result = await this.analyzerService.analyzeDataReport(sessionId);
            this.logger.info(`[AnalyzerController] 分析完成，生成 ${result.reports.length} 份报告`);
            return result;
        } catch (error) {
            this.logger.error('[AnalyzerController] 分析数据报告失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 生成标定报告
     * @param {string} sessionId - 测试流程sessionId
     */
    async generateBenchmarkReport(sessionId) {
        try {
            if (!sessionId) {
                throw new Error('sessionId不能为空');
            }
            this.logger.info(`[AnalyzerController] 生成标定报告: sessionId=${sessionId}`);
            const result = await this.analyzerService.generateBenchmarkReport(sessionId);
            this.logger.info(`[AnalyzerController] 标定报告已生成: ${result.reportPath}`);
            return result;
        } catch (error) {
            this.logger.error('[AnalyzerController] 生成标定报告失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 转码标定报告
     * @param {string} sessionId - 测试流程sessionId
     * @param {string} format - pdf | excel
     */
    async transcodeReport(sessionId, format) {
        try {
            if (!sessionId) {
                throw new Error('sessionId不能为空');
            }
            format = format || 'pdf';
            this.logger.info(`[AnalyzerController] 转码标定报告: sessionId=${sessionId}, format=${format}`);
            const result = await this.analyzerService.transcodeReport(sessionId, format);
            return result;
        } catch (error) {
            this.logger.error('[AnalyzerController] 转码报告失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 列出可用策略
     */
    async listStrategies() {
        try {
            const strategies = this.analyzerService.listStrategies();
            this.logger.info('[AnalyzerController] 可用分析策略:');
            this.logger.info('============================================');
            if (strategies.length === 0) {
                this.logger.info('未找到分析策略');
            } else {
                strategies.forEach(s => this.logger.info(`- ${s.name}`));
            }
            this.logger.info('============================================');
            return strategies;
        } catch (error) {
            this.logger.error('[AnalyzerController] 获取策略列表失败', { error: error.message });
            return [];
        }
    }

    /**
     * 获取分析端配置
     */
    async getConfig() {
        try {
            this.logger.info('[AnalyzerController] 获取分析端配置');
            this.logger.info('============================================');
            this.logger.info('            分析端配置');
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
            this.logger.error('[AnalyzerController] 获取配置失败', { error: error.message });
            return {};
        }
    }

    async exit(exit = 'true') {
        this.logger.info('[AnalyzerController] 正在停止分析服务...');
        this.logger.info('[AnalyzerController] 分析服务已停止');
        if (exit === 'true') {
            this.logger.info('AnalyzerModule: 退出程序');
            process.exit(0);
        }
    }

    /**
     * 列出数据报告（带拐点摘要）
     * @param {string} sessionId - 可选，只列出指定session的报告
     */
    async listReports(sessionId) {
        try {
            const filterSid = sessionId && /^\d+$/.test(sessionId) ? sessionId : null;

            const reportDirs = [
                { source: 'analyzer', dir: path.join(process.cwd(), 'data', 'analyzer') },
                { source: 'monitor', dir: path.join(process.cwd(), 'data', 'monitor') }
            ];

            const reports = [];

            for (const { source, dir } of reportDirs) {
                if (!fs.existsSync(dir)) continue;

                const sessions = fs.readdirSync(dir).filter(f => {
                    const fullPath = path.join(dir, f);
                    return fs.statSync(fullPath).isDirectory() && f.match(/^\d+$/);
                });

                for (const sid of sessions) {
                    if (filterSid && sid !== filterSid) continue;

                    const sessionDir = path.join(dir, sid);
                    const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'));

                    for (const file of files) {
                        const filePath = path.join(sessionDir, file);
                        const stats = fs.statSync(filePath);
                        const match = file.match(/data_report_\d+_([^_]+)/);
                        const target = match ? match[1] : 'unknown';

                        // 读取拐点摘要
                        let optimalVus = '-';
                        let maxVus = '-';
                        try {
                            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                            if (data.inflectionPoints?.optimal?.vus) optimalVus = data.inflectionPoints.optimal.vus;
                            if (data.inflectionPoints?.max?.vus) maxVus = data.inflectionPoints.max.vus;
                        } catch (e) {}

                        reports.push({
                            sessionId: sid,
                            target,
                            source,
                            optimalVus,
                            maxVus,
                            modified: stats.mtime.toISOString()
                        });
                    }
                }
            }

            reports.sort((a, b) => {
                if (a.sessionId !== b.sessionId) return b.sessionId.localeCompare(a.sessionId);
                return new Date(b.modified) - new Date(a.modified);
            });

            this.logger.info(`[AnalyzerController] 找到 ${reports.length} 份数据报告`);
            console.log('============================================');
            console.log('            数据报告列表');
            console.log('============================================');
            if (reports.length === 0) {
                console.log('暂无数据报告');
            } else {
                console.log(`\n${'SessionId'.padEnd(18)} ${'Target'.padEnd(10)} ${'Source'.padEnd(8)} ${'OptimalVUs'.padEnd(12)} ${'MaxVUs'}`);
                console.log('-'.repeat(65));
                reports.forEach(r => {
                    const src = r.source === 'analyzer' ? '分析' : '监测';
                    console.log(`${r.sessionId.padEnd(18)} ${r.target.padEnd(10)} ${src.padEnd(8)} ${String(r.optimalVus).padEnd(12)} ${r.maxVus}`);
                });
            }
            console.log('============================================');
            return { success: true, data: reports };
        } catch (error) {
            this.logger.error('[AnalyzerController] 列出报告失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * 查看数据报告详情
     * @param {string} sessionId - 报告sessionId
     * @param {string} target - 可选，指定target
     * @param {string} source - 可选，analyzer|monitor
     */
    async readReport(sessionId, target, source) {
        try {
            if (!sessionId || !/^\d+$/.test(sessionId)) {
                console.log('用法: report <sessionId> [target] [analyzer|monitor]');
                return { success: false, error: 'sessionId 不能为空' };
            }

            const reportDirs = [];
            if (!source || source === 'analyzer') {
                reportDirs.push({ source: 'analyzer', dir: path.join(process.cwd(), 'data', 'analyzer', sessionId) });
            }
            if (!source || source === 'monitor') {
                reportDirs.push({ source: 'monitor', dir: path.join(process.cwd(), 'data', 'monitor', sessionId) });
            }

            const found = [];
            for (const { source: src, dir } of reportDirs) {
                if (!fs.existsSync(dir)) continue;
                const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    const match = file.match(/data_report_\d+_([^_]+)/);
                    const fileTarget = match ? match[1] : 'unknown';
                    if (target && fileTarget !== target) continue;
                    found.push({ source: src, target: fileTarget, filePath });
                }
            }

            if (found.length === 0) {
                console.log(`未找到报告: sessionId=${sessionId}${target ? ', target=' + target : ''}${source ? ', source=' + source : ''}`);
                return { success: false, error: '未找到报告' };
            }

            for (const item of found) {
                const data = JSON.parse(fs.readFileSync(item.filePath, 'utf-8'));
                const srcTag = item.source === 'analyzer' ? '[分析端]' : '[监测端]';

                console.log('\n============================================');
                console.log(`            ${srcTag} 数据报告`);
                console.log('============================================');
                console.log(`SessionId : ${data.sessionId || sessionId}`);
                console.log(`Session2Id: ${data.session2Id || '-'}`);
                console.log(`Target    : ${data.target || item.target}`);
                console.log(`生成时间  : ${data.generatedAt || '-'}`);
                console.log(`模式      : ${data.mode || '-'}`);
                console.log(`算法      : ${data.config?.algorithm || '-'}`);
                console.log('--------------------------------------------');

                if (data.inflectionPoints) {
                    const opt = data.inflectionPoints.optimal;
                    const max = data.inflectionPoints.max;
                    console.log('拐点信息:');
                    if (opt) {
                        console.log(`  最优拐点: VUs=${opt.vus}, 延迟=${opt.latency}ms, RPS=${opt.rps || '-'}`);
                    }
                    if (max) {
                        console.log(`  最大拐点: VUs=${max.vus}, 延迟=${max.latency}ms, RPS=${max.rps || '-'}`);
                    }
                    if (!opt && !max) {
                        console.log('  未检测到拐点');
                    }
                }

                if (data.performanceData && data.performanceData.length > 0) {
                    console.log('--------------------------------------------');
                    console.log(`性能数据: 共 ${data.performanceData.length} 个采样点`);
                    const first = data.performanceData[0];
                    const last = data.performanceData[data.performanceData.length - 1];
                    console.log(`  起点: VUs=${first.vus}, 延迟=${first.latency}ms`);
                    console.log(`  终点: VUs=${last.vus}, 延迟=${last.latency}ms`);
                }
                console.log('============================================');
            }

            return { success: true, data: found };
        } catch (error) {
            this.logger.error('[AnalyzerController] 读取报告失败', { error: error.message });
            return { success: false, error: error.message };
        }
    }
}

module.exports = MainController;
