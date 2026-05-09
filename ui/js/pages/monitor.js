/**
 * 实时监控页面
 */

Object.assign(App, {
    monitorPollTimer: null,

    async loadMonitor() {
        this._switchMonitorChartView(this.monitorChartView || 'time');
        this.initMonitorChart();
        this._renderMonitorTabs();
        const activeTab = this.monitorActiveTabId ? this.monitorTabs[this.monitorActiveTabId] : null;
        if (activeTab && activeTab.history) {
            this._renderMonitorTabContent(activeTab);
        }
        await this.pollMonitorRealtime();
        if (this.monitorPollTimer) clearInterval(this.monitorPollTimer);
        this.monitorPollTimer = setInterval(() => {
            if (this.currentPage === 'monitor') this.pollMonitorRealtime();
        }, 2000);
    },

    initMonitorChart() {
        const canvas = document.getElementById('mon-chart');
        if (!canvas) return;
        if (this.monitorChart) {
            this.monitorChart.destroy();
        }

        const isVusView = this.monitorChartView === 'vus';

        if (isVusView) {
            this.monitorChart = new Chart(canvas, {
                type: 'line',
                data: { labels: [], datasets: [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15,23,42,0.95)',
                            titleColor: '#e2e8f0',
                            bodyColor: '#cbd5e1',
                            borderColor: '#334155',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            ticks: { color: '#64748b' },
                            grid: { color: '#334155' },
                            title: { display: true, text: 'VUs', color: '#94a3b8' }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            ticks: { color: '#ef4444' },
                            grid: { color: '#334155' },
                            title: { display: true, text: '延迟(ms)', color: '#ef4444' }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            ticks: { color: '#22c55e' },
                            grid: { drawOnChartArea: false },
                            title: { display: true, text: 'RPS', color: '#22c55e' }
                        },
                        y2: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            ticks: { color: '#f59e0b' },
                            grid: { drawOnChartArea: false },
                            title: { display: true, text: '百分比(%)', color: '#f59e0b' }
                        }
                    },
                    animation: { duration: 0 }
                }
            });
        } else {
            this.monitorChart = new Chart(canvas, {
                type: 'line',
                data: { labels: [], datasets: [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15,23,42,0.95)',
                            titleColor: '#e2e8f0',
                            bodyColor: '#cbd5e1',
                            borderColor: '#334155',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        x: {
                            ticks: { color: '#64748b', maxTicksLimit: 8 },
                            grid: { color: '#334155' }
                        },
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            ticks: { color: '#3b82f6' },
                            grid: { color: '#334155' },
                            title: { display: true, text: 'VUs', color: '#3b82f6' }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            ticks: { color: '#ef4444' },
                            grid: { drawOnChartArea: false },
                            title: { display: true, text: '延迟(ms) / RPS', color: '#ef4444' }
                        },
                        y2: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            ticks: { color: '#f59e0b' },
                            grid: { drawOnChartArea: false },
                            title: { display: true, text: '百分比(%)', color: '#f59e0b' }
                        }
                    },
                    animation: { duration: 0 }
                }
            });
        }
    },

    _smoothArray(arr, windowSize = 5) {
        if (!this.monitorSmoothEnabled || arr.length < 3) return arr;
        const half = Math.floor(windowSize / 2);
        return arr.map((v, i) => {
            let sum = 0, count = 0;
            for (let j = -half; j <= half; j++) {
                const idx = i + j;
                if (idx >= 0 && idx < arr.length) {
                    sum += arr[idx];
                    count++;
                }
            }
            return sum / count;
        });
    },

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

    _updateMonitorChart(history, target) {
        if (!this.monitorChart || !history) return;
        const vus = history.vus || [];
        const latency = history.latency || [];
        const rps = history.rps || [];
        const errors = history.errors || [];
        const resources = history.resources || [];
        if (vus.length === 0) return;

        const isVusView = this.monitorChartView === 'vus';
        const smooth = (arr) => this._smoothArray(arr);

        if (isVusView) {
            const rawData = vus.map((p, i) => ({
                x: p.v,
                latency: latency[i] ? latency[i].v : 0,
                rps: rps[i] ? rps[i].v : 0,
                errorRate: errors[i] ? errors[i].v : 0,
                resource: resources[i] ? (resources[i][target] || resources[i].cpu || 0) : 0
            }));

            const lastByX = new Map();
            for (let i = 0; i < rawData.length; i++) {
                lastByX.set(rawData[i].x, {
                    x: rawData[i].x,
                    latency: rawData[i].latency,
                    rps: rawData[i].rps,
                    errorRate: rawData[i].errorRate,
                    resource: rawData[i].resource,
                    idx: i
                });
            }
            const data = Array.from(lastByX.values()).sort((a, b) => a.x - b.x);

            const smoothLatency = smooth(data.map(d => d.latency));
            const smoothRps     = smooth(data.map(d => d.rps));
            const smoothErrors  = smooth(data.map(d => d.errorRate));
            const smoothRes     = smooth(this._interpolateZeroValues(data.map(d => d.resource)));

            const resourceLabel = this._getResourceLabel(target);
            const resourceColor = this._getResourceColor(target);
            const badge = $('#mon-resource-badge');
            if (badge) {
                badge.textContent = `── ${resourceLabel}`;
                badge.style.background = resourceColor;
            }

            this.monitorChart.data.labels = [];
            this.monitorChart.data.datasets = [
                {
                    label: '延迟(ms)',
                    data: data.map((d, i) => ({ x: d.x, y: smoothLatency[i] })),
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239,68,68,0.1)',
                    yAxisID: 'y',
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: 'RPS',
                    data: data.map((d, i) => ({ x: d.x, y: smoothRps[i] })),
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34,197,94,0.1)',
                    yAxisID: 'y1',
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: '错误率(%)',
                    data: data.map((d, i) => ({ x: d.x, y: smoothErrors[i] })),
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245,158,11,0.1)',
                    yAxisID: 'y2',
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2
                },
                {
                    label: resourceLabel,
                    data: data.map((d, i) => ({ x: d.x, y: smoothRes[i] })),
                    borderColor: resourceColor,
                    backgroundColor: resourceColor + '1a',
                    yAxisID: 'y2',
                    tension: 0.3,
                    pointRadius: 2,
                    borderWidth: 2
                }
            ];
        } else {
            const labels = vus.map(p => {
                const d = new Date(p.t);
                return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
            });

            const smoothVus     = smooth(vus.map(p => p.v));
            const smoothLatency = smooth(latency.map(p => p.v));
            const smoothRps     = smooth(rps.map(p => p.v));
            const smoothErrors  = smooth(this._interpolateZeroValues(errors.map(p => p.v || 0)));
            const rawResources  = resources.map(r => (r && r[target] !== undefined) ? r[target] : (r && r.cpu !== undefined ? r.cpu : 0));
            const smoothRes     = smooth(this._interpolateZeroValues(rawResources));

            this.monitorChart.data.labels = labels;
            const datasets = [
                {
                    label: 'VUs',
                    data: smoothVus,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.1)',
                    yAxisID: 'y',
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                },
                {
                    label: '延迟(ms)',
                    data: smoothLatency,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239,68,68,0.1)',
                    yAxisID: 'y1',
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                },
                {
                    label: 'RPS',
                    data: smoothRps,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34,197,94,0.1)',
                    yAxisID: 'y1',
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                }
            ];

            // 错误率数据集（只要有错误率数据就展示）
            if (errors.length > 0) {
                datasets.push({
                    label: '错误率(%)',
                    data: smoothErrors,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245,158,11,0.1)',
                    yAxisID: 'y2',
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2
                });
            }

            // 资源指标数据集
            const resourceLabel = this._getResourceLabel(target);
            const resourceColor = this._getResourceColor(target);
            datasets.push({
                label: resourceLabel,
                data: smoothRes,
                borderColor: resourceColor,
                backgroundColor: resourceColor + '1a',
                yAxisID: 'y2',
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2
            });

            this.monitorChart.data.datasets = datasets;
        }

        this.monitorChart.update('none');
    },

    async pollMonitorRealtime() {
        try {
            const r = await window.electronAPI.monitorStatus();
            if (r.success) {
                const s = r.data;
                const session2Id = s.session2Id;
                const target = s.target || 'unknown';

                if (session2Id && session2Id !== this.monitorCurrentSession2Id) {
                    if (this.monitorActiveTabId && this.monitorTabs[this.monitorActiveTabId]) {
                        this.monitorTabs[this.monitorActiveTabId].sealed = true;
                        this._renderMonitorTabs();
                    }
                    this.monitorCurrentSession2Id = session2Id;
                    const tabId = `${session2Id}_${target}`;
                    if (!this.monitorTabs[tabId]) {
                        this._createMonitorTab(tabId, target, session2Id);
                    }
                    this._switchMonitorTab(tabId);
                }

                const activeTab = this.monitorActiveTabId ? this.monitorTabs[this.monitorActiveTabId] : null;
                if (activeTab && !activeTab.sealed && s.history) {
                    activeTab.history = s.history;
                    activeTab.target = target;
                    activeTab.sessionId = s.sessionId;
                    activeTab.session2Id = session2Id;
                    activeTab.status = {
                        isMonitoring: s.isMonitoring,
                        mode: s.mode,
                        currentVUs: s.currentVUs,
                        dataPoints: s.dataPoints,
                        algorithm: s.algorithm,
                        detectedOptimal: s.detectedOptimal,
                        detectedMax: s.detectedMax,
                        optimalPoint: s.optimalPoint,
                        maxPoint: s.maxPoint
                    };
                }

                if (this.currentPage === 'monitor' && activeTab) {
                    this._renderMonitorTabContent(activeTab);
                }
            }
        } catch (e) { console.error('pollMonitorRealtime error:', e); }
    },

    _createMonitorTab(tabId, target, session2Id) {
        this.monitorTabs[tabId] = {
            id: tabId,
            target: target,
            session2Id: session2Id,
            sessionId: null,
            history: { vus: [], latency: [], rps: [], errors: [], resources: [] },
            sealed: false,
            label: `${target}`
        };
        this._renderMonitorTabs();
    },

    _switchMonitorTab(tabId) {
        if (!this.monitorTabs[tabId]) return;
        this.monitorActiveTabId = tabId;
        this._renderMonitorTabs();
        const tab = this.monitorTabs[tabId];
        if (tab && tab.history) {
            this._updateMonitorChart(tab.history, tab.target);
        }
    },

    _renderMonitorTabs() {
        const container = $('#mon-tabs-bar');
        if (!container) return;
        const ids = Object.keys(this.monitorTabs);
        if (ids.length === 0) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = ids.map(id => {
            const tab = this.monitorTabs[id];
            const isActive = id === this.monitorActiveTabId;
            const sealClass = tab.sealed ? ' sealed' : '';
            return `<div class="mon-tab${isActive ? ' active' : ''}${sealClass}" data-tab-id="${id}">
                <span>${tab.label}</span>
                <span class="mon-tab-close" data-tab-id="${id}" title="关闭">×</span>
            </div>`;
        }).join('');

        container.querySelectorAll('.mon-tab').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.classList.contains('mon-tab-close')) {
                    e.stopPropagation();
                    const id = e.target.dataset.tabId;
                    delete this.monitorTabs[id];
                    const remaining = Object.keys(this.monitorTabs);
                    if (remaining.length > 0) {
                        this._switchMonitorTab(remaining[remaining.length - 1]);
                    } else {
                        this.monitorActiveTabId = null;
                        this.monitorCurrentSession2Id = null;
                        container.innerHTML = '';
                        this.initMonitorChart();
                    }
                } else {
                    this._switchMonitorTab(el.dataset.tabId);
                }
            });
        });
    },

    _renderMonitorTabContent(tab) {
        if (!tab) return;
        const s = tab.status || {};
        const elRunning = $('#mon-running');
        const elMode = $('#mon-mode');
        const elVus = $('#mon-vus');
        const elPoints = $('#mon-points');
        const elSessionId = $('#mon-session-id');
        const elSession2Id = $('#mon-session2-id');
        const elAlgorithm = $('#mon-algorithm');
        if (elRunning) elRunning.textContent = s.isMonitoring ? '运行中' : '已停止';
        if (elMode) elMode.textContent = s.mode || '--';
        if (elVus) elVus.textContent = s.currentVUs || 0;
        if (elPoints) elPoints.textContent = s.dataPoints || 0;
        if (elSessionId) elSessionId.textContent = tab.sessionId || '--';
        if (elSession2Id) elSession2Id.textContent = tab.session2Id || '--';
        if (elAlgorithm) elAlgorithm.textContent = s.algorithm || '--';

        const optimalCard = $('#mon-optimal-card');
        const maxCard = $('#mon-max-card');
        const placeholder = $('#mon-inflection-placeholder');
        if (s.detectedOptimal && s.optimalPoint) {
            optimalCard.style.display = 'block';
            $('#mon-optimal-body').innerHTML = `
                <div class="info-item"><span class="info-label">VUs:</span><span class="info-value">${s.optimalPoint.vus || '--'}</span></div>
                <div class="info-item"><span class="info-label">RPS:</span><span class="info-value">${s.optimalPoint.rps || '--'}</span></div>
                <div class="info-item"><span class="info-label">延迟:</span><span class="info-value">${s.optimalPoint.latency || '--'}ms</span></div>
            `;
        } else {
            optimalCard.style.display = 'none';
        }
        if (s.detectedMax && s.maxPoint) {
            maxCard.style.display = 'block';
            $('#mon-max-body').innerHTML = `
                <div class="info-item"><span class="info-label">VUs:</span><span class="info-value">${s.maxPoint.vus || '--'}</span></div>
                <div class="info-item"><span class="info-label">RPS:</span><span class="info-value">${s.maxPoint.rps || '--'}</span></div>
                <div class="info-item"><span class="info-label">延迟:</span><span class="info-value">${s.maxPoint.latency || '--'}ms</span></div>
            `;
        } else {
            maxCard.style.display = 'none';
        }
        if (placeholder) {
            placeholder.style.display = (s.detectedOptimal || s.detectedMax) ? 'none' : 'block';
        }

        if (!tab.sealed && tab.history) {
            this._updateMonitorChart(tab.history, tab.target);
        }
    },

    _switchMonitorChartView(view) {
        if (this.monitorChartView === view) return;
        this.monitorChartView = view;
        $('#mon-view-time').style.opacity = view === 'time' ? '1' : '0.5';
        $('#mon-view-time').style.fontWeight = view === 'time' ? 'bold' : 'normal';
        $('#mon-view-vus').style.opacity = view === 'vus' ? '1' : '0.5';
        $('#mon-view-vus').style.fontWeight = view === 'vus' ? 'bold' : 'normal';
        $('#mon-chart-legend-time').style.display = view === 'time' ? 'block' : 'none';
        $('#mon-chart-legend-vus').style.display = view === 'vus' ? 'block' : 'none';
        this.initMonitorChart();
        const activeTab = this.monitorActiveTabId ? this.monitorTabs[this.monitorActiveTabId] : null;
        if (activeTab && activeTab.history) {
            this._updateMonitorChart(activeTab.history, activeTab.target);
        }
    },

    _getResourceLabel(target) {
        const map = { cpu: 'CPU(%)', memory: '内存(%)', io: 'IO(%)', disk: '磁盘(%)' };
        return map[target] || '资源(%)';
    },

    _getResourceColor(target) {
        const map = { cpu: '#f59e0b', memory: '#8b5cf6', io: '#06b6d4', disk: '#ec4899' };
        return map[target] || '#94a3b8';
    }
});
