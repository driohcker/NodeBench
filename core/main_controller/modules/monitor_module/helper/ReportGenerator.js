const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 性能标定报告生成器
 * 生成包含机器基础信息和性能分析数据的 HTML 报告
 */
class ReportGenerator {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.reportsDir = path.join(process.cwd(), 'reports');
    }

    /**
     * 收集机器基础信息
     */
    gatherSystemInfo() {
        const cpus = os.cpus();
        const totalMem = os.totalmem();
        const platform = os.platform();
        const arch = os.arch();
        const hostname = os.hostname();
        const nodeVersion = process.version;

        return {
            hostname,
            platform: `${platform} ${arch}`,
            cpuModel: cpus.length > 0 ? cpus[0].model : 'Unknown',
            cpuCores: cpus.length,
            totalMemory: this.formatBytes(totalMem),
            nodeVersion,
            reportTime: new Date().toLocaleString('zh-CN')
        };
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 生成 HTML 报告
     * @param {string} sessionId - 测试会话ID
     * @param {object} analyzeResult - InflectionPointStrategy 的分析结果
     * @returns {string} 生成的报告文件路径
     */
    generate(sessionId, analyzeResult) {
        if (!fs.existsSync(this.reportsDir)) {
            fs.mkdirSync(this.reportsDir, { recursive: true });
        }

        const sysInfo = this.gatherSystemInfo();
        const reportPath = path.join(this.reportsDir, `report_session_${sessionId}_${Date.now()}.html`);
        const html = this.buildHTML(sessionId, sysInfo, analyzeResult);

        fs.writeFileSync(reportPath, html, 'utf-8');
        this.logger.info(`性能标定报告已生成: ${reportPath}`);

        return reportPath;
    }

    buildHTML(sessionId, sysInfo, result) {
        const trend = result.performance_trend || [];
        const hasErrorRate = trend.some(t => t.error_rate !== null && t.error_rate !== undefined);
        const hasMinMax = trend.some(t => t.min_latency_ms !== null && t.min_latency_ms !== undefined);
        const hasTotalReq = trend.some(t => t.total_requests !== null && t.total_requests !== undefined);

        // 生成表格行
        const tableRows = trend.map(t => {
            let row = `<td>${t.stage}</td><td>${t.vus}</td><td>${t.avg_latency_ms}ms</td><td>${t.p95_latency_ms}ms</td>`;
            if (hasMinMax) {
                row += `<td>${t.min_latency_ms !== null ? t.min_latency_ms + 'ms' : '-'}</td>`;
                row += `<td>${t.max_latency_ms !== null ? t.max_latency_ms + 'ms' : '-'}</td>`;
                row += `<td>${t.median_latency_ms !== null ? t.median_latency_ms + 'ms' : '-'}</td>`;
            }
            row += `<td>${t.rps}</td>`;
            if (hasTotalReq) row += `<td>${t.total_requests !== null ? t.total_requests : '-'}</td>`;
            if (hasErrorRate) row += `<td>${t.error_rate !== null ? t.error_rate + '%' : '-'}</td>`;
            return `<tr>${row}</tr>`;
        }).join('');

        // 图表数据 JSON
        const labels = JSON.stringify(trend.map(t => `${t.vus} VUs`));
        const avgData = JSON.stringify(trend.map(t => t.avg_latency_ms));
        const p95Data = JSON.stringify(trend.map(t => t.p95_latency_ms));
        const rpsData = JSON.stringify(trend.map(t => t.rps));

        const optimal = result.optimalInflectionPoint;
        const maxP = result.maxInflectionPoint;
        const limit = result.performanceLimit;

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
        body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.6; }
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
        .info-value { font-weight: 500; }
        .highlight-box { background: linear-gradient(135deg, rgba(59,130,246,0.15), rgba(34,197,94,0.15)); border: 1px solid rgba(59,130,246,0.3); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
        .highlight-box h3 { margin: 0 0 10px; color: var(--accent); font-size: 18px; }
        .metric-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px; }
        .metric-card { background: rgba(255,255,255,0.03); border-radius: 8px; padding: 16px; text-align: center; }
        .metric-card .metric-value { font-size: 24px; font-weight: 700; color: var(--accent); }
        .metric-card .metric-label { font-size: 13px; color: var(--muted); margin-top: 4px; }
        .tag { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; }
        .tag-success { background: rgba(34,197,94,0.15); color: var(--success); }
        .tag-warn { background: rgba(245,158,11,0.15); color: var(--warn); }
        .tag-danger { background: rgba(239,68,68,0.15); color: var(--danger); }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
        th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #334155; }
        th { color: var(--muted); font-weight: 500; background: rgba(255,255,255,0.03); }
        tr:hover td { background: rgba(255,255,255,0.02); }
        .chart-wrap { position: relative; height: 380px; margin-top: 16px; }
        .footer { text-align: center; color: var(--muted); font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #334155; }
        @media print { body { background: #fff; color: #000; } .card { background: #fff; box-shadow: none; border: 1px solid #ddd; } }
    </style>
</head>
<body>
<div class="container">
    <header>
        <h1>🚀 NodeBench 性能标定报告</h1>
        <p>会话ID: <code>${sessionId}</code> &nbsp;|&nbsp; 生成时间: ${sysInfo.reportTime}</p>
    </header>

    <!-- 机器基础信息 -->
    <div class="card">
        <h2>🖥️ 机器基础信息</h2>
        <div class="grid-2">
            <div>
                <div class="info-item"><span class="info-label">主机名</span><span class="info-value">${sysInfo.hostname}</span></div>
                <div class="info-item"><span class="info-label">操作系统</span><span class="info-value">${sysInfo.platform}</span></div>
                <div class="info-item"><span class="info-label">Node 版本</span><span class="info-value">${sysInfo.nodeVersion}</span></div>
            </div>
            <div>
                <div class="info-item"><span class="info-label">CPU 型号</span><span class="info-value">${sysInfo.cpuModel}</span></div>
                <div class="info-item"><span class="info-label">CPU 核心数</span><span class="info-value">${sysInfo.cpuCores}</span></div>
                <div class="info-item"><span class="info-label">总内存</span><span class="info-value">${sysInfo.totalMemory}</span></div>
            </div>
        </div>
    </div>

    <!-- 核心结论 -->
    <div class="card">
        <h2>📋 性能标定结论</h2>
        <div class="highlight-box">
            <h3>评估结论</h3>
            <p style="margin:0;font-size:15px;">${result.summary || '暂无评估结论'}</p>
        </div>
        <div class="metric-cards">
            <div class="metric-card">
                <div class="metric-value">${limit ? limit.vus : '--'}</div>
                <div class="metric-label">性能上限 VUs</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${limit ? limit.rps : '--'}</div>
                <div class="metric-label">峰值 RPS</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${limit ? limit.p95_latency_ms + 'ms' : '--'}</div>
                <div class="metric-label">P95 延迟</div>
            </div>
        </div>
        <div class="grid-2" style="margin-top:12px;">
            <div class="highlight-box" style="margin-bottom:0;">
                <h3>🎯 最优拐点</h3>
                <p style="margin:0;">${optimal ? `<strong>${optimal.vus}</strong> VUs / <strong>${optimal.rps}</strong> RPS / <strong>${optimal.p95_latency_ms}ms</strong> P95` : '未找到'}</p>
                <span class="tag tag-success" style="margin-top:8px;">效率最高</span>
            </div>
            <div class="highlight-box" style="margin-bottom:0;">
                <h3>⚠️ 最大拐点</h3>
                <p style="margin:0;">${maxP ? `<strong>${maxP.vus}</strong> VUs / <strong>${maxP.rps}</strong> RPS / <strong>${maxP.p95_latency_ms}ms</strong> P95` : '未找到'}</p>
                <span class="tag tag-warn" style="margin-top:8px;">系统上限</span>
            </div>
        </div>
    </div>

    <!-- 趋势图表 -->
    <div class="card">
        <h2>📈 性能趋势图表</h2>
        <div class="chart-wrap">
            <canvas id="trendChart"></canvas>
        </div>
    </div>

    <!-- 详细数据 -->
    <div class="card">
        <h2>📊 详细性能数据</h2>
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th>阶段</th><th>VUs</th><th>平均延迟</th><th>P95延迟</th>
                        ${hasMinMax ? '<th>最小延迟</th><th>最大延迟</th><th>中位数</th>' : ''}
                        <th>RPS</th>
                        ${hasTotalReq ? '<th>总请求</th>' : ''}
                        ${hasErrorRate ? '<th>错误率</th>' : ''}
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
        </div>
    </div>

    <div class="footer">
        Generated by NodeBench &nbsp;|&nbsp; Performance Benchmarking System
    </div>
</div>

<script>
    const ctx = document.getElementById('trendChart').getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ${labels},
            datasets: [
                {
                    label: '平均延迟 (ms)',
                    data: ${avgData},
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(96,165,250,0.1)',
                    yAxisID: 'y',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 4
                },
                {
                    label: 'P95延迟 (ms)',
                    data: ${p95Data},
                    borderColor: '#f87171',
                    backgroundColor: 'rgba(248,113,113,0.1)',
                    yAxisID: 'y',
                    tension: 0.3,
                    fill: true,
                    pointRadius: 4
                },
                {
                    label: 'RPS',
                    data: ${rpsData},
                    borderColor: '#4ade80',
                    backgroundColor: 'rgba(74,222,128,0.05)',
                    yAxisID: 'y1',
                    tension: 0.3,
                    fill: false,
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { size: 13 } } },
                tooltip: {
                    backgroundColor: 'rgba(15,23,42,0.95)',
                    titleColor: '#f1f5f9',
                    bodyColor: '#cbd5e1',
                    borderColor: '#334155',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', maxRotation: 45 },
                    grid: { color: '#334155' }
                },
                y: {
                    type: 'linear', position: 'left',
                    ticks: { color: '#64748b' },
                    grid: { color: '#334155' },
                    title: { display: true, text: '延迟 (ms)', color: '#94a3b8' }
                },
                y1: {
                    type: 'linear', position: 'right',
                    ticks: { color: '#64748b' },
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: 'RPS', color: '#94a3b8' }
                }
            }
        }
    });
<\/script>
</body>
</html>`;
    }
}

module.exports = ReportGenerator;
