const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * BenchmarkReportGenerator - 标定报告生成器（v2 白色现代化主题）
 * 结合一个或多个数据报告生成性能标定报告（HTML格式）
 * 新增：配置信息面板、水桶效应瓶颈分析、现代化白色UI
 */
class BenchmarkReportGenerator {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.reportDir = path.join(process.cwd(), this.config.reportDir || 'reports');
    }

    gatherSystemInfo() {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        return {
            hostname: os.hostname(),
            platform: `${os.platform()} ${os.arch()}`,
            cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown',
            cpuCores: cpus.length,
            totalMemory: this._formatBytes(totalMem),
            nodeVersion: process.version,
            reportTime: new Date().toLocaleString('zh-CN')
        };
    }

    _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    _loadAppConfig() {
        try {
            const defaultPath = path.join(process.cwd(), 'config/default.json');
            const devPath = path.join(process.cwd(), 'config/development.json');
            let cfg = {};
            if (fs.existsSync(defaultPath)) {
                cfg = { ...cfg, ...JSON.parse(fs.readFileSync(defaultPath, 'utf-8')) };
            }
            if (fs.existsSync(devPath)) {
                cfg = { ...cfg, ...JSON.parse(fs.readFileSync(devPath, 'utf-8')) };
            }
            return cfg;
        } catch (e) {
            return {};
        }
    }

    generateBenchmarkReport(sessionId, dataReports) {
        if (!fs.existsSync(this.reportDir)) {
            fs.mkdirSync(this.reportDir, { recursive: true });
        }

        const sysInfo = this.gatherSystemInfo();
        const appConfig = this._loadAppConfig();
        const reportPath = path.join(this.reportDir, `benchmark_report_${sessionId}.html`);
        const html = this._buildHTML(sessionId, sysInfo, dataReports, appConfig);

        fs.writeFileSync(reportPath, html, 'utf-8');
        this.logger.info(`[BenchmarkReportGenerator] 标定报告已生成: ${reportPath}`);
        return reportPath;
    }

    _getMethodDesc(target) {
        const map = {
            cpu: '斐波那契递归计算（fibonacci(n=26) × 20次迭代），模拟复杂算法/逻辑运算的纯 CPU 密集型负载。',
            memory: 'Buffer.allocUnsafe 分配大块内存并保留全局引用，模拟缓存服务/大数据工作集的内存密集型负载。CPU 开销已优化至最低。',
            io: '高频 IO 操作（文件读写/网络请求），模拟高并发网络服务或磁盘密集型业务的 IO 瓶颈。',
            disk: '大文件顺序/随机读写，模拟日志系统、数据库等磁盘密集型业务的存储瓶颈。'
        };
        return map[target] || `针对 ${target} 资源设计的压力测试方法。`;
    }

    _buildHTML(sessionId, sysInfo, dataReports, appConfig) {
        const bottleneckAnalysis = this._analyzeBottlenecks(dataReports);
        const configPanel = this._buildConfigPanel(dataReports, appConfig);
        const overviewRows = this._buildOverviewRows(dataReports);
        const chartScripts = this._buildChartScripts(dataReports);
        const bucketEffectHTML = this._buildBucketEffectPanel(dataReports, bottleneckAnalysis);

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NodeBench 性能标定报告 - ${sessionId}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>
    <style>
        :root {
            --bg: #f5f7fa;
            --card: #ffffff;
            --text: #1e293b;
            --muted: #64748b;
            --accent: #2563eb;
            --success: #16a34a;
            --warn: #d97706;
            --danger: #dc2626;
            --border: #e2e8f0;
            --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background: var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 14px;
            line-height: 1.55;
        }
        .container { max-width: 1160px; margin: 0 auto; padding: 20px 16px 40px; }

        header {
            text-align: center;
            margin-bottom: 20px;
            padding: 16px 0 8px;
        }
        header h1 {
            font-size: 22px;
            font-weight: 700;
            color: var(--text);
            margin: 0 0 6px;
            letter-spacing: -0.3px;
        }
        header p {
            color: var(--muted);
            font-size: 12px;
            margin: 0;
        }
        header code {
            background: #eef2f7;
            padding: 1px 6px;
            border-radius: 4px;
            font-family: "SF Mono", Monaco, monospace;
            font-size: 11px;
        }

        .card {
            background: var(--card);
            border-radius: 10px;
            padding: 18px 20px;
            margin-bottom: 14px;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
        }
        .card h2 {
            font-size: 15px;
            font-weight: 600;
            margin: 0 0 14px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--border);
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .card h3 {
            font-size: 13px;
            font-weight: 600;
            color: var(--muted);
            margin: 0 0 8px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
        .grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
        .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }

        .info-item {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            border-bottom: 1px solid #f1f5f9;
            font-size: 13px;
        }
        .info-item:last-child { border-bottom: none; }
        .info-label { color: var(--muted); font-weight: 400; }
        .info-value { font-weight: 500; color: var(--text); text-align: right; max-width: 60%; }

        .kpi-box {
            background: #f8fafc;
            border-radius: 8px;
            padding: 14px;
            text-align: center;
            border: 1px solid var(--border);
        }
        .kpi-value {
            font-size: 22px;
            font-weight: 700;
            color: var(--accent);
            line-height: 1.2;
            margin-bottom: 4px;
        }
        .kpi-label {
            font-size: 11px;
            color: var(--muted);
            font-weight: 500;
        }
        .kpi-delta {
            font-size: 11px;
            margin-top: 4px;
            font-weight: 500;
        }
        .kpi-delta.up { color: var(--danger); }
        .kpi-delta.down { color: var(--success); }

        .tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            margin-right: 6px;
            margin-bottom: 4px;
            border: 1px solid transparent;
        }
        .tag-success { background: #f0fdf4; color: var(--success); border-color: #bbf7d0; }
        .tag-warn { background: #fffbeb; color: var(--warn); border-color: #fde68a; }
        .tag-danger { background: #fef2f2; color: var(--danger); border-color: #fecaca; }
        .tag-info { background: #eff6ff; color: var(--accent); border-color: #bfdbfe; }
        .tag-muted { background: #f8fafc; color: var(--muted); border-color: var(--border); }

        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f1f5f9; }
        th {
            color: var(--muted);
            font-weight: 600;
            background: #f8fafc;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        tr:hover td { background: #f8fafc; }
        td { color: var(--text); }

        .config-section {
            background: #f8fafc;
            border-radius: 8px;
            padding: 12px 14px;
            border: 1px solid var(--border);
        }
        .config-section h4 {
            font-size: 12px;
            font-weight: 700;
            color: var(--text);
            margin: 0 0 8px;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .config-section h4 .dot {
            width: 6px; height: 6px;
            border-radius: 50%;
            display: inline-block;
        }
        .config-row {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 12px;
            border-bottom: 1px dashed #e2e8f0;
        }
        .config-row:last-child { border-bottom: none; }
        .config-row .cfg-key { color: var(--muted); }
        .config-row .cfg-val { color: var(--text); font-weight: 500; font-family: "SF Mono", monospace; font-size: 11px; }

        .bucket-bar {
            display: flex;
            align-items: flex-end;
            gap: 10px;
            height: 90px;
            padding: 10px 0;
            margin: 8px 0;
        }
        .bucket-item {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        }
        .bucket-fill {
            width: 100%;
            border-radius: 4px 4px 0 0;
            min-height: 4px;
            transition: height 0.4s ease;
            position: relative;
        }
        .bucket-fill::after {
            content: attr(data-pct);
            position: absolute;
            top: -16px;
            left: 50%;
            transform: translateX(-50%);
            font-size: 10px;
            font-weight: 700;
            color: var(--text);
            white-space: nowrap;
        }
        .bucket-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--muted);
            text-align: center;
        }
        .bucket-waterline {
            border-top: 2px dashed var(--danger);
            margin-top: 6px;
            padding-top: 4px;
            font-size: 11px;
            color: var(--danger);
            font-weight: 600;
            text-align: center;
        }

        .chart-wrap { position: relative; height: 300px; margin-top: 10px; margin-bottom: 8px; }

        .summary-box {
            background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
            border: 1px solid #bfdbfe;
            border-radius: 8px;
            padding: 14px 16px;
            margin-bottom: 12px;
        }
        .summary-box.danger {
            background: linear-gradient(135deg, #fef2f2 0%, #fff7ed 100%);
            border-color: #fecaca;
        }
        .summary-box.warn {
            background: linear-gradient(135deg, #fffbeb 0%, #fefce8 100%);
            border-color: #fde68a;
        }
        .summary-title {
            font-size: 13px;
            font-weight: 700;
            margin-bottom: 6px;
            color: var(--text);
        }
        .summary-text {
            font-size: 13px;
            color: var(--text);
            line-height: 1.6;
        }

        .footer {
            text-align: center;
            color: var(--muted);
            font-size: 11px;
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--border);
        }

        .small { font-size: 12px; color: var(--muted); }
        .mono { font-family: "SF Mono", Monaco, monospace; }
    </style>
</head>
<body>
<div class="container">
    <header>
        <h1>NodeBench 性能标定报告</h1>
        <p>会话ID: <code>${sessionId}</code> &nbsp;|&nbsp; 生成时间: ${sysInfo.reportTime}</p>
    </header>

    <div class="card">
        <h2>🎯 性能瓶颈评估</h2>
        <div class="summary-box ${bottleneckAnalysis.worstSeverity === 'high' ? 'danger' : bottleneckAnalysis.worstSeverity === 'medium' ? 'warn' : ''}">
            <div class="summary-title">水桶效应结论</div>
            <div class="summary-text">${bottleneckAnalysis.summary}</div>
        </div>
        <div style="margin-top:10px;">
            ${bottleneckAnalysis.bottlenecks.map(b => `
                <span class="tag ${b.severity === 'high' ? 'tag-danger' : b.severity === 'medium' ? 'tag-warn' : b.severity === 'low' ? 'tag-success' : 'tag-info'}">${b.label}</span>
            `).join('')}
        </div>

        <div style="margin-top:14px; padding-top:14px; border-top:1px solid var(--border);">
            <h3>机器环境</h3>
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: 8px 24px; font-size: 12px;">
                <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">主机名</span><span style="font-weight:500;">${sysInfo.hostname}</span></div>
                <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">操作系统</span><span style="font-weight:500;">${sysInfo.platform}</span></div>
                <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">Node 版本</span><span style="font-weight:500;">${sysInfo.nodeVersion}</span></div>
                <div style="display:flex; justify-content:space-between; grid-column: span 2;"><span style="color:var(--muted)">CPU</span><span style="font-weight:500; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:280px;">${sysInfo.cpuModel}</span></div>
                <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">核心数</span><span style="font-weight:500;">${sysInfo.cpuCores}</span></div>
                <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">总内存</span><span style="font-weight:500;">${sysInfo.totalMemory}</span></div>
            </div>
        </div>
    </div>

    <div class="card">
        <h2>📊 拐点检测概览</h2>
        <div class="grid-4" style="margin-bottom:14px;">
            ${dataReports.map((r, i) => {
                const ip = r.inflectionPoints || {};
                const optimal = ip.optimal;
                const maxP = ip.max;
                return `
                <div class="kpi-box">
                    <div class="kpi-label">${(r.target || 'unknown').toUpperCase()}</div>
                    <div class="kpi-value" style="font-size:18px; margin:6px 0;">${optimal ? optimal.vus : '-'}</div>
                    <div class="kpi-label">最优拐点 VUs</div>
                    <div class="kpi-delta ${maxP && maxP.latency > 1000 ? 'up' : 'down'}" style="margin-top:4px;">
                        最大: ${maxP ? maxP.vus + ' VUs / ' + maxP.latency + 'ms' : '未检测'}
                    </div>
                </div>`;
            }).join('')}
        </div>
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th>序号</th>
                        <th>测试目标</th>
                        <th>Session2Id</th>
                        <th>最优拐点</th>
                        <th>最大拐点</th>
                        <th>算法</th>
                        <th>数据点数</th>
                    </tr>
                </thead>
                <tbody>${overviewRows}</tbody>
            </table>
        </div>
    </div>

    ${bucketEffectHTML}

    ${configPanel}

    <div class="card">
        <h2>📈 性能趋势图表</h2>
        ${chartScripts}
    </div>

    <div class="footer">
        Generated by NodeBench &nbsp;|&nbsp; Performance Benchmarking System
    </div>
</div>
</body>
</html>`;
    }

    _buildOverviewRows(dataReports) {
        return dataReports.map((report, idx) => {
            const ip = report.inflectionPoints || {};
            const optimal = ip.optimal;
            const maxP = ip.max;
            const algo = report.config?.algorithm || '-';
            return `<tr>
                <td>${idx + 1}</td>
                <td><span class="tag tag-info">${report.target || 'unknown'}</span></td>
                <td class="mono">${report.session2Id || '-'}</td>
                <td>${optimal ? `<strong>${optimal.vus}</strong> VUs / ${optimal.latency}ms` : '<span style="color:#94a3b8">未检测</span>'}</td>
                <td>${maxP ? `<strong>${maxP.vus}</strong> VUs / ${maxP.latency}ms` : '<span style="color:#94a3b8">未检测</span>'}</td>
                <td class="mono">${algo}</td>
                <td>${report.performanceData?.length || 0}</td>
            </tr>`;
        }).join('');
    }

    _buildConfigPanel(dataReports, appConfig) {
        const testCfg = appConfig.test || {};
        const serverCfg = appConfig.server || {};
        const expressCfg = serverCfg.express || {};
        const monitorCfg = appConfig.monitor || {};
        const strategiesCfg = appConfig.strategies || {};

        const usedAlgo = dataReports[0]?.config?.algorithm || 'unknown';
        const strategyKey = usedAlgo === 'doubleWindow' ? 'DoubleWindowStrategy' :
                           usedAlgo === 'cusum' ? 'CusumStrategy' :
                           usedAlgo === 'slopeChange' ? 'SlopeChangeStrategy' : null;
        const algoCfg = strategyKey ? (strategiesCfg[strategyKey] || {}) : {};

        const makeRows = (obj) => Object.entries(obj || {}).map(([k, v]) => {
            let display = v;
            if (typeof v === 'object') display = JSON.stringify(v);
            return `<div class="config-row"><span class="cfg-key">${k}</span><span class="cfg-val">${display}</span></div>`;
        }).join('');

        const makeSimpleRows = (obj, keys) => keys.map(k => {
            const v = obj?.[k];
            if (v === undefined) return '';
            return `<div class="config-row"><span class="cfg-key">${k}</span><span class="cfg-val">${typeof v === 'object' ? JSON.stringify(v) : v}</span></div>`;
        }).join('');

        return `
    <div class="card">
        <h2>⚙️ 测试环境配置</h2>
        <div class="grid-2">
            <div class="config-section">
                <h4><span class="dot" style="background:#2563eb"></span> 测试端配置</h4>
                ${makeSimpleRows(testCfg, ['initVUs', 'maxVUs', 'duration', 'thinkTime', 'testTargets', 'outputMode', 'maxLatency', 'maxErrorRate'])}
                <div class="config-row"><span class="cfg-key">metricFilters</span><span class="cfg-val" style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right;">${(testCfg.metricFilters || []).join(', ')}</span></div>
                <div class="config-row"><span class="cfg-key">spikeFilter</span><span class="cfg-val">${(testCfg.spikeFilter && testCfg.spikeFilter.enabled !== undefined) ? (testCfg.spikeFilter.enabled ? `启用 (w=${testCfg.spikeFilter?.windowSize})` : '禁用') : '启用 (w=10)'}</span></div>
            </div>
            <div class="config-section">
                <h4><span class="dot" style="background:#16a34a"></span> 监测端配置</h4>
                ${makeSimpleRows(monitorCfg, ['monitorInterval', 'monitorMode', 'algorithm', 'batchSize', 'maxHistoryPoints'])}
            </div>
            <div class="config-section">
                <h4><span class="dot" style="background:#d97706"></span> 分析策略参数（${usedAlgo}）</h4>
                ${algoCfg && Object.keys(algoCfg).length > 0 ? makeRows(algoCfg) : '<div class="config-row"><span class="cfg-key">配置</span><span class="cfg-val">未获取到详细参数</span></div>'}
            </div>
            <div class="config-section">
                <h4><span class="dot" style="background:#dc2626"></span> 被测服务端配置</h4>
                ${makeSimpleRows(expressCfg, ['serverUrl', 'mode', 'workers', 'methodsDir'])}
            </div>
        </div>
        <div style="margin-top:12px;">
            <h3>被测方法说明</h3>
            ${dataReports.map(r => `
                <div style="margin-bottom:6px; padding:8px 10px; background:#f8fafc; border-radius:6px; border:1px solid var(--border);">
                    <strong style="font-size:12px;">${(r.target || 'unknown').toUpperCase()}</strong>
                    <span style="color:var(--muted); font-size:12px; margin-left:8px;">${this._getMethodDesc(r.target)}</span>
                </div>
            `).join('')}
        </div>
    </div>`;
    }

    _buildBucketEffectPanel(dataReports, bottleneckAnalysis) {
        const bucketItems = dataReports.map(report => {
            const target = report.target || 'unknown';
            const pd = report.performanceData || [];
            const vd = report.vusLoadData || [];

            let maxRes = 0;
            const resKey = target === 'cpu' ? 'cpu' : target === 'memory' ? 'memory' : target === 'io' ? 'io' : 'disk';
            for (const p of pd) {
                const val = p.resourceUtilization?.[resKey] || 0;
                if (val > maxRes) maxRes = val;
            }

            let maxLat = 0;
            for (const p of pd) {
                if (p.latency > maxLat) maxLat = p.latency;
            }

            let maxErr = 0;
            for (const p of pd) {
                if ((p.errorRate || 0) > maxErr) maxErr = p.errorRate;
            }

            const ip = report.inflectionPoints || {};
            const hasOptimal = !!ip.optimal;
            const maxP = ip.max;

            const resScore = Math.min(maxRes, 100);
            const latScore = Math.min(maxLat / 3000, 1) * 100;
            const errScore = Math.min(maxErr, 100);
            const totalScore = Math.round(resScore * 0.45 + latScore * 0.35 + errScore * 0.20);

            return {
                target,
                maxRes,
                maxLat,
                maxErr,
                hasOptimal,
                maxVus: maxP?.vus || 0,
                maxLatencyAtMax: maxP?.latency || 0,
                score: totalScore
            };
        });

        const worst = bucketItems.reduce((a, b) => a.score > b.score ? a : b, bucketItems[0] || { score: 0 });

        const barHTML = bucketItems.map(b => {
            const height = Math.max(b.score, 4);
            const color = b.score >= 70 ? '#dc2626' : b.score >= 40 ? '#d97706' : '#16a34a';
            const isWorst = b.target === worst.target;
            return `
            <div class="bucket-item">
                <div class="bucket-fill" style="height:${height}px; background:${color}; ${isWorst ? 'box-shadow:0 0 0 2px #dc2626;' : ''}" data-pct="${b.score}%"></div>
                <div class="bucket-label">${b.target.toUpperCase()}</div>
            </div>`;
        }).join('');

        const detailHTML = bucketItems.map(b => {
            const severity = b.score >= 70 ? '严重瓶颈' : b.score >= 40 ? '中等瓶颈' : '轻度瓶颈 / 良好';
            const tagClass = b.score >= 70 ? 'tag-danger' : b.score >= 40 ? 'tag-warn' : 'tag-success';
            return `
            <tr>
                <td><span class="tag ${tagClass}">${b.target.toUpperCase()}</span></td>
                <td class="mono">${b.maxRes.toFixed(1)}%</td>
                <td class="mono">${b.maxLat.toFixed(0)}ms</td>
                <td class="mono">${b.maxErr.toFixed(2)}%</td>
                <td class="mono">${b.maxVus || '-'} VUs</td>
                <td class="mono">${b.maxLatencyAtMax ? b.maxLatencyAtMax + 'ms' : '-'}</td>
                <td><strong>${b.score}</strong>/100</td>
                <td>${severity}</td>
            </tr>`;
        }).join('');

        return `
    <div class="card">
        <h2>🪣 水桶效应分析</h2>
        <p class="small" style="margin-bottom:10px;">
            系统整体性能受限于"最短板"。以下综合比较各硬件指标的最大负载、延迟峰值与错误率，
            瓶颈得分越高表示该资源对系统整体性能的限制越严重。
        </p>
        <div class="bucket-bar">
            ${barHTML}
        </div>
        <div class="bucket-waterline">
            ▼ 系统水位线（受限于 ${worst.target.toUpperCase()}，瓶颈得分 ${worst.score}/100）
        </div>
        <div style="overflow-x:auto; margin-top:14px;">
            <table>
                <thead>
                    <tr>
                        <th>资源</th>
                        <th>峰值占用率</th>
                        <th>峰值延迟</th>
                        <th>峰值错误率</th>
                        <th>最大拐点 VUs</th>
                        <th>最大拐点延迟</th>
                        <th>瓶颈得分</th>
                        <th>评级</th>
                    </tr>
                </thead>
                <tbody>${detailHTML}</tbody>
            </table>
        </div>
    </div>`;
    }

    _buildChartScripts(dataReports) {
        const chartData = dataReports.map((report, idx) => this._extractChartData(report, idx));

        return chartData.map((cd, idx) => `
            <div style="margin-bottom:18px;">
                <div style="font-size:13px; font-weight:600; color:var(--muted); margin-bottom:6px;">${cd.title} 性能趋势变化图</div>
                <div class="chart-wrap">
                    <canvas id="trendChart_${idx}"></canvas>
                </div>
            </div>
            <script>
                (function() {
                    const ctx = document.getElementById('trendChart_${idx}').getContext('2d');
                    new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: ${JSON.stringify(cd.labels)},
                            datasets: [
                                {
                                    label: '${cd.resourceLabel}',
                                    data: ${JSON.stringify(cd.resourceData)},
                                    borderColor: '#2563eb',
                                    backgroundColor: 'rgba(37,99,235,0.06)',
                                    yAxisID: 'y2',
                                    tension: 0.3,
                                    fill: false,
                                    pointRadius: 2,
                                    borderWidth: 2
                                },
                                {
                                    label: 'RPS',
                                    data: ${JSON.stringify(cd.rpsData)},
                                    borderColor: '#d97706',
                                    backgroundColor: 'rgba(217,119,6,0.04)',
                                    yAxisID: 'y1',
                                    tension: 0.3,
                                    fill: false,
                                    pointRadius: 2,
                                    borderWidth: 2
                                },
                                {
                                    label: '响应延迟 (ms)',
                                    data: ${JSON.stringify(cd.latencyData)},
                                    borderColor: '#dc2626',
                                    backgroundColor: 'rgba(220,38,38,0.06)',
                                    yAxisID: 'y',
                                    tension: 0.3,
                                    fill: true,
                                    pointRadius: 2,
                                    borderWidth: 2
                                },
                                {
                                    label: '错误率 (%)',
                                    data: ${JSON.stringify(cd.errorRateData)},
                                    borderColor: '#7c3aed',
                                    backgroundColor: 'rgba(124,58,237,0.04)',
                                    yAxisID: 'y2',
                                    tension: 0.3,
                                    fill: false,
                                    pointRadius: 1,
                                    borderWidth: 1.5,
                                    borderDash: [4, 4]
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: { mode: 'index', intersect: false },
                            plugins: {
                                legend: {
                                    labels: {
                                        color: '#64748b',
                                        font: { size: 11 },
                                        usePointStyle: true,
                                        boxWidth: 8
                                    }
                                }
                            },
                            scales: {
                                x: {
                                    ticks: { color: '#94a3b8', font: { size: 10 } },
                                    grid: { color: '#f1f5f9' },
                                    title: { display: true, text: 'VUs (并发用户数)', color: '#94a3b8', font: { size: 11 } }
                                },
                                y: {
                                    type: 'linear',
                                    position: 'left',
                                    ticks: { color: '#94a3b8', font: { size: 10 } },
                                    grid: { color: '#f1f5f9' },
                                    title: { display: true, text: '响应延迟 (ms)', color: '#94a3b8', font: { size: 11 } }
                                },
                                y1: {
                                    type: 'linear',
                                    position: 'right',
                                    ticks: { color: '#94a3b8', font: { size: 10 } },
                                    grid: { drawOnChartArea: false },
                                    title: { display: true, text: 'RPS', color: '#94a3b8', font: { size: 11 } }
                                },
                                y2: {
                                    type: 'linear',
                                    position: 'right',
                                    ticks: { color: '#94a3b8', font: { size: 10 }, callback: function(value) { return value + '%'; } },
                                    grid: { drawOnChartArea: false },
                                    title: { display: true, text: '百分比 (%)', color: '#94a3b8', font: { size: 11 } }
                                }
                            }
                        }
                    });
                })();
            <\/script>
        `).join('');
    }

    _extractChartData(report, idx) {
        const target = report.target || 'unknown';
        let data = report.vusLoadData || [];

        if (data.length === 0 && report.performanceData && Array.isArray(report.performanceData)) {
            const vusMap = new Map();
            for (const item of report.performanceData) {
                const vus = item.vus || 0;
                if (!vusMap.has(vus)) {
                    vusMap.set(vus, []);
                }
                vusMap.get(vus).push(item);
            }
            data = Array.from(vusMap.entries()).map(([vus, items]) => {
                const pick = items[Math.floor(Math.random() * items.length)];
                return {
                    vus,
                    avgLatency: pick.latency,
                    tps: pick.rps,
                    errorRate: pick.errorRate || 0,
                    cpuUtilization: pick.resourceUtilization?.cpu || 0,
                    memoryUtilization: pick.resourceUtilization?.memory || 0,
                    ioUtilization: pick.resourceUtilization?.io || 0,
                    diskUtilization: pick.resourceUtilization?.disk || 0
                };
            }).sort((a, b) => a.vus - b.vus);
        }

        const resourceMap = {
            cpu: { key: 'cpuUtilization', label: 'CPU占用率 (%)' },
            memory: { key: 'memoryUtilization', label: 'Memory占用率 (%)' },
            io: { key: 'ioUtilization', label: 'IO占用率 (%)' },
            disk: { key: 'diskUtilization', label: 'Disk占用率 (%)' }
        };
        const resInfo = resourceMap[target] || { key: 'cpuUtilization', label: '资源占用率 (%)' };

        return {
            idx,
            title: target.toUpperCase(),
            label: target,
            labels: data.map(d => d.vus),
            latencyData: data.map(d => d.avgLatency !== undefined ? d.avgLatency : (d.latency || 0)),
            rpsData: data.map(d => d.tps !== undefined ? d.tps : (d.rps || 0)),
            errorRateData: data.map(d => d.errorRate || 0),
            resourceData: data.map(d => d[resInfo.key] || 0),
            resourceLabel: resInfo.label
        };
    }

    _analyzeBottlenecks(dataReports) {
        const bottlenecks = [];
        let worstSeverity = 'low';

        for (const report of dataReports) {
            const ip = report.inflectionPoints || {};
            const target = report.target || 'unknown';

            if (!ip.optimal && !ip.max) {
                bottlenecks.push({ target, label: `${target}: 未检测到拐点`, severity: 'low' });
                continue;
            }

            const pd = report.performanceData || [];
            const resKey = target === 'cpu' ? 'cpu' : target === 'memory' ? 'memory' : target === 'io' ? 'io' : 'disk';
            let maxRes = 0;
            for (const p of pd) {
                const val = p.resourceUtilization?.[resKey] || 0;
                if (val > maxRes) maxRes = val;
            }

            const maxLat = ip.max?.latency || 0;
            let severity = 'low';
            let label = `${target}: 性能良好`;

            if (maxRes >= 90 && maxLat > 1500) {
                severity = 'high';
                label = `${target}: 严重瓶颈 (占用${maxRes.toFixed(0)}%, 延迟${maxLat}ms)`;
            } else if (maxRes >= 80 && maxLat > 800) {
                severity = 'medium';
                label = `${target}: 中等瓶颈 (占用${maxRes.toFixed(0)}%, 延迟${maxLat}ms)`;
            } else if (maxLat > 500) {
                severity = 'medium';
                label = `${target}: 延迟偏高 (${maxLat}ms)`;
            }

            bottlenecks.push({ target, label, severity });
            if (severity === 'high') worstSeverity = 'high';
            else if (severity === 'medium' && worstSeverity !== 'high') worstSeverity = 'medium';
        }

        const worstTargets = bottlenecks.filter(b => b.severity === 'high');
        const mediumTargets = bottlenecks.filter(b => b.severity === 'medium');

        let summary = '';
        if (worstTargets.length > 0) {
            const names = worstTargets.map(b => b.target.toUpperCase()).join('、');
            summary = `根据水桶效应，系统整体性能受限于 <strong>${names}</strong>。该资源在高压下占用率超过阈值且延迟显著攀升，是当前最突出的性能瓶颈，建议优先优化。`;
        } else if (mediumTargets.length > 0) {
            const names = mediumTargets.map(b => b.target.toUpperCase()).join('、');
            summary = `<strong>${names}</strong> 存在中等程度瓶颈，系统在部分高负载场景下可能出现响应延迟，建议关注并适时优化。`;
        } else {
            summary = '系统整体性能良好，各测试目标在标定范围内均未出现显著瓶颈，水桶效应下无明显短板。';
        }

        return { summary, bottlenecks, worstSeverity };
    }

    async transcodeReport(reportPath, format) {
        this.logger.info(`[BenchmarkReportGenerator] 转码报告: ${reportPath} -> ${format}`);
        return { success: true, message: `转码功能预留: ${format}`, originalPath: reportPath };
    }
}

module.exports = BenchmarkReportGenerator;
