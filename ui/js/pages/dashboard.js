/**
 * 仪表盘页面 - 一键式性能测试入口
 */

Object.assign(App, {
    dashLatestSessionId: null,
    dashLatestReportPath: null,
    dashTestPollingTimer: null,

    async loadDashboard() {
        this.pollSystemStats();
        this.pollServer();
        this._loadConfigPreview();
        await this._loadHistorySessions();
        await this._loadLatestResult();
        this._updateTestStateUI();
    },

    async _loadConfigPreview() {
        try {
            const r = await window.electronAPI.configGet();
            if (r.success) {
                const testConf = r.data.test || {};
                const monitorConf = r.data.monitor || {};
                // 插件化：动态获取策略显示名称
                let algoDisplayName = monitorConf.algorithm || '';
                try {
                    const sr = await window.electronAPI.monitorStrategies();
                    if (sr.success) {
                        const found = sr.data.find(s => s.name === monitorConf.algorithm);
                        if (found) algoDisplayName = found.meta.displayName;
                    }
                } catch (e) {}
                const targets = testConf.testTargets || ['cpu'];
                const targetTags = { cpu: 'tag-cpu', memory: 'tag-memory', io: 'tag-io' };
                const tagsHtml = targets.map(t => '<span class="tag ' + (targetTags[t] || '') + '">' + t.toUpperCase() + '</span>').join('');
                const sepHtml = '<span class="dash-config-sep">|</span>';
                const infoHtml = '<span class="text-muted">MaxVUs: <strong>' + (testConf.maxVUs || 400) + '</strong></span><span class="text-muted">算法: <strong>' + (algoDisplayName || '双窗口') + '</strong></span>';
                const el = $('#dash-config-preview');
                if (el) el.innerHTML = tagsHtml + sepHtml + infoHtml;
            }
        } catch (e) { /* ignore */ }
    },

    async _loadHistorySessions() {
        try {
            const r = await window.electronAPI.dataSessions();
            if (r.success) {
                this.sessions = r.data;
                const tbody = $('#dash-session-table');
                if (r.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center">暂无数据</td></tr>';
                } else {
                    const rows = [];
                    for (const s of r.data.slice(0, 8)) {
                        let peakRps = '--', peakVus = '--', p95 = '--', optimal = '--';
                        if (s.hasResult) {
                            try {
                                const rr = await window.electronAPI.dataReadResult(s.sessionId);
                                if (rr.success && rr.data) {
                                    const data = rr.data;
                                    const trend = data.vusLoadData || data.performance_trend || [];
                                    if (trend.length > 0) {
                                        peakRps = Math.max(...trend.map(t => t.tps ?? t.rps ?? 0)).toFixed(1);
                                        peakVus = Math.max(...trend.map(t => t.vus ?? 0));
                                        const last = trend[trend.length - 1];
                                        p95 = last?.p95Latency ?? last?.p95_latency_ms ?? '--';
                                    }
                                    const opt = data.inflectionPoints?.optimal || data.optimalInflectionPoint;
                                    if (opt) optimal = opt.vus;
                                }
                            } catch (e) { /* ignore */ }
                        }
                        rows.push('<tr data-session-id="' + s.sessionId + '"><td><code>' + s.sessionId + '</code></td><td>' + fmtDate(s.createdAt) + '</td><td>' + peakRps + '</td><td>' + peakVus + '</td><td>' + (p95 !== '--' ? p95 + 'ms' : '--') + '</td><td>' + (optimal !== '--' ? optimal + ' VUs' : '--') + '</td><td><button class="btn btn-small btn-ghost dash-history-view-btn" data-session-id="' + s.sessionId + '">查看</button></td></tr>');
                    }
                    tbody.innerHTML = rows.join('');

                    $$('.dash-history-view-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.dashLatestSessionId = btn.dataset.sessionId;
                            this._loadLatestResult();
                            const card = $('#dash-latest-result-card');
                            card.style.display = 'block';
                            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        });
                    });

                    $$('#dash-session-table tr[data-session-id]').forEach(tr => {
                        tr.addEventListener('click', () => {
                            this.dashLatestSessionId = tr.dataset.sessionId;
                            this._loadLatestResult();
                            const card = $('#dash-latest-result-card');
                            card.style.display = 'block';
                            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        });
                    });
                }
            }
        } catch (e) { console.error(e); }
    },

    async _loadLatestResult() {
        if (!this.dashLatestSessionId) {
            try {
                const r = await window.electronAPI.dataSessions();
                if (r.success && r.data.length > 0) {
                    this.dashLatestSessionId = r.data[0].sessionId;
                }
            } catch (e) {}
        }

        if (!this.dashLatestSessionId) {
            $('#dash-latest-result-card').style.display = 'none';
            return;
        }

        try {
            const rr = await window.electronAPI.dataReadResult(this.dashLatestSessionId);
            if (!rr.success) {
                $('#dash-latest-result-card').style.display = 'none';
                return;
            }

            const data = rr.data;
            $('#dash-result-session-id').textContent = 'Session: ' + this.dashLatestSessionId;

            const grid = $('#dash-result-grid');
            const cards = [];

            // 兼容 monitor 原始格式和 analyzer 转换格式
            let targetName = data.target || 'CPU';
            const tagClassMap = { cpu: 'tag-cpu', memory: 'tag-memory', io: 'tag-io' };
            const tc = tagClassMap[targetName.toLowerCase()] || 'tag-cpu';

            const optimal = data.inflectionPoints?.optimal || data.optimalInflectionPoint;
            const maxP = data.inflectionPoints?.max || data.maxInflectionPoint;
            const trend = data.vusLoadData || data.performance_trend || [];
            const lastTrend = trend.length > 0 ? trend[trend.length - 1] : null;

            cards.push(
                '<div class="dash-result-target">' +
                '<div class="dash-result-target-header"><span class="tag ' + tc + '">' + targetName.toUpperCase() + '</span></div>' +
                '<div class="dash-result-metrics">' +
                '<div class="dash-result-metric"><div class="dash-result-metric-label">最优拐点</div><div class="dash-result-metric-value">' + (optimal ? optimal.vus + ' VUs' : '--') + '</div><div class="dash-result-metric-sub">' + (optimal ? (optimal.latency || optimal.p95_latency_ms || 0) + 'ms' : '') + '</div></div>' +
                '<div class="dash-result-metric"><div class="dash-result-metric-label">最大拐点</div><div class="dash-result-metric-value">' + (maxP ? maxP.vus + ' VUs' : '--') + '</div><div class="dash-result-metric-sub">' + (maxP ? (maxP.latency || maxP.p95_latency_ms || 0) + 'ms' : '') + '</div></div>' +
                '<div class="dash-result-metric"><div class="dash-result-metric-label">P95 延迟</div><div class="dash-result-metric-value">' + (lastTrend ? (lastTrend.p95Latency ?? lastTrend.p95_latency_ms ?? '--') + 'ms' : '--') + '</div></div>' +
                '<div class="dash-result-metric"><div class="dash-result-metric-label">峰值 RPS</div><div class="dash-result-metric-value">' + (lastTrend ? (lastTrend.tps ?? lastTrend.rps ?? '--') : '--') + '</div></div>' +
                '</div></div>'
            );

            grid.innerHTML = cards.join('');
            $('#dash-latest-result-card').style.display = 'block';

            // 查找报告路径
            try {
                const repList = await window.electronAPI.reportsList();
                if (repList.success && repList.data) {
                    const matched = repList.data.find(r => r.sessionId === this.dashLatestSessionId);
                    this.dashLatestReportPath = matched ? matched.path : null;
                }
            } catch (e) {}
        } catch (e) {
            $('#dash-latest-result-card').style.display = 'none';
        }
    },

    async onDashAutoTestStart() {
        const btn = $('#dash-auto-test-btn');
        const stateEl = $('#dash-testing-state');

        btn.style.display = 'none';
        $('#dash-config-preview').style.display = 'none';
        stateEl.style.display = 'flex';
        $('#dash-testing-detail').textContent = '正在启动被测服务...';

        try {
            const r = await window.electronAPI.autoStart({});
            if (r.success) {
                toast('自动化测试流程已完成', 'success');
                this.dashLatestSessionId = r.sessionId;
                await this._loadLatestResult();
                await this._loadHistorySessions();
            } else {
                toast('自动化测试失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('启动异常: ' + e.message, 'error');
        } finally {
            btn.style.display = 'inline-flex';
            $('#dash-config-preview').style.display = 'flex';
            stateEl.style.display = 'none';
            this._updateTestStateUI();
        }
    },

    async onDashAutoTestStop() {
        try {
            const r = await window.electronAPI.autoStop();
            toast(r.success ? '测试已停止' : '停止失败: ' + r.error, r.success ? 'info' : 'error');
        } catch (e) {
            toast('停止异常: ' + e.message, 'error');
        }
    },

    _updateTestStateUI() {
        const isRunning = !!this.testStartTime;
        const btn = $('#dash-auto-test-btn');
        const stateEl = $('#dash-testing-state');

        if (isRunning) {
            if (btn) btn.style.display = 'none';
            if ($('#dash-config-preview')) $('#dash-config-preview').style.display = 'none';
            if (stateEl) stateEl.style.display = 'flex';
        } else {
            if (btn) btn.style.display = 'inline-flex';
            if ($('#dash-config-preview')) $('#dash-config-preview').style.display = 'flex';
            if (stateEl) stateEl.style.display = 'none';
        }
    },

    async onDashViewReport() {
        if (this.dashLatestReportPath) {
            await this.openReportFileByPath(this.dashLatestReportPath);
        } else if (this.dashLatestSessionId) {
            this.go('analysis');
        } else {
            toast('暂无报告可查看', 'warn');
        }
    },

    async onDashOpenReportFile() {
        if (this.dashLatestReportPath) {
            await this.openReportFileByPath(this.dashLatestReportPath);
        } else {
            toast('报告文件路径未找到', 'warn');
        }
    }
});
