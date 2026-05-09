const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * BenchmarkReportGenerator - 标定报告生成器
 * 结合一个或多个数据报告生成性能标定报告（HTML格式）
 * 支持转码为PDF、Excel等格式
 */
class BenchmarkReportGenerator {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.reportDir = path.join(process.cwd(), this.config.reportDir || 'reports');
    }

    /**
     * 收集机器基础信息
     */
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

    /**
     * 生成标定报告
     * @param {string} sessionId - 测试流程sessionId
     * @param {Array} dataReports - 数据报告数组
     */
    generateBenchmarkReport(sessionId, dataReports) {
        if (!fs.existsSync(this.reportDir)) {
            fs.mkdirSync(this.reportDir, { recursive: true });
        }

        const sysInfo = this.gatherSystemInfo();
        const reportPath = path.join(this.reportDir, `benchmark_report_${sessionId}.html`);
        const html = this._buildHTML(sessionId, sysInfo, dataReports);

        fs.writeFileSync(reportPath, html, 'utf-8');
        this.logger.info(`[BenchmarkReportGenerator] 标定报告已生成: ${reportPath}`);
        return reportPath;
    }

    _buildHTML(sessionId, sysInfo, dataReports) {
        // 性能瓶颈分析
        const bottleneckAnalysis = this._analyzeBottlenecks(dataReports);
        
        // 数据报告概览表格
        const overviewRows = dataReports.map((report, idx) => {
            const ip = report.inflectionPoints || {};
            const optimal = ip.optimal;
            const maxP = ip.max;
            return `<tr>
                <td>${idx + 1}</td>
                <td>${report.target || 'unknown'}</td>
                <td>${report.session2Id || '-'}</td>
                <td>${optimal ? optimal.vus + ' VUs / ' + optimal.latency + 'ms' : '未检测'}</td>
                <td>${maxP ? maxP.vus + ' VUs / ' + maxP.latency + 'ms' : '未检测'}</td>
                <td>${report.performanceData?.length || 0}</td>
            </tr>`;
        }).join('');

        // 各目标性能趋势图数据
        const chartData = dataReports.map((report, idx) => this._extractChartData(report, idx));

        const chartScripts = chartData.map((cd, idx) => `
            <div class="chart-wrap">
                <canvas id="trendChart_${idx}"></canvas>
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
                                    borderColor: '#3b82f6',
                                    backgroundColor: 'rgba(59,130,246,0.1)',
                                    yAxisID: 'y2',
                                    tension: 0.3,
                                    fill: false,
                                    pointRadius: 3
                                },
                                {
                                    label: 'RPS',
                                    data: ${JSON.stringify(cd.rpsData)},
                                    borderColor: '#f59e0b',
                                    backgroundColor: 'rgba(245,158,11,0.05)',
                                    yAxisID: 'y1',
                                    tension: 0.3,
                                    fill: false,
                                    pointRadius: 3
                                },
                                {
                                    label: '响应延迟 (ms)',
                                    data: ${JSON.stringify(cd.latencyData)},
                                    borderColor: '#ef4444',
                                    backgroundColor: 'rgba(239,68,68,0.1)',
                                    yAxisID: 'y',
                                    tension: 0.3,
                                    fill: true,
                                    pointRadius: 3
                                },
                                {
                                    label: '错误率 (%)',
                                    data: ${JSON.stringify(cd.errorRateData)},
                                    borderColor: '#8b5cf6',
                                    backgroundColor: 'rgba(139,92,246,0.05)',
                                    yAxisID: 'y2',
                                    tension: 0.3,
                                    fill: false,
                                    pointRadius: 2,
                                    borderDash: [5, 5]
                                }
                            ]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            interaction: { mode: 'index', intersect: false },
                            plugins: {
                                title: { display: true, text: '${cd.title} 性能趋势变化图', color: '#f1f5f9', font: { size: 16 } },
                                legend: { labels: { color: '#94a3b8' } }
                            },
                            scales: {
                                x: {
                                    ticks: { color: '#64748b' },
                                    grid: { color: '#334155' },
                                    title: { display: true, text: 'VUs (并发用户数)', color: '#94a3b8' }
                                },
                                y: {
                                    type: 'linear',
                                    position: 'left',
                                    ticks: { color: '#64748b' },
                                    grid: { color: '#334155' },
                                    title: { display: true, text: '响应延迟 (ms)', color: '#94a3b8' }
                                },
                                y1: {
                                    type: 'linear',
                                    position: 'right',
                                    ticks: { color: '#64748b' },
                                    grid: { drawOnChartArea: false },
                                    title: { display: true, text: 'RPS', color: '#94a3b8' }
                                },
                                y2: {
                                    type: 'linear',
                                    position: 'right',
                                    ticks: { color: '#64748b', callback: function(value) { return value + '%'; } },
                                    grid: { drawOnChartArea: false },
                                    title: { display: true, text: '百分比 (%)', color: '#94a3b8' }
                                }
                            }
                        }
                    });
                })();
            <\/script>
        `).join('');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NodeBench 性能标定报告 - ${sessionId}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>
    <style>
        :root { --bg: #0f172a; --card: #1e293b; --text: #f1f5f9; --muted: #94a3b8; --accent: #3b82f6; --success: #22c55e; --warn: #f59e0b; --danger: #ef4444; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }
        header { text-align: center; margin-bottom: 32px; }
        header h1 { margin: 0 0 8px; font-size: 28px; }
        header p { color: var(--muted); margin: 0; }
        .card { background: var(--card); border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.2); }
        .card h2 { margin: 0 0 16px; font-size: 20px; border-bottom: 1px solid #334155; padding-bottom: 10px; }
        .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
        .info-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #334155; }
        .info-item:last-child { border-bottom: none; }
        .info-label { color: var(--muted); }
        .highlight-box { background: linear-gradient(135deg, rgba(59,130,246,0.15), rgba(34,197,94,0.15)); border: 1px solid rgba(59,130,246,0.3); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
        .highlight-box h3 { margin: 0 0 10px; color: var(--accent); font-size: 18px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
        th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #334155; }
        th { color: var(--muted); font-weight: 500; background: rgba(255,255,255,0.03); }
        tr:hover td { background: rgba(255,255,255,0.02); }
        .chart-wrap { position: relative; height: 380px; margin-top: 16px; margin-bottom: 24px; }
        .footer { text-align: center; color: var(--muted); font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #334155; }
        .tag { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; margin-right: 8px; }
        .tag-success { background: rgba(34,197,94,0.15); color: var(--success); }
        .tag-warn { background: rgba(245,158,11,0.15); color: var(--warn); }
        .tag-danger { background: rgba(239,68,68,0.15); color: var(--danger); }
    </style>
</head>
<body>
<div class="container">
    <header>
        <h1>🚀 NodeBench 性能标定报告</h1>
        <p>会话ID: <code>${sessionId}</code> &nbsp;|&nbsp; 生成时间: ${sysInfo.reportTime}</p>
    </header>

    <div class="card">
        <h2>🖥️ 机器基础信息</h2>
        <div class="grid-2">
            <div>
                <div class="info-item"><span class="info-label">主机名</span><span>${sysInfo.hostname}</span></div>
                <div class="info-item"><span class="info-label">操作系统</span><span>${sysInfo.platform}</span></div>
                <div class="info-item"><span class="info-label">Node 版本</span><span>${sysInfo.nodeVersion}</span></div>
            </div>
            <div>
                <div class="info-item"><span class="info-label">CPU 型号</span><span>${sysInfo.cpuModel}</span></div>
                <div class="info-item"><span class="info-label">CPU 核心数</span><span>${sysInfo.cpuCores}</span></div>
                <div class="info-item"><span class="info-label">总内存</span><span>${sysInfo.totalMemory}</span></div>
            </div>
        </div>
    </div>

    <div class="card">
        <h2>📋 性能瓶颈分析</h2>
        <div class="highlight-box">
            <h3>评估结论</h3>
            <p style="margin:0;font-size:15px;">${bottleneckAnalysis.summary || '暂无评估结论'}</p>
        </div>
        <div style="margin-top:16px;">
            ${bottleneckAnalysis.bottlenecks.map(b => `
                <span class="tag ${b.severity === 'high' ? 'tag-danger' : b.severity === 'medium' ? 'tag-warn' : 'tag-success'}">${b.label}</span>
            `).join('')}
        </div>
    </div>

    <div class="card">
        <h2>📊 数据报告概览</h2>
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr><th>序号</th><th>测试目标</th><th>Session2Id</th><th>最优拐点</th><th>最大拐点</th><th>数据点数</th></tr>
                </thead>
                <tbody>${overviewRows}</tbody>
            </table>
        </div>
    </div>

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

    /**
     * 从数据报告中提取图表所需数据
     * 优先使用 vusLoadData（已按VUs聚合），如不存在则按 performanceData 随机采样
     */
    _extractChartData(report, idx) {
        const target = report.target || 'unknown';
        let data = report.vusLoadData || [];

        // 如果 vusLoadData 不存在，从 performanceData 按 VU 聚合并随机取一个
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
                // 随机取一个
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

        // 根据 target 确定展示的系统硬件性能指标
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

    /**
     * 分析性能瓶颈
     */
    _analyzeBottlenecks(dataReports) {
        const bottlenecks = [];
        let summary = '';
        
        for (const report of dataReports) {
            const ip = report.inflectionPoints || {};
            const target = report.target || 'unknown';
            
            if (!ip.optimal && !ip.max) {
                bottlenecks.push({ target, label: `${target}: 未检测到拐点`, severity: 'low' });
                continue;
            }
            
            if (ip.max && ip.max.latency > 1000) {
                bottlenecks.push({ target, label: `${target}: 高延迟瓶颈 (${ip.max.latency}ms)`, severity: 'high' });
            } else if (ip.max && ip.max.latency > 500) {
                bottlenecks.push({ target, label: `${target}: 中等延迟瓶颈 (${ip.max.latency}ms)`, severity: 'medium' });
            } else {
                bottlenecks.push({ target, label: `${target}: 性能良好`, severity: 'low' });
            }
        }
        
        if (bottlenecks.some(b => b.severity === 'high')) {
            summary = '检测到严重性能瓶颈，建议优化系统资源配置或代码性能。';
        } else if (bottlenecks.some(b => b.severity === 'medium')) {
            summary = '检测到中等性能瓶颈，系统在部分场景下可能出现响应延迟。';
        } else {
            summary = '系统整体性能良好，各测试目标均在可接受范围内运行。';
        }
        
        return { summary, bottlenecks };
    }

    /**
     * 转码报告（预留接口）
     */
    async transcodeReport(reportPath, format) {
        this.logger.info(`[BenchmarkReportGenerator] 转码报告: ${reportPath} -> ${format}`);
        // 实际转码需要引入puppeteer等依赖，此处预留接口
        // 如需PDF转码，可用 puppeteer + page.pdf()
        // 如需Excel转码，可用 xlsx 库
        return { success: true, message: `转码功能预留: ${format}`, originalPath: reportPath };
    }
}

module.exports = BenchmarkReportGenerator;
