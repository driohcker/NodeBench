/**
 * 结果分析页面（双模式：原始数据分析 / 数据报告分析）
 */

Object.assign(App, {
    // ─── 页面加载 ───
    async loadAnalysis() {
        await this.loadRawSessions();
        await this.loadReportSessions();
    },

    // ─── Tab 切换 ───
    switchAnalysisMode(mode) {
        $$('#analysis-tab-bar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        $('#analysis-raw-panel').style.display = mode === 'raw' ? 'block' : 'none';
        $('#analysis-report-panel').style.display = mode === 'report' ? 'block' : 'none';
        this.analysisMode = mode;
    },

    // ═══════════════════════════════════════════════
    //  原始数据分析子页面
    // ═══════════════════════════════════════════════

    async loadRawSessions() {
        try {
            const r = await window.electronAPI.dataSessions();
            if (r.success) {
                this.rawSessions = r.data;
                const tbody = $('#analysis-raw-table');
                if (r.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">暂无数据</td></tr>';
                } else {
                    tbody.innerHTML = r.data.map(s => `
                        <tr>
                            <td><code>${s.sessionId}</code></td>
                            <td>${fmtDate(s.createdAt)}</td>
                            <td>-</td>
                            <td>
                                <button class="btn btn-small btn-ghost" onclick="App.viewRawSession('${s.sessionId}')">查看</button>
                                <button class="btn btn-small" onclick="App.analyzeRawSession('${s.sessionId}')">分析</button>
                            </td>
                        </tr>
                    `).join('');
                }
            }
        } catch (e) { console.error(e); }

        try {
            const r = await window.electronAPI.analyzerStrategies();
            if (r.success) {
                const sel = $('#analysis-raw-strategy-select');
                if (sel && sel.options.length <= 1 && sel.options[0]?.value === '') {
                    sel.innerHTML = `<option value="">默认策略</option>` + r.data.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
                }
            }
        } catch (e) { console.error(e); }
    },

    viewRawSession(sessionId) {
        $('#analysis-raw-session-id').value = sessionId;
    },

    async analyzeRawSession(sessionId) {
        $('#analysis-raw-session-id').value = sessionId;
        await this.runRawAnalysis();
    },

    async readRawResult(sessionId) {
        $('#analysis-raw-session-id').value = sessionId;
        try {
            const r = await window.electronAPI.dataReadResult(sessionId);
            if (r.success) {
                const report = this.normalizeReport(r.data);
                if (report) this.renderRawResult(report);
                else toast('结果数据异常', 'error');
            } else {
                toast('读取结果失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('读取异常: ' + e.message, 'error');
        }
    },

    async runRawAnalysis() {
        const sid = $('#analysis-raw-session-id').value.trim();
        const strategy = $('#analysis-raw-strategy-select').value;
        if (!sid) { toast('请输入会话 ID', 'error'); return; }

        $('#analysis-raw-run-btn').disabled = true;
        $('#analysis-raw-result-card').style.display = 'none';
        try {
            const r = await window.electronAPI.analyzerAnalyze(sid, strategy || undefined);
            if (r.success) {
                toast('分析完成');
                const report = this.normalizeReport(r.data);
                if (report) this.renderRawResult(report);
                else toast('分析结果格式异常', 'error');
            } else {
                const err = r.error || r.message || '未知错误';
                toast('分析失败: ' + err, 'error');
            }
        } catch (e) {
            toast('分析异常: ' + e.message, 'error');
        }
        $('#analysis-raw-run-btn').disabled = false;
    },


    renderRawResult(data) {
        $('#analysis-raw-result-card').style.display = 'block';
        const box = $('#analysis-raw-result-text');

        if (!data || (!data.performance_trend && !data.summary)) {
            box.innerHTML = '<p class="text-muted">暂无可用分析数据</p>';
            this.destroyRawChart();
            return;
        }

        let html = '';

        if (data.sessionId || data.analyzedAt || (data.config && Object.keys(data.config).length > 0)) {
            html += '<div class="info-list" style="margin-bottom:16px">';
            if (data.sessionId) {
                html += `<div class="info-item"><span class="info-label">会话ID:</span><span class="info-value"><code>${data.sessionId}</code></span></div>`;
            }
            if (data.analyzedAt) {
                html += `<div class="info-item"><span class="info-label">分析时间:</span><span class="info-value">${fmtDate(data.analyzedAt)}</span></div>`;
            }
            if (data.config) {
                const c = data.config;
                const cfgParts = [];
                if (c.initVUs !== undefined && c.maxVUs !== undefined) cfgParts.push(`VUs: ${c.initVUs}→${c.maxVUs}`);
                if (c.duration) cfgParts.push(`时长: ${c.duration}`);
                if (c.iterations) cfgParts.push(`步数: ${c.iterations}`);
                if (cfgParts.length) {
                    html += `<div class="info-item"><span class="info-label">测试配置:</span><span class="info-value">${cfgParts.join(' / ')}</span></div>`;
                }
            }
            html += '</div>';
        }

        if (data.summary) {
            html += '<div class="info-list" style="margin-bottom:16px">';
            html += `<div class="info-item"><span class="info-label">评估结论:</span><span class="info-value">${data.summary}</span></div>`;
            if (data.performanceLimit) {
                const pl = data.performanceLimit;
                html += `<div class="info-item"><span class="info-label">性能上限:</span><span class="info-value">${pl.vus} VUs / ${pl.rps} RPS / ${pl.p95_latency_ms}ms P95</span></div>`;
            }
            if (data.optimalInflectionPoint) {
                const o = data.optimalInflectionPoint;
                html += `<div class="info-item"><span class="info-label">最优拐点:</span><span class="info-value">${o.vus} VUs / ${o.rps} RPS / ${o.p95_latency_ms}ms P95</span></div>`;
            }
            if (data.maxInflectionPoint) {
                const m = data.maxInflectionPoint;
                html += `<div class="info-item"><span class="info-label">最大拐点:</span><span class="info-value">${m.vus} VUs / ${m.rps} RPS / ${m.p95_latency_ms}ms P95</span></div>`;
            }
            html += '</div>';
        }

        if (data.reportPath) {
            html += `<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <span>📄 性能标定报告已生成</span>
                <button class="btn btn-small btn-success" onclick="App.openReport('${data.reportPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">在浏览器中打开</button>
            </div>`;
        }

        // 展示 performanceData 前10行（数据报告数据表格）
        const perfData = data.performanceData || [];
        if (perfData.length > 0) {
            html += '<h4 style="margin:16px 0 8px;font-size:14px;color:var(--muted)">性能数据（前10行）</h4>';
            html += '<div style="overflow-x:auto;"><table class="data-table"><thead><tr>';
            html += '<th>序号</th><th>VUs</th><th>延迟(ms)</th><th>RPS</th><th>错误率(%)</th>';
            html += '</tr></thead><tbody>';
            perfData.slice(0, 10).forEach((p, i) => {
                html += `<tr>
                    <td>${p.index !== undefined ? p.index : i}</td>
                    <td>${p.vus}</td>
                    <td>${typeof p.latency === 'number' ? p.latency.toFixed(2) : p.latency}</td>
                    <td>${typeof p.rps === 'number' ? p.rps.toFixed(2) : p.rps}</td>
                    <td>${p.errorRate !== undefined ? p.errorRate + '%' : '-'}</td>
                </tr>`;
            });
            html += '</tbody></table></div>';
            if (perfData.length > 10) {
                html += `<p class="text-muted" style="font-size:12px;margin-top:4px;">共 ${perfData.length} 行数据，仅展示前10行</p>`;
            }
        }

        box.innerHTML = html;
        const trend = data.performance_trend || [];
        this.drawRawChart(trend);
    },

    drawRawChart(trend) {
        this.destroyRawChart();
        if (!trend || trend.length < 2) return;

        const ctx = $('#analysis-raw-chart').getContext('2d');
        const labels = trend.map(t => `${t.vus} VUs`);
        const avg = trend.map(t => t.avg_latency_ms);
        const p95 = trend.map(t => t.p95_latency_ms);
        const rps = trend.map(t => t.rps);
        const errorRates = this._interpolateZeroValues(trend.map(t => t.error_rate));
        const cpuData = this._interpolateZeroValues(trend.map(t => t.cpu_utilization));
        const memoryData = this._interpolateZeroValues(trend.map(t => t.memory_utilization));

        let hasErrorRate = errorRates.some(v => v !== null && v !== undefined);
        let hasCpu = cpuData.some(v => v !== null && v !== undefined);
        let hasMemory = memoryData.some(v => v !== null && v !== undefined);

        const datasets = [
            {
                label: '平均延迟 (ms)',
                data: avg,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239,68,68,0.1)',
                yAxisID: 'y',
                tension: 0.3,
                fill: true,
                pointRadius: 4
            },
            {
                label: 'P95延迟 (ms)',
                data: p95,
                borderColor: '#f87171',
                backgroundColor: 'rgba(248,113,113,0.1)',
                yAxisID: 'y',
                tension: 0.3,
                fill: true,
                pointRadius: 4
            },
            {
                label: 'RPS',
                data: rps,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245,158,11,0.05)',
                yAxisID: 'y1',
                tension: 0.3,
                fill: false,
                pointRadius: 4
            }
        ];

        if (hasErrorRate) {
            datasets.push({
                label: '错误率 (%)',
                data: errorRates,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139,92,246,0.05)',
                yAxisID: 'y2',
                tension: 0.3,
                fill: false,
                pointRadius: 3,
                borderDash: [5, 5]
            });
        }

        if (hasCpu) {
            datasets.push({
                label: 'CPU占用率 (%)',
                data: cpuData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.05)',
                yAxisID: 'y2',
                tension: 0.3,
                fill: false,
                pointRadius: 3
            });
        }

        if (hasMemory) {
            datasets.push({
                label: 'Memory占用率 (%)',
                data: memoryData,
                borderColor: '#06b6d4',
                backgroundColor: 'rgba(6,182,212,0.05)',
                yAxisID: 'y2',
                tension: 0.3,
                fill: false,
                pointRadius: 3
            });
        }

        this.rawChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#64748b' } }
                },
                scales: {
                    x: {
                        ticks: { color: '#64748b', maxRotation: 45 },
                        grid: { color: '#e2e8f0' },
                        title: { display: true, text: 'VUs (并发用户数)', color: '#64748b' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        ticks: { color: '#64748b' },
                        grid: { color: '#e2e8f0' },
                        title: { display: true, text: '响应延迟 (ms)', color: '#64748b' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#64748b' },
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'RPS', color: '#64748b' }
                    },
                    y2: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#64748b', callback: function(value) { return value + '%'; } },
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: '百分比 (%)', color: '#64748b' }
                    }
                }
            }
        });
    },

    destroyRawChart() {
        if (this.rawChart) {
            this.rawChart.destroy();
            this.rawChart = null;
        }
    },

    // ═══════════════════════════════════════════════
    //  数据报告分析子页面
    // ═══════════════════════════════════════════════

    async loadReportSessions() {
        try {
            const r = await window.electronAPI.dataReportSessions();
            if (r.success) {
                this.reportSessions = r.data;
                const tbody = $('#analysis-report-table');
                if (r.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">暂无数据</td></tr>';
                } else {
                    tbody.innerHTML = r.data.map(s => `
                        <tr class="report-session-row" style="cursor:pointer;" onclick="App.toggleReportSession('${s.sessionId}')">
                            <td><code>${s.sessionId}</code> <span style="font-size:11px;color:var(--muted)">▶</span></td>
                            <td>${fmtDate(s.createdAt)}</td>
                            <td>${(s.sources || []).join('+')}</td>
                            <td>
                                <button class="btn btn-small btn-ghost" onclick="event.stopPropagation();App.viewReportSession('${s.sessionId}')">填入ID</button>
                                <button class="btn btn-small" onclick="event.stopPropagation();App.readReportResult('${s.sessionId}')">预览全部</button>
                            </td>
                        </tr>
                        <tr id="report-expand-${s.sessionId}" style="display:none;">
                            <td colspan="4" style="padding:0;background:#f8fafc;">
                                <div id="report-sublist-${s.sessionId}" style="padding:12px 16px;">
                                    <p class="text-muted" style="font-size:12px;margin:0;">点击展开加载子报告...</p>
                                </div>
                            </td>
                        </tr>
                    `).join('');
                }
            }
        } catch (e) { console.error(e); }
    },

    async toggleReportSession(sessionId) {
        const expandRow = $(`#report-expand-${sessionId}`);
        if (!expandRow) return;
        const isHidden = expandRow.style.display === 'none';
        if (isHidden) {
            const sublist = $(`#report-sublist-${sessionId}`);
            if (sublist) sublist.innerHTML = '<p class="text-muted" style="font-size:12px;margin:0;">加载中...</p>';
            try {
                const r = await window.electronAPI.dataReadDataReports(sessionId);
                if (r.success && r.data.length > 0) {
                    this.renderReportSubList(sessionId, r.data);
                } else {
                    if (sublist) sublist.innerHTML = '<p class="text-muted" style="font-size:12px;margin:0;">无数据报告</p>';
                }
            } catch (e) {
                if (sublist) sublist.innerHTML = '<p class="text-muted" style="font-size:12px;margin:0;">加载失败</p>';
            }
            expandRow.style.display = 'table-row';
        } else {
            expandRow.style.display = 'none';
        }
    },

    renderReportSubList(sessionId, reports) {
        const sublist = $(`#report-sublist-${sessionId}`);
        if (!sublist) return;
        let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
        reports.forEach((report, idx) => {
            const target = report.target || 'unknown';
            // 从文件名提取策略名: data_report_{s2id}_{target}_{strategy}.json
            const fileName = report._fileName || '';
            const strategyName = fileName
                .replace(/^data_report_/, '')
                .replace(/\.json$/, '')
                .split('_')
                .pop() || report.algorithm || '-';
            const session2Id = report.session2Id || '-';
            const generatedAt = report.generatedAt ? fmtDate(report.generatedAt) : '-';
            const dataPoints = (report.performanceData || []).length;
            html += `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#fff;border-radius:6px;border:1px solid var(--border-color);">
                    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                        <span class="tag tag-info" style="font-size:11px;">${target}</span>
                        <span style="font-size:12px;color:var(--muted);">策略: <strong style="color:var(--text);">${strategyName}</strong></span>
                        <span style="font-size:12px;color:var(--muted);">S2: <code style="font-size:11px;">${session2Id}</code></span>
                        <span style="font-size:12px;color:var(--muted);">${generatedAt}</span>
                        <span style="font-size:12px;color:var(--muted);">${dataPoints} 点</span>
                    </div>
                    <button class="btn btn-small" onclick="App.previewSingleReport('${sessionId}', ${idx})">预览</button>
                </div>
            `;
        });
        html += '</div>';
        sublist.innerHTML = html;
        // 缓存报告供预览使用
        this._reportCache = this._reportCache || {};
        this._reportCache[sessionId] = reports;
    },

    async previewSingleReport(sessionId, idx) {
        const reports = this._reportCache && this._reportCache[sessionId];
        if (!reports || !reports[idx]) {
            toast('报告数据已过期，请重新展开', 'error');
            return;
        }
        this.renderReportResult([reports[idx]]);
    },

    viewReportSession(sessionId) {
        $('#analysis-report-session-id').value = sessionId;
    },

    async readReportResult(sessionId) {
        $('#analysis-report-session-id').value = sessionId;
        try {
            const r = await window.electronAPI.dataReadDataReports(sessionId);
            if (r.success) {
                this.renderReportResult(r.data);
            } else {
                toast('读取数据报告失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('读取异常: ' + e.message, 'error');
        }
    },

    async generateReportBenchmarkReport() {
        const sid = $('#analysis-report-session-id').value.trim();
        if (!sid) { toast('请输入会话 ID', 'error'); return; }
        $('#analysis-report-benchmark-btn').disabled = true;
        try {
            const r = await window.electronAPI.analyzerBenchmark(sid);
            if (r.success) {
                toast('标定报告已生成', 'success');
                if (r.reportPath) {
                    this.openReport(r.reportPath);
                }
            } else {
                toast('生成标定报告失败: ' + (r.error || '未知错误'), 'error');
            }
        } catch (e) {
            toast('生成标定报告异常: ' + e.message, 'error');
        }
        $('#analysis-report-benchmark-btn').disabled = false;
    },

    async transcodeReportReport() {
        const sid = $('#analysis-report-session-id').value.trim();
        const format = $('#analysis-report-transcode-format').value;
        if (!sid) { toast('请输入会话 ID', 'error'); return; }
        $('#analysis-report-transcode-btn').disabled = true;
        try {
            const r = await window.electronAPI.analyzerTranscode(sid, format);
            if (r.success) {
                toast(`转码完成: ${r.outputPath || ''}`, 'success');
            } else {
                toast('转码失败: ' + (r.error || '未知错误'), 'error');
            }
        } catch (e) {
            toast('转码异常: ' + e.message, 'error');
        }
        $('#analysis-report-transcode-btn').disabled = false;
    },

    renderReportResult(reports) {
        $('#analysis-report-result-card').style.display = 'block';
        const box = $('#analysis-report-result-text');

        if (!reports || reports.length === 0) {
            box.innerHTML = '<p class="text-muted">暂无可用数据报告</p>';
            this.destroyReportCharts();
            return;
        }

        let html = '';

        reports.forEach((report, idx) => {
            const target = report.target || 'unknown';
            const perfData = report.performanceData || [];

            html += `<div style="margin-bottom:24px;">`;
            html += `<h4 style="margin:0 0 8px;font-size:15px;color:var(--text-primary);border-bottom:1px solid var(--border-color);padding-bottom:6px;">数据报告 #${idx + 1} — 目标: ${target}</h4>`;

            if (report.session2Id) {
                html += `<div class="info-list" style="margin-bottom:8px">`;
                html += `<div class="info-item"><span class="info-label">Session2Id:</span><span class="info-value"><code>${report.session2Id}</code></span></div>`;
                html += `<div class="info-item"><span class="info-label">生成时间:</span><span class="info-value">${fmtDate(report.generatedAt)}</span></div>`;
                html += `<div class="info-item"><span class="info-label">模式:</span><span class="info-value">${report.mode || '-'}</span></div>`;
                html += `<div class="info-item"><span class="info-label">数据点数:</span><span class="info-value">${perfData.length}</span></div>`;
                html += `</div>`;
            }

            if (perfData.length > 0) {
                html += '<div style="overflow-x:auto;"><table class="data-table"><thead><tr>';
                html += '<th>序号</th><th>VUs</th><th>延迟(ms)</th><th>RPS</th><th>错误率(%)</th>';
                html += '</tr></thead><tbody>';
                perfData.slice(0, 10).forEach((p, i) => {
                    html += `<tr>
                        <td>${p.index !== undefined ? p.index : i}</td>
                        <td>${p.vus}</td>
                        <td>${typeof p.latency === 'number' ? p.latency.toFixed(2) : p.latency}</td>
                        <td>${typeof p.rps === 'number' ? p.rps.toFixed(2) : p.rps}</td>
                        <td>${p.errorRate !== undefined ? p.errorRate + '%' : '-'}</td>
                    </tr>`;
                });
                html += '</tbody></table></div>';
                if (perfData.length > 10) {
                    html += `<p class="text-muted" style="font-size:12px;margin-top:4px;">共 ${perfData.length} 行数据，仅展示前10行</p>`;
                }
            } else {
                html += '<p class="text-muted">无性能数据</p>';
            }

            // 为每个报告添加独立的趋势图 canvas
            html += `<div style="margin-top:12px;"><h5 style="margin:0 0 6px;font-size:13px;color:var(--muted)">性能趋势变化图</h5>`;
            html += `<div class="chart-container" style="height:320px;"><canvas id="analysis-report-chart-${idx}"></canvas></div></div>`;

            html += `</div>`;
        });

        box.innerHTML = html;

        // DOM 更新后，为每个报告绘制完整的趋势图
        this.destroyReportCharts();
        this.reportCharts = [];
        requestAnimationFrame(() => {
            reports.forEach((report, idx) => {
                const canvas = $(`#analysis-report-chart-${idx}`);
                if (!canvas) return;
                const normalized = this.normalizeReport(report);
                const chart = this._drawChartOnCanvas(canvas, normalized.performance_trend || [], report.target);
                if (chart) this.reportCharts.push(chart);
            });
        });
    },

    _drawChartOnCanvas(canvas, trend, targetName) {
        if (!trend || trend.length < 2) return null;

        const ctx = canvas.getContext('2d');
        const labels = trend.map(t => `${t.vus} VUs`);
        const avg = trend.map(t => t.avg_latency_ms);
        const p95 = trend.map(t => t.p95_latency_ms);
        const rps = trend.map(t => t.rps);
        const errorRates = this._interpolateZeroValues(trend.map(t => t.error_rate));
        const cpuData = this._interpolateZeroValues(trend.map(t => t.cpu_utilization));
        const memoryData = this._interpolateZeroValues(trend.map(t => t.memory_utilization));

        let hasErrorRate = errorRates.some(v => v !== null && v !== undefined);
        let hasCpu = cpuData.some(v => v !== null && v !== undefined);
        let hasMemory = memoryData.some(v => v !== null && v !== undefined);

        // 根据 targetName 过滤：每个性能趋势变化图只展示它自己的占用率情况
        if (targetName === 'cpu') hasMemory = false;
        else if (targetName === 'memory') hasCpu = false;
        else if (targetName === 'io' || targetName === 'disk') { hasCpu = false; hasMemory = false; }

        const datasets = [
            {
                label: '平均延迟 (ms)',
                data: avg,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239,68,68,0.1)',
                yAxisID: 'y',
                tension: 0.3,
                fill: true,
                pointRadius: 3
            },
            {
                label: 'P95延迟 (ms)',
                data: p95,
                borderColor: '#f87171',
                backgroundColor: 'rgba(248,113,113,0.1)',
                yAxisID: 'y',
                tension: 0.3,
                fill: true,
                pointRadius: 3
            },
            {
                label: 'RPS',
                data: rps,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245,158,11,0.05)',
                yAxisID: 'y1',
                tension: 0.3,
                fill: false,
                pointRadius: 3
            }
        ];

        if (hasErrorRate) {
            datasets.push({
                label: '错误率 (%)',
                data: errorRates,
                borderColor: '#8b5cf6',
                backgroundColor: 'rgba(139,92,246,0.05)',
                yAxisID: 'y2',
                tension: 0.3,
                fill: false,
                pointRadius: 2,
                borderDash: [5, 5]
            });
        }

        if (hasCpu) {
            datasets.push({
                label: 'CPU占用率 (%)',
                data: cpuData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.05)',
                yAxisID: 'y2',
                tension: 0.3,
                fill: false,
                pointRadius: 2
            });
        }

        if (hasMemory) {
            datasets.push({
                label: 'Memory占用率 (%)',
                data: memoryData,
                borderColor: '#06b6d4',
                backgroundColor: 'rgba(6,182,212,0.05)',
                yAxisID: 'y2',
                tension: 0.3,
                fill: false,
                pointRadius: 2
            });
        }

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    title: { display: true, text: (targetName || 'unknown').toUpperCase() + ' 性能趋势变化图', color: '#1e293b', font: { size: 14 } },
                    legend: { labels: { color: '#64748b' } }
                },
                scales: {
                    x: {
                        ticks: { color: '#64748b', maxRotation: 45 },
                        grid: { color: '#e2e8f0' },
                        title: { display: true, text: 'VUs (并发用户数)', color: '#64748b' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        ticks: { color: '#64748b' },
                        grid: { color: '#e2e8f0' },
                        title: { display: true, text: '响应延迟 (ms)', color: '#64748b' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#64748b' },
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'RPS', color: '#64748b' }
                    },
                    y2: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#64748b', callback: function(value) { return value + '%'; } },
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: '百分比 (%)', color: '#64748b' }
                    }
                }
            }
        });
    },

    destroyReportCharts() {
        if (this.reportCharts && this.reportCharts.length > 0) {
            this.reportCharts.forEach(c => c.destroy());
            this.reportCharts = [];
        }
    },

    // ═══════════════════════════════════════════════
    //  通用辅助方法
    // ═══════════════════════════════════════════════

    /**
     * 对数组中的0值进行插值：用前后最近非0值的均值替代，避免数据剧烈波动
     */
    _interpolateZeroValues(arr) {
        if (!arr || arr.length === 0) return arr;
        const result = [...arr];
        for (let i = 0; i < result.length; i++) {
            if (result[i] === 0 || result[i] === null || result[i] === undefined) {
                let prev = null, next = null;
                for (let j = i - 1; j >= 0; j--) {
                    if (result[j] !== 0 && result[j] !== null && result[j] !== undefined) {
                        prev = result[j];
                        break;
                    }
                }
                for (let j = i + 1; j < result.length; j++) {
                    if (result[j] !== 0 && result[j] !== null && result[j] !== undefined) {
                        next = result[j];
                        break;
                    }
                }
                if (prev !== null && next !== null) result[i] = (prev + next) / 2;
                else if (prev !== null) result[i] = prev;
                else if (next !== null) result[i] = next;
            }
        }
        return result;
    },

    normalizeReport(data) {
        if (!data) return null;
        if (data.reports && Array.isArray(data.reports) && data.reports.length > 0) {
            data = data.reports[0].report;
        }
        if (data.performance_trend || data.summary) {
            return data;
        }
        const optimal = data.inflectionPoints?.optimal;
        const maxP = data.inflectionPoints?.max;
        return {
            sessionId: data.sessionId,
            session2Id: data.session2Id,
            target: data.target,
            analyzedAt: data.generatedAt,
            mode: data.mode,
            algorithm: data.algorithm,
            config: {
                initVUs: data.testConfig?.initVUs,
                maxVUs: data.testConfig?.maxVUs,
                duration: data.testConfig?.duration,
                iterations: data.testConfig?.iterations,
                waitPeriod: data.testConfig?.waitPeriod,
                outputMode: data.testConfig?.outputMode,
                sourceFile: data.dataConfig?.sourceFile,
                totalDataPoints: data.dataConfig?.totalDataPoints
            },
            summary: maxP ? `系统在 VUs=${maxP.vus} 时达到性能上限` : '未检测到明确的性能拐点',
            performanceLimit: maxP ? { vus: maxP.vus, rps: maxP.rps, p95_latency_ms: maxP.latency } : null,
            optimalInflectionPoint: optimal ? { vus: optimal.vus, rps: optimal.rps, p95_latency_ms: optimal.latency } : null,
            maxInflectionPoint: maxP ? { vus: maxP.vus, rps: maxP.rps, p95_latency_ms: maxP.latency } : null,
            performance_trend: (data.vusLoadData || []).map((d, i) => ({
                stage: i + 1,
                vus: d.vus,
                avg_latency_ms: d.avgLatency,
                p95_latency_ms: d.p95Latency,
                min_latency_ms: d.minLatency,
                max_latency_ms: d.maxLatency,
                median_latency_ms: d.avgLatency,
                rps: d.tps,
                total_requests: null,
                error_rate: d.errorRate,
                cpu_utilization: d.cpuUtilization,
                memory_utilization: d.memoryUtilization
            })),
            performanceData: data.performanceData || [],
            reportPath: data.reportPath || null
        };
    },

    openReport(reportPath) {
        window.electronAPI.openExternal && window.electronAPI.openExternal(reportPath);
    }
});
