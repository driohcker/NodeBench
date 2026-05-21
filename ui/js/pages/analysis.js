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
                                <button class="btn btn-small btn-danger" onclick="App.deleteRawSession('${s.sessionId}')" title="删除该测试数据">🗑️</button>
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
                if (sel) {
                    sel.innerHTML = `<option value="">默认策略</option>` + r.data.map(s => `<option value="${s.name}">${s.meta?.displayName || s.name}</option>`).join('');
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
                const container = $('#analysis-report-list');
                if (r.data.length === 0) {
                    container.innerHTML = '<p class="text-muted text-center">暂无数据</p>';
                } else {
                    container.innerHTML = r.data.map(s => this._renderSessionCard(s)).join('');
                }
            }
        } catch (e) { console.error(e); }
    },

    _renderSessionCard(s) {
        return `
            <div class="report-session-card" style="margin-bottom:12px;border:1px solid var(--border-color);border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.04);transition:box-shadow 0.2s;">
                <div class="report-session-header" onclick="App.toggleReportSession('${s.sessionId}')"
                     style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;cursor:pointer;background:linear-gradient(180deg,#fff,#f8fafc);transition:background 0.2s;"
                     onmouseover="this.style.background='linear-gradient(180deg,#f8fafc,#f1f5f9)'" onmouseout="this.style.background='linear-gradient(180deg,#fff,#f8fafc)'">
                    <div style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
                        <span id="report-arrow-${s.sessionId}" style="font-size:12px;color:#94a3b8;width:18px;text-align:center;transition:transform 0.25s;">▶</span>
                        <div style="display:flex;flex-direction:column;gap:3px;min-width:0;">
                            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                                <code style="font-size:13px;background:#eef2f7;padding:3px 10px;border-radius:6px;font-weight:600;color:#334155;">${s.sessionId}</code>
                                <span style="font-size:11px;color:#94a3b8;white-space:nowrap;">${fmtDate(s.createdAt)}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px;">
                                ${(s.sources || []).map(src => `<span style="font-size:10px;color:#64748b;background:#e2e8f0;padding:1px 7px;border-radius:10px;">${src}</span>`).join('')}
                            </div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:12px;">
                        <button class="btn btn-small btn-ghost" onclick="event.stopPropagation();App.viewReportSession('${s.sessionId}')" title="填入右侧ID输入框">填入ID</button>
                        <button class="btn btn-small" onclick="event.stopPropagation();App.readReportResult('${s.sessionId}')" title="预览该session全部报告">预览全部</button>
                        <button class="btn btn-small btn-danger" onclick="event.stopPropagation();App.deleteReportSession('${s.sessionId}')" title="删除该会话及所有相关报告" style="background:#fef2f2;color:#dc2626;border-color:#fecaca;">🗑️</button>
                    </div>
                </div>
                <div id="report-body-${s.sessionId}" style="display:none;border-top:1px solid var(--border-color);background:#fff;">
                    <div id="report-sublist-${s.sessionId}" style="padding:14px 18px;">
                        <p class="text-muted" style="font-size:12px;margin:0;text-align:center;">点击展开加载子报告</p>
                    </div>
                </div>
            </div>
        `;
    },

    async toggleReportSession(sessionId) {
        const body = $(`#report-body-${sessionId}`);
        const arrow = $(`#report-arrow-${sessionId}`);
        if (!body) return;
        const isHidden = body.style.display === 'none' || body.style.display === '';
        if (isHidden) {
            const sublist = $(`#report-sublist-${sessionId}`);
            if (sublist) sublist.innerHTML = '<p class="text-muted" style="font-size:12px;margin:0;text-align:center;">加载中...</p>';
            try {
                const r = await window.electronAPI.dataReadDataReports(sessionId);
                if (r.success && r.data.length > 0) {
                    this.renderReportSubList(sessionId, r.data);
                } else {
                    if (sublist) sublist.innerHTML = '<p class="text-muted" style="font-size:12px;margin:0;text-align:center;">无数据报告</p>';
                }
            } catch (e) {
                if (sublist) sublist.innerHTML = '<p class="text-muted" style="font-size:12px;margin:0;text-align:center;">加载失败</p>';
            }
            body.style.display = 'block';
            if (arrow) arrow.style.transform = 'rotate(90deg)';
        } else {
            body.style.display = 'none';
            if (arrow) arrow.style.transform = 'rotate(0deg)';
        }
    },

    renderReportSubList(sessionId, reports) {
        const sublist = $(`#report-sublist-${sessionId}`);
        if (!sublist) return;
        let html = '<div style="display:flex;flex-direction:column;gap:8px;">';
        reports.forEach((report, idx) => {
            const target = report.target || 'unknown';
            const fileName = report._fileName || '';
            const strategyName = fileName
                .replace(/^data_report_/, '')
                .replace(/\.json$/, '')
                .split('_')
                .pop() || report.algorithm || '-';
            const session2Id = report.session2Id || '-';
            const generatedAt = report.generatedAt ? fmtDate(report.generatedAt) : '-';
            const dataPoints = (report.performanceData || []).length;
            const filePath = report._filePath || '';
            html += `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#fff;border-radius:8px;border:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,0.03);transition:all 0.15s;"
                     onmouseover="this.style.borderColor='#cbd5e1';this.style.boxShadow='0 2px 6px rgba(0,0,0,0.05)'" onmouseout="this.style.borderColor='#e2e8f0';this.style.boxShadow='0 1px 2px rgba(0,0,0,0.03)'">
                    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;flex:1;min-width:0;">
                        <span class="tag tag-info" style="font-size:11px;flex-shrink:0;">${target}</span>
                        <span style="font-size:12px;color:var(--muted);">策略 <strong style="color:var(--text);font-weight:600;">${strategyName}</strong></span>
                        <span style="font-size:12px;color:var(--muted);"><code style="font-size:11px;background:#eef2f7;padding:1px 5px;border-radius:3px;">${session2Id}</code></span>
                        <span style="font-size:12px;color:var(--muted);">${dataPoints} 点</span>
                        <span style="font-size:11px;color:#94a3b8;">${generatedAt}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:8px;">
                        <button class="btn btn-small" onclick="App.previewSingleReport('${sessionId}', ${idx})" title="预览该报告">预览</button>
                        <button class="btn btn-small btn-danger" onclick="App.deleteReport('${sessionId}', ${idx}, '${filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="删除该报告" style="background:#fef2f2;color:#dc2626;border-color:#fecaca;">🗑️</button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        sublist.innerHTML = html;
        this._reportCache = this._reportCache || {};
        this._reportCache[sessionId] = reports;
    },

    async deleteReport(sessionId, idx, filePath) {
        if (!confirm('确定要删除该数据报告吗？此操作不可恢复。')) return;
        try {
            const r = await window.electronAPI.dataDeleteReport(filePath);
            if (r.success) {
                toast('报告已删除', 'success');
                // 从缓存中移除
                if (this._reportCache && this._reportCache[sessionId]) {
                    this._reportCache[sessionId].splice(idx, 1);
                    if (this._reportCache[sessionId].length === 0) {
                        // 如果该session下没有报告了，刷新整个列表
                        await this.loadReportSessions();
                    } else {
                        // 重新渲染子列表
                        this.renderReportSubList(sessionId, this._reportCache[sessionId]);
                    }
                }
            } else {
                toast('删除失败: ' + (r.error || '未知错误'), 'error');
            }
        } catch (e) {
            toast('删除异常: ' + e.message, 'error');
        }
    },

    async deleteRawSession(sessionId) {
        if (!confirm(`确定要删除测试数据会话 ${sessionId} 吗？\n这将删除该会话下的所有原始测试数据（metrics.json、data_points.jsonl 等），此操作不可恢复。`)) return;
        try {
            const r = await window.electronAPI.dataDeleteSession(sessionId);
            if (r.success) {
                toast(`会话 ${sessionId} 已删除`, 'success');
                await this.loadRawSessions();
            } else {
                toast('删除失败: ' + (r.error || '未知错误'), 'error');
            }
        } catch (e) {
            toast('删除异常: ' + e.message, 'error');
        }
    },

    async deleteReportSession(sessionId) {
        if (!confirm(`确定要删除数据报告会话 ${sessionId} 吗？\n这将删除该会话下的所有监控报告和离线分析报告，此操作不可恢复。`)) return;
        try {
            const r = await window.electronAPI.dataDeleteSession(sessionId);
            if (r.success) {
                toast(`会话 ${sessionId} 已删除`, 'success');
                await this.loadReportSessions();
            } else {
                toast('删除失败: ' + (r.error || '未知错误'), 'error');
            }
        } catch (e) {
            toast('删除异常: ' + e.message, 'error');
        }
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
            const data = this.normalizeReport(report);
            if (!data) {
                html += `<div style="margin-bottom:24px;"><p class="text-muted">数据报告 #${idx + 1} 格式异常</p></div>`;
                return;
            }

            const target = data.target || report.target || 'unknown';
            const perfData = data.performanceData || [];

            html += `<div style="margin-bottom:28px;">`;
            html += `<h4 style="margin:0 0 10px;font-size:15px;color:var(--text-primary);border-bottom:1px solid var(--border-color);padding-bottom:6px;">数据报告 #${idx + 1} — 目标: ${target}</h4>`;

            // 元信息（同离线数据分析风格）
            if (data.sessionId || data.analyzedAt || (data.config && Object.keys(data.config).length > 0)) {
                html += '<div class="info-list" style="margin-bottom:12px">';
                if (data.sessionId) {
                    html += `<div class="info-item"><span class="info-label">会话ID:</span><span class="info-value"><code>${data.sessionId}</code></span></div>`;
                }
                if (data.session2Id || report.session2Id) {
                    html += `<div class="info-item"><span class="info-label">Session2Id:</span><span class="info-value"><code>${data.session2Id || report.session2Id}</code></span></div>`;
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

            // 核心结论
            if (data.summary) {
                html += '<div class="info-list" style="margin-bottom:12px">';
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

            // 性能数据表格
            if (perfData.length > 0) {
                html += '<h5 style="margin:14px 0 6px;font-size:13px;color:var(--muted)">性能数据（前10行）</h5>';
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

            // 趋势图
            html += `<div style="margin-top:16px;"><h5 style="margin:0 0 8px;font-size:13px;color:var(--muted)">性能趋势变化图</h5>`;
            html += `<div class="chart-container" style="height:320px;"><canvas id="analysis-report-chart-${idx}"></canvas></div></div>`;

            html += `</div>`;
        });

        box.innerHTML = html;

        // DOM 更新后绘制趋势图
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

    async openReport(reportPath) {
        try {
            const r = await window.electronAPI.shellOpenPath(reportPath);
            if (r.success) {
                toast('报告已在浏览器中打开', 'success');
            } else {
                toast('打开报告失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('打开报告异常: ' + e.message, 'error');
        }
    }
});
