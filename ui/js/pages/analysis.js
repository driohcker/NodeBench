/**
 * 结果分析页面
 */

Object.assign(App, {
    async loadAnalysis() {
        try {
            const r = await window.electronAPI.dataSessions();
            if (r.success) {
                this.sessions = r.data;
                const tbody = $('#analysis-session-table');
                if (r.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">暂无数据</td></tr>';
                } else {
                    tbody.innerHTML = r.data.map(s => `
                        <tr>
                            <td><code>${s.sessionId}</code></td>
                            <td>${fmtDate(s.createdAt)}</td>
                            <td>-</td>
                            <td>
                                <button class="btn btn-small btn-ghost" onclick="App.viewSession('${s.sessionId}')">查看</button>
                                <button class="btn btn-small" onclick="App.readResult('${s.sessionId}')">分析</button>
                            </td>
                        </tr>
                    `).join('');
                }
            }
        } catch (e) { console.error(e); }

        try {
            const r = await window.electronAPI.analyzerStrategies();
            if (r.success) {
                const sel = $('#analysis-strategy-select');
                if (sel && sel.options.length <= 1 && sel.options[0]?.value === '') {
                    sel.innerHTML = `<option value="">默认策略</option>` + r.data.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
                }
            }
        } catch (e) { console.error(e); }
    },

    async viewSession(sessionId) {
        $('#analysis-session-id').value = sessionId;
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
                error_rate: d.errorRate
            })),
            reportPath: data.reportPath || null
        };
    },

    async readResult(sessionId) {
        $('#analysis-session-id').value = sessionId;
        try {
            const r = await window.electronAPI.dataReadResult(sessionId);
            if (r.success) {
                const report = this.normalizeReport(r.data);
                if (report) this.renderResult(report);
                else toast('结果数据异常', 'error');
            } else {
                toast('读取结果失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('读取异常: ' + e.message, 'error');
        }
    },

    async analyzeSession(sessionId) {
        $('#analysis-session-id').value = sessionId;
        await this.runAnalysis();
    },

    async runAnalysis() {
        const sid = $('#analysis-session-id').value.trim();
        const strategy = $('#analysis-strategy-select').value;
        if (!sid) { toast('请输入会话 ID', 'error'); return; }

        $('#analysis-run-btn').disabled = true;
        $('#analysis-result-card').style.display = 'none';
        try {
            const r = await window.electronAPI.analyzerAnalyze(sid, strategy || undefined);
            if (r.success) {
                toast('分析完成');
                const report = this.normalizeReport(r.data);
                if (report) this.renderResult(report);
                else toast('分析结果格式异常', 'error');
            } else {
                const err = r.error || r.message || '未知错误';
                toast('分析失败: ' + err, 'error');
            }
        } catch (e) {
            toast('分析异常: ' + e.message, 'error');
        }
        $('#analysis-run-btn').disabled = false;
    },

    async generateBenchmarkReport() {
        const sid = $('#analysis-session-id').value.trim();
        if (!sid) { toast('请输入会话 ID', 'error'); return; }
        $('#analysis-benchmark-btn').disabled = true;
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
        $('#analysis-benchmark-btn').disabled = false;
    },

    async transcodeReport() {
        const sid = $('#analysis-session-id').value.trim();
        const format = $('#analysis-transcode-format').value;
        if (!sid) { toast('请输入会话 ID', 'error'); return; }
        $('#analysis-transcode-btn').disabled = true;
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
        $('#analysis-transcode-btn').disabled = false;
    },

    renderResult(data) {
        $('#analysis-result-card').style.display = 'block';
        const box = $('#analysis-result-text');

        if (!data || (!data.performance_trend && !data.summary)) {
            box.innerHTML = '<p class="text-muted">暂无可用分析数据</p>';
            this.destroyChart();
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

        const trend = data.performance_trend || [];
        if (trend.length > 0) {
            const hasErrorRate = trend.some(t => t.error_rate !== null && t.error_rate !== undefined);
            const hasMinMax = trend.some(t => t.min_latency_ms !== null && t.min_latency_ms !== undefined);
            const hasTotalReq = trend.some(t => t.total_requests !== null && t.total_requests !== undefined);

            html += '<div style="overflow-x:auto;"><table class="data-table"><thead><tr>';
            html += '<th>阶段</th><th>VUs</th><th>平均延迟</th><th>P95延迟</th>';
            if (hasMinMax) html += '<th>最小延迟</th><th>最大延迟</th><th>中位数</th>';
            html += '<th>RPS</th>';
            if (hasTotalReq) html += '<th>总请求</th>';
            if (hasErrorRate) html += '<th>错误率</th>';
            html += '</tr></thead><tbody>';

            html += trend.map(t => {
                let row = `<tr><td>${t.stage}</td><td>${t.vus}</td><td>${t.avg_latency_ms}ms</td><td>${t.p95_latency_ms}ms</td>`;
                if (hasMinMax) {
                    row += `<td>${t.min_latency_ms !== null ? t.min_latency_ms + 'ms' : '-'}</td>`;
                    row += `<td>${t.max_latency_ms !== null ? t.max_latency_ms + 'ms' : '-'}</td>`;
                    row += `<td>${t.median_latency_ms !== null ? t.median_latency_ms + 'ms' : '-'}</td>`;
                }
                row += `<td>${t.rps}</td>`;
                if (hasTotalReq) {
                    row += `<td>${t.total_requests !== null ? t.total_requests : '-'}</td>`;
                }
                if (hasErrorRate) {
                    row += `<td>${t.error_rate !== null ? t.error_rate + '%' : '-'}</td>`;
                }
                row += '</tr>';
                return row;
            }).join('');

            html += '</tbody></table></div>';
        }

        box.innerHTML = html;
        this.drawChart(trend);
    },

    drawChart(trend) {
        this.destroyChart();
        if (!trend || trend.length < 2) return;

        const ctx = $('#analysis-chart').getContext('2d');
        const labels = trend.map(t => `${t.vus} VUs`);
        const avg = trend.map(t => t.avg_latency_ms);
        const p95 = trend.map(t => t.p95_latency_ms);
        const rps = trend.map(t => t.rps);

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: '平均延迟 (ms)',
                        data: avg,
                        borderColor: '#60a5fa',
                        backgroundColor: 'rgba(96,165,250,0.1)',
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
                    legend: { labels: { color: '#94a3b8' } }
                },
                scales: {
                    x: {
                        ticks: { color: '#64748b', maxRotation: 45 },
                        grid: { color: '#334155' }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        ticks: { color: '#64748b' },
                        grid: { color: '#334155' },
                        title: { display: true, text: '延迟 (ms)', color: '#94a3b8' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        ticks: { color: '#64748b' },
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'RPS', color: '#94a3b8' }
                    }
                }
            }
        });
    },

    destroyChart() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
});
