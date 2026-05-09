/**
 * NodeBench GUI 应用核心
 * 负责页面路由、公共轮询、跨模块方法、初始化
 */

const App = {
    currentPage: 'dashboard',
    pollTimer: null,
    logPollTimer: null,
    chart: null,
    sessions: [],
    systemStatsHistory: [],
    cpuChart: null,
    memChart: null,
    monitorChart: null,
    testStartTime: null,
    systemPollTimer: null,
    testRuntimePollTimer: null,

    // 多目标标签页管理
    monitorTabs: {},
    monitorActiveTabId: null,
    monitorCurrentSession2Id: null,

    // 仪表盘/监控视图状态
    monitorChartView: 'time',
    monitorSmoothEnabled: false,

    // 报告中心状态
    selectedReportPath: null,
    reportList: [],

    // ─── 初始化 ───
    async init() {
        await this.loadPageHtmls();
        this.bindNav();
        this.bindEvents();
        this.loadVersion();
        this.refreshAll();
        this.startPoll();
        window.addEventListener('beforeunload', () => {
            fetch('/api/system/stopAll', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
                keepalive: true
            });
        });
    },

    async loadPageHtmls() {
        const container = $('.content-body');
        if (!container) return;
        const pages = ['dashboard', 'service', 'test', 'monitor', 'analysis', 'reports', 'logs', 'settings'];
        for (const page of pages) {
            try {
                const response = await fetch(`./pages/${page}.html`);
                if (!response.ok) {
                    console.error(`Failed to load page ${page}: ${response.status}`);
                    continue;
                }
                const html = await response.text();
                container.insertAdjacentHTML('beforeend', html);
            } catch (e) {
                console.error(`Error loading page ${page}:`, e);
            }
        }
    },

    // ─── 导航切换 ───
    bindNav() {
        $$('.nav-item').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                this.go(el.dataset.page);
            });
        });
    },

    async go(page) {
        this.currentPage = page;
        $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
        $$('.page').forEach(el => el.classList.remove('active'));
        $(`#page-${page}`).classList.add('active');

        const titles = {
            dashboard: '仪表盘',
            service: '服务管理',
            test: '测试管理',
            monitor: '实时监控',
            analysis: '结果分析',
            reports: '报告中心',
            logs: '日志中心',
            settings: '系统设置'
        };
        $('#pageTitle').textContent = titles[page];

        if (page === 'dashboard') this.loadDashboard();
        if (page === 'service') this.loadService();
        if (page === 'test') this.loadTest();
        if (page === 'monitor') this.loadMonitor();
        if (page === 'analysis') this.loadAnalysis();
        if (page === 'reports') this.loadReports();
        if (page === 'logs') {
            const active = $('#logs-tab-bar .tab-btn.active');
            const mod = active ? active.dataset.module : 'main';
            await this.loadLogFiles(mod);
            await this.loadLogs(mod);
        }
        if (page === 'settings') this.loadSettings();
    },

    // ─── 事件绑定 ───
    bindEvents() {
        const $on = (sel, event, handler) => {
            const el = $(sel);
            if (el) el.addEventListener(event, handler);
        };

        $on('#refreshBtn', 'click', () => this.refreshAll());

        // 仪表盘状态卡片按钮
        $on('#dash-server-action-btn', 'click', () => {
            const btn = $('#dash-server-action-btn');
            if (btn && btn.dataset.running === 'true') this.stopServer();
            else this.startServer();
        });
        $on('#dash-test-action-btn', 'click', () => {
            const btn = $('#dash-test-action-btn');
            if (btn && btn.dataset.running === 'true') this.stopTest();
            else this.startTest();
        });

        // 服务管理
        $on('#service-start-btn', 'click', () => this.startServer());
        $on('#service-stop-btn', 'click', () => this.stopServer());
        $on('#service-method-new-btn', 'click', () => this.createNewMethod());
        $on('#service-config-save-btn', 'click', () => this.saveServiceConfig());
        $on('#service-config-reset-btn', 'click', () => this.resetServiceConfig());
        $$('#page-service .form-input[data-config-key], #page-service .form-select[data-config-key]').forEach(el => {
            const markChanged = () => el.classList.add('changed');
            el.addEventListener('input', markChanged);
            el.addEventListener('change', markChanged);
        });
        $on('#method-editor-close', 'click', () => {
            const card = $('#method-editor-card');
            if (card) card.style.display = 'none';
        });
        $on('#method-editor-save', 'click', () => this.saveMethodContent());

        // 测试管理
        $on('#test-action-btn', 'click', () => this.onTestAction());
        $on('#test-reset-btn', 'click', () => this.resetTest());
        $on('#test-reset-config-btn', 'click', () => this.resetTestConfig());
        $on('#test-auto-mode', 'change', () => this.onTestModeChange());
        $on('#test-analysis-strategy-select', 'change', () => this.onStrategyChange());
        $on('#test-spike-filter-save-btn', 'click', () => this.saveSpikeFilterConfig());
        $on('#test-spike-filter-reset-btn', 'click', () => this.resetSpikeFilterConfig());
        $on('#test-clear-log', 'click', () => {
            const out = $('#test-log-output');
            if (out) out.textContent = '已清空\n';
        });

        // 实时监控视图切换
        $on('#mon-view-time', 'click', () => this._switchMonitorChartView('time'));
        $on('#mon-view-vus', 'click', () => this._switchMonitorChartView('vus'));

        // 平滑曲线开关
        $on('#mon-smooth-toggle', 'change', (e) => {
            this.monitorSmoothEnabled = e.target.checked;
            this.pollMonitorRealtime();
        });

        // 结果分析 Tab 切换
        const analysisTabBar = $('#analysis-tab-bar');
        if (analysisTabBar && !analysisTabBar._bound) {
            analysisTabBar._bound = true;
            analysisTabBar.addEventListener('click', (e) => {
                const btn = e.target.closest('.tab-btn');
                if (!btn) return;
                this.switchAnalysisMode(btn.dataset.mode);
            });
        }

        // 原始数据分析子页面
        $on('#analysis-raw-run-btn', 'click', () => this.runRawAnalysis());

        // 数据报告分析子页面
        $on('#analysis-report-benchmark-btn', 'click', () => this.generateReportBenchmarkReport());
        $on('#analysis-report-transcode-btn', 'click', () => this.transcodeReportReport());

        // 日志中心
        $on('#logs-refresh-btn', 'click', () => this.loadLogs());
        $on('#logs-delete-btn', 'click', () => this.deleteLogFile());
        $on('#logs-file-select', 'change', () => this.loadLogs());
        const logsTabBar = $('#logs-tab-bar');
        if (logsTabBar && !logsTabBar._bound) {
            logsTabBar._bound = true;
            logsTabBar.addEventListener('click', async (e) => {
                const btn = e.target.closest('.tab-btn');
                if (!btn) return;
                $$('#logs-tab-bar .tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                try {
                    const mod = btn.dataset.module;
                    await this.loadLogFiles(mod);
                    await this.loadLogs(mod);
                } catch (err) {
                    console.error('Logs tab switch error:', err);
                    $('#logs-output').textContent = '切换日志模块异常: ' + err.message;
                }
            });
        }

        // 系统设置
        $on('#settings-save-btn', 'click', () => this.saveSettings());
        $on('#settings-reset-btn', 'click', () => this.resetSettings());
        $$('#page-settings .form-input, #page-settings .form-select').forEach(el => {
            const markChanged = () => el.classList.add('changed');
            el.addEventListener('input', markChanged);
            el.addEventListener('change', markChanged);
        });

        // outputMode ↔ monitorMode 联动
        const outputModeEl = document.getElementById('set-test-outputMode');
        const monitorModeEl = document.getElementById('set-monitor-monitorMode');
        if (outputModeEl && monitorModeEl) {
            outputModeEl.addEventListener('change', () => {
                const map = { file: 'tail', pipe: 'pipe' };
                monitorModeEl.value = map[outputModeEl.value] || outputModeEl.value;
                monitorModeEl.classList.add('changed');
            });
            monitorModeEl.addEventListener('change', () => {
                const map = { tail: 'file', pipe: 'pipe' };
                outputModeEl.value = map[monitorModeEl.value] || monitorModeEl.value;
                outputModeEl.classList.add('changed');
            });
        }
    },

    // ─── 全局刷新 ───
    refreshAll() {
        this.loadDashboard();
        if (this.currentPage === 'service') this.loadService();
        if (this.currentPage === 'test') this.loadTest();
        if (this.currentPage === 'analysis') this.loadAnalysis();
        if (this.currentPage === 'reports') this.loadReports();
        if (this.currentPage === 'logs') this.loadLogs();
        if (this.currentPage === 'settings') this.loadSettings();
    },

    // ─── 轮询 ───
    startPoll() {
        this.pollTimer = setInterval(() => {
            this.pollServer();
            this.pollTest();
        }, 3000);

        this.logPollTimer = setInterval(() => {
            if (this.currentPage === 'test') this.pollTestLog();
        }, 2000);

        this.systemPollTimer = setInterval(() => {
            this.pollSystemStats();
        }, 3000);

        this.testRuntimePollTimer = setInterval(() => {
            if (this.currentPage === 'dashboard') this.pollTestRuntime();
        }, 2000);
    },

    // ═══════════════════════════════════════════════
    //  公共轮询方法（跨页面使用）
    // ═══════════════════════════════════════════════
    async pollServer() {
        try {
            const r = await window.electronAPI.serverStatus();
            if (!r.success) return;
            const on = r.data.isRunning;
            $('#dash-server-status').textContent = on ? '运行中' : '已停止';
            $('#dash-server-card').style.borderColor = on ? '#22c55e' : '#ef4444';

            const btn = $('#dash-server-action-btn');
            if (btn) {
                btn.dataset.running = on ? 'true' : 'false';
                btn.textContent = on ? '■ 停止服务' : '▶ 启动服务';
                btn.className = on ? 'btn btn-small btn-danger' : 'btn btn-small btn-success';
            }

            if (this.currentPage === 'service') {
                const statusText = on ? '运行中' : '已停止';
                const statusClass = on ? 'running' : 'stopped';
                const icon = on ? '✅' : '🛑';
                $('#service-status-text').textContent = statusText;
                $('#service-status-icon').textContent = icon;
                $('#service-status-badge').textContent = statusText;
                $('#service-status-badge').className = `badge badge-${statusClass}`;
                $('.service-status-card').style.borderColor = on ? 'var(--accent-success)' : 'var(--accent-danger)';
                $('#service-mode').textContent = r.data.mode || '-';
                $('#service-workers').textContent = r.data.workers || '-';
            }
        } catch (e) {
            $('#dash-server-status').textContent = '异常';
        }
    },

    async pollTest() {
        try {
            const r = await window.electronAPI.testStatus();
            if (!r.success) return;
            const on = r.data.isRunning;
            const wasRunning = !!this.testStartTime;
            $('#dash-test-status').textContent = on ? '运行中' : '空闲';
            $('#dash-test-card').style.borderColor = on ? '#f59e0b' : '#475569';

            if (on && !wasRunning) {
                this.testStartTime = Date.now();
            } else if (!on && wasRunning) {
                this.testStartTime = null;
            }

            const btn = $('#dash-test-action-btn');
            if (btn) {
                btn.dataset.running = on ? 'true' : 'false';
                btn.textContent = on ? '■ 停止测试' : '▶ 启动测试';
                btn.className = on ? 'btn btn-small btn-danger' : 'btn btn-small btn-success';
            }

            const runtimeCard = $('#dash-test-runtime-card');
            if (runtimeCard) {
                runtimeCard.style.display = on ? 'block' : 'none';
            }

            if (this.currentPage === 'test') {
                setStatus($('#test-status-indicator'), $('#test-status-text'), on);
                $('#test-current-target').textContent = r.data.currentTarget || '-';
                $('#test-current-vus').textContent = on ? `${r.data.currentVUs || 0} / ${r.data.maxVUs || 400}` : '-';
                $('#test-current-progress').textContent = on ? `${r.data.progress || 0}%` : '-';
                $('#test-current-session2id').textContent = r.data.currentSession2Id || '-';
                $('#test-current-output-mode').textContent = r.data.outputMode || '-';
                $('#test-current-sessionid').textContent = r.data.sessionId || '-';

                // 测试配置锁定与按钮状态同步
                this._setTestConfigLocked(on);
                this._updateTestActionButton(on);
            }
        } catch (e) {
            $('#dash-test-status').textContent = '异常';
        }
    },

    async pollTestLog() {
        try {
            const r = await window.electronAPI.logsRead('test', 150);
            const out = $('#test-log-output');
            if (!r.success) {
                out.textContent = '读取日志失败: ' + (r.error || '未知错误');
            } else if (r.data !== undefined && r.data !== null) {
                out.textContent = r.data;
                out.scrollTop = out.scrollHeight;
            }
        } catch (e) {
            const out = $('#test-log-output');
            out.textContent = '读取日志异常: ' + e.message;
        }
    },

    async pollSystemStats() {
        try {
            const r = await window.electronAPI.systemStats();
            if (!r.success) return;
            const d = r.data;

            const elSys = $('#dash-system-status'); if (elSys) elSys.textContent = `CPU ${d.cpu}% · 内存 ${d.memory}%`;
            const elCpu = $('#dash-cpu-value');      if (elCpu) elCpu.textContent = d.cpu + '%';
            const elMem = $('#dash-mem-value');      if (elMem) elMem.textContent = d.memory + '%';
            const elUp  = $('#dash-uptime-value');   if (elUp)  elUp.textContent = this.formatUptime(d.uptime);

            const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
            this.systemStatsHistory.push({ time: now, cpu: d.cpu, memory: d.memory });
            if (this.systemStatsHistory.length > 30) this.systemStatsHistory.shift();

            if (this.currentPage === 'dashboard') {
                this.renderCpuChart();
                this.renderMemoryChart();
            }
        } catch (e) { /* ignore */ }
    },

    async pollTestRuntime() {
        if (!this.testStartTime) return;

        const elapsed = Math.floor((Date.now() - this.testStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        $('#dash-test-runtime').textContent = `${mins}分${secs}秒`;

        try {
            const r = await window.electronAPI.testStatus();
            if (r.success) {
                const d = r.data;
                $('#dash-test-runtime-vus').textContent = d.currentVUs !== undefined ? d.currentVUs : '--';
                $('#dash-test-runtime-script').textContent = d.currentTarget || '-';
            }
        } catch (e) { /* ignore */ }

        try {
            const r = await window.electronAPI.monitorMetrics();
            if (r.success && r.data) {
                const m = r.data;
                $('#dash-test-runtime-target').textContent = m.tps !== undefined ? m.tps : '--';
                $('#dash-test-runtime-latency').textContent = m.latency !== undefined ? m.latency + 'ms' : '--';
            }
        } catch (e) { /* ignore */ }
    },

    // ─── 图表渲染（仪表盘）───
    renderCpuChart() {
        const ctx = $('#dash-cpu-chart');
        if (!ctx) return;
        if (this.systemStatsHistory.length < 2) return;

        const labels = this.systemStatsHistory.map(s => s.time);
        const cpuData = this.systemStatsHistory.map(s => s.cpu);

        if (this.cpuChart) {
            this.cpuChart.data.labels = labels;
            this.cpuChart.data.datasets[0].data = cpuData;
            this.cpuChart.update('none');
        } else {
            this.cpuChart = new Chart(ctx.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'CPU %',
                        data: cpuData,
                        borderColor: '#f87171',
                        backgroundColor: 'rgba(248,113,113,0.12)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#64748b', maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { color: '#334155' } },
                        y: { min: 0, max: 100, ticks: { color: '#64748b' }, grid: { color: '#334155' } }
                    }
                }
            });
        }
    },

    renderMemoryChart() {
        const ctx = $('#dash-mem-chart');
        if (!ctx) return;
        if (this.systemStatsHistory.length < 2) return;

        const labels = this.systemStatsHistory.map(s => s.time);
        const memData = this.systemStatsHistory.map(s => s.memory);

        if (this.memChart) {
            this.memChart.data.labels = labels;
            this.memChart.data.datasets[0].data = memData;
            this.memChart.update('none');
        } else {
            this.memChart = new Chart(ctx.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: '内存 %',
                        data: memData,
                        borderColor: '#60a5fa',
                        backgroundColor: 'rgba(96,165,250,0.12)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: '#64748b', maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { color: '#334155' } },
                        y: { min: 0, max: 100, ticks: { color: '#64748b' }, grid: { color: '#334155' } }
                    }
                }
            });
        }
    },

    // ═══════════════════════════════════════════════
    //  通用工具方法
    // ═══════════════════════════════════════════════
    formatUptime(seconds) {
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return `${d}天${h}小时`;
        if (h > 0) return `${h}小时${m}分`;
        return `${m}分钟`;
    },

    escapeHtml(str) {
        if (typeof str !== 'string') return str;
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    async openReport(filePath) {
        try {
            const r = await window.electronAPI.shellOpenPath(filePath);
            if (r.success) {
                toast('报告已在浏览器中打开', 'success');
            } else {
                toast('打开报告失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('打开报告异常: ' + e.message, 'error');
        }
    },

    // ─── 版本 ───
    loadVersion() {
        try {
            const v = window.electronAPI.versions;
            $('#versionInfo').innerHTML = `<div>Node ${v.node()}</div><div>Electron ${v.electron()}</div>`;
        } catch (e) {
            $('#versionInfo').textContent = '';
        }
    }
};

// 暴露到全局供 HTML 内联事件调用
window.App = App;

// 启动
document.addEventListener('DOMContentLoaded', () => App.init().catch(console.error));
