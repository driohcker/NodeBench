/**
 * 测试管理页面
 */

Object.assign(App, {
    testRawMetrics: {},
    testRawChart: null,
    testRawSmoothEnabled: false,
    testRawSpikeEnabled: true,
    testRawSelectedMetrics: new Set(['http_req_duration']),
    _testRawMetricHandler: null,
    _testRawChartUpdateTimer: null,

    async loadTest() {
        await this.pollTest();
        this._initTestRawChart();
        this._setupTestRawMetricListener();
        try {
            const r = await window.electronAPI.configGet();
            if (r.success && r.data.test) {
                const t = r.data.test;
                $('#test-init-vus').value = t.initVUs ?? 1;
                $('#test-max-vus').value = t.maxVUs ?? 400;
                $('#test-duration').value = t.duration ?? '6s';
                $('#test-wait-period').value = t.waitPeriod ?? 5;
                $('#test-max-vu-increment').value = t.maxVuIncrement ?? 100;
                $('#test-output-mode').value = t.outputMode ?? 'file';
                const targets = t.testTargets || ['cpu'];
                $$('#test-targets-group input[type="checkbox"]').forEach(cb => {
                    cb.checked = targets.includes(cb.value);
                });
            }
            if (r.success && r.data.monitor) {
                const m = r.data.monitor;
                const sel = $('#test-analysis-strategy-select');
                if (sel && m.algorithm) {
                    sel.value = m.algorithm;
                }
            }
            // 加载策略默认参数
            if (r.success && r.data.strategies) {
                this._loadStrategyDefaults(r.data.strategies);
            }
            // 加载大波动过滤器配置
            if (r.success && r.data.test?.spikeFilter) {
                this._loadSpikeFilterSettings(r.data.test.spikeFilter);
            }
        } catch (e) { /* ignore */ }
        this.onTestModeChange();
        this.onStrategyChange();
    },

    _loadSpikeFilterSettings(spike) {
        $('#test-spike-enabled').value = String(spike.enabled !== false);
        $('#test-spike-windowSize').value = spike.windowSize ?? 10;
        $('#test-spike-threshold').value = spike.threshold ?? 3.0;
        $('#test-spike-minAbsoluteThreshold').value = spike.minAbsoluteThreshold ?? 10;
        $('#test-spike-minHistory').value = spike.minHistory ?? 3;
        const metrics = spike.metrics || ['http_reqs', 'http_req_duration'];
        $$('#test-spike-metrics input[type="checkbox"]').forEach(cb => {
            cb.checked = metrics.includes(cb.value);
        });
    },

    _getSpikeFilterSettings() {
        const metrics = Array.from($$('#test-spike-metrics input[type="checkbox"]:checked')).map(cb => cb.value);
        return {
            enabled: $('#test-spike-enabled').value === 'true',
            windowSize: parseInt($('#test-spike-windowSize').value, 10),
            threshold: parseFloat($('#test-spike-threshold').value),
            minAbsoluteThreshold: parseInt($('#test-spike-minAbsoluteThreshold').value, 10),
            minHistory: parseInt($('#test-spike-minHistory').value, 10),
            metrics: metrics.length > 0 ? metrics : ['http_reqs', 'http_req_duration']
        };
    },

    async saveSpikeFilterConfig() {
        try {
            const spikeFilter = this._getSpikeFilterSettings();
            const changes = {
                'test.spikeFilter.enabled': spikeFilter.enabled,
                'test.spikeFilter.windowSize': spikeFilter.windowSize,
                'test.spikeFilter.threshold': spikeFilter.threshold,
                'test.spikeFilter.minAbsoluteThreshold': spikeFilter.minAbsoluteThreshold,
                'test.spikeFilter.minHistory': spikeFilter.minHistory,
                'test.spikeFilter.metrics': spikeFilter.metrics
            };
            const r = await window.electronAPI.configSet(changes);
            if (r.success) {
                toast('过滤器配置已保存到配置文件', 'success');
            } else {
                toast('保存过滤器配置失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('保存过滤器配置异常: ' + e.message, 'error');
        }
    },

    async resetSpikeFilterConfig() {
        try {
            const r = await window.electronAPI.configGet();
            if (r.success && r.data.test?.spikeFilter) {
                this._loadSpikeFilterSettings(r.data.test.spikeFilter);
                toast('过滤器配置已重置为当前配置文件值', 'info');
            } else {
                // 回退到硬编码默认值
                this._loadSpikeFilterSettings({});
                toast('过滤器配置已重置为默认值', 'info');
            }
        } catch (e) {
            toast('重置过滤器配置失败: ' + e.message, 'error');
        }
    },

    _loadStrategyDefaults(strategies) {
        const map = {
            doubleWindow: { key: 'DoubleWindowStrategy', params: ['windowSize', 'optimalThreshold', 'maxThreshold', 'sustainCount', 'minDataPoints'] },
            cusum: { key: 'CusumStrategy', params: ['windowSize', 'optimalRatio', 'maxRatio', 'sustainCount', 'minDataPoints'] },
            slopeChange: { key: 'SlopeChangeStrategy', params: ['windowSize', 'optimalSlopeMultiplier', 'maxSlopeMultiplier', 'sustainCount', 'minDataPoints'] }
        };
        for (const [algo, info] of Object.entries(map)) {
            const conf = strategies[info.key];
            if (!conf) continue;
            const panel = $(`#strategy-params-${algo}`);
            if (!panel) continue;
            info.params.forEach(p => {
                const input = panel.querySelector(`[data-param="${p}"]`);
                if (input && conf[p] !== undefined) {
                    input.value = conf[p];
                }
            });
        }
    },

    onTestModeChange() {
        const autoMode = $('#test-auto-mode').value;
        const strategyGroup = $('#test-analysis-strategy-group');
        const paramsGroup = $('#test-strategy-params-group');
        if (strategyGroup) {
            strategyGroup.style.display = autoMode === 'auto' ? 'block' : 'none';
        }
        if (paramsGroup) {
            paramsGroup.style.display = autoMode === 'auto' ? 'block' : 'none';
        }
        if (autoMode === 'auto') {
            this.onStrategyChange();
        }
    },

    onStrategyChange() {
        const algo = $('#test-analysis-strategy-select')?.value || 'doubleWindow';
        $$('.strategy-params-panel').forEach(el => el.style.display = 'none');
        const panel = $(`#strategy-params-${algo}`);
        if (panel) panel.style.display = 'block';
    },

    _getStrategyParams() {
        const algo = $('#test-analysis-strategy-select')?.value || 'doubleWindow';
        const panel = $(`#strategy-params-${algo}`);
        if (!panel) return null;
        const params = {};
        panel.querySelectorAll('.strategy-param').forEach(input => {
            const key = input.dataset.param;
            const val = input.value;
            if (input.type === 'number') {
                params[key] = input.step && input.step.includes('.') ? parseFloat(val) : parseInt(val, 10);
            } else {
                params[key] = val;
            }
        });
        return params;
    },

    _setTestConfigLocked(locked) {
        // 锁定测试配置卡片
        const testCardBody = $('#page-test .card:first-child .card-body');
        if (testCardBody) {
            const inputs = testCardBody.querySelectorAll('input, select, textarea');
            inputs.forEach(el => {
                // 重置按钮始终可点
                if (el.closest('#test-reset-btn')) return;
                el.disabled = locked;
            });
            testCardBody.classList.toggle('locked', locked);
        }
        // 锁定过滤器配置卡片
        const filterCardBody = $('#test-spike-filter-card-body');
        if (filterCardBody) {
            const inputs = filterCardBody.querySelectorAll('input, select, textarea');
            inputs.forEach(el => { el.disabled = locked; });
            filterCardBody.classList.toggle('locked', locked);
        }
    },

    _updateTestActionButton(isRunning) {
        const btn = $('#test-action-btn');
        if (!btn) return;
        if (isRunning) {
            btn.textContent = '■ 停止测试';
            btn.className = 'btn btn-danger';
            btn.dataset.action = 'stop';
        } else {
            btn.textContent = '▶ 启动测试';
            btn.className = 'btn btn-success';
            btn.dataset.action = 'start';
        }
    },

    async onTestAction() {
        const btn = $('#test-action-btn');
        const action = btn?.dataset.action || 'start';
        if (action === 'start') {
            await this.startTest();
        } else {
            await this.stopTest();
        }
    },

    _getTestTargets() {
        const checkboxes = $$('#test-targets-group input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    },

    _initTestRawChart() {
        const canvas = document.getElementById('test-raw-chart');
        if (!canvas) return;
        if (this.testRawChart) {
            this.testRawChart.destroy();
        }
        this.testRawChart = new Chart(canvas, {
            type: 'line',
            data: { datasets: [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#ffffff',
                        titleColor: '#1e293b',
                        bodyColor: '#64748b',
                        borderColor: '#e2e8f0',
                        borderWidth: 1
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        ticks: { color: '#64748b' },
                        grid: { color: '#e2e8f0' },
                        title: { display: true, text: 'VUs', color: '#64748b' }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        ticks: { color: '#ef4444' },
                        grid: { color: '#e2e8f0' },
                        title: { display: true, text: '数值', color: '#ef4444' }
                    }
                },
                animation: { duration: 0 }
            }
        });
    },

    _setupTestRawMetricListener() {
        if (this._testRawMetricHandler) {
            try {
                window.electronAPI.offTestRawMetric(this._testRawMetricHandler);
            } catch (e) {}
        }
        this._testRawMetricHandler = (data) => {
            if (!data || !data.metric || data.value === undefined) return;
            const allowed = ['http_req_duration', 'http_reqs', 'http_req_failed', 'vus'];
            if (!allowed.includes(data.metric)) return;
            if (!this.testRawMetrics[data.metric]) {
                this.testRawMetrics[data.metric] = [];
            }
            this.testRawMetrics[data.metric].push({
                vu: data.currentVUs || 0,
                value: data.value,
                time: data.time
            });
            // 限制单指标数据量，防止内存溢出
            if (this.testRawMetrics[data.metric].length > 50000) {
                this.testRawMetrics[data.metric] = this.testRawMetrics[data.metric].slice(-40000);
            }
            if (this.currentPage === 'test') {
                this._throttledUpdateTestRawChart();
            }
        };
        window.electronAPI.onTestRawMetric(this._testRawMetricHandler);
    },

    _throttledUpdateTestRawChart() {
        if (this._testRawChartUpdateTimer) return;
        this._testRawChartUpdateTimer = setTimeout(() => {
            this._testRawChartUpdateTimer = null;
            this._updateTestRawChart();
        }, 500);
    },

    _aggregateTestRawByVu(metricData) {
        if (!metricData || metricData.length === 0) return [];
        const byVu = new Map();
        for (const pt of metricData) {
            const vu = pt.vu;
            if (!byVu.has(vu)) {
                byVu.set(vu, []);
            }
            byVu.get(vu).push(pt.value);
        }
        const result = [];
        for (const [vu, values] of byVu) {
            values.sort((a, b) => a - b);
            const mid = Math.floor(values.length / 2);
            const median = values.length % 2 === 0
                ? (values[mid - 1] + values[mid]) / 2
                : values[mid];
            result.push({ x: vu, y: median });
        }
        return result.sort((a, b) => a.x - b.x);
    },

    _spikeFilterTestRaw(arr, windowSize = 10, threshold = 3.0, minAbsoluteThreshold = 10, minHistory = 3) {
        if (!this.testRawSpikeEnabled || arr.length < minHistory) return arr;
        const history = [];
        return arr.map((pt) => {
            if (history.length < minHistory) {
                history.push(pt.y);
                if (history.length > windowSize) history.shift();
                return pt;
            }
            const sorted = [...history].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            const median = sorted.length % 2 === 0
                ? (sorted[mid - 1] + sorted[mid]) / 2
                : sorted[mid];
            if (median === 0) {
                history.push(pt.y);
                if (history.length > windowSize) history.shift();
                return pt;
            }
            const deviation = Math.abs(pt.y - median);
            const relativeDeviation = deviation / median;
            if (relativeDeviation > threshold && deviation > minAbsoluteThreshold) {
                history.push(median);
                if (history.length > windowSize) history.shift();
                return { ...pt, y: median };
            }
            history.push(pt.y);
            if (history.length > windowSize) history.shift();
            return pt;
        });
    },

    _smoothTestRawArray(arr, windowSize = 5) {
        if (!this.testRawSmoothEnabled || arr.length < 3) return arr;
        const half = Math.floor(windowSize / 2);
        return arr.map((pt, i) => {
            let sum = 0, count = 0;
            for (let j = -half; j <= half; j++) {
                const idx = i + j;
                if (idx >= 0 && idx < arr.length) {
                    sum += arr[idx].y;
                    count++;
                }
            }
            return { ...pt, y: sum / count };
        });
    },

    _updateTestRawChart() {
        if (!this.testRawChart) return;
        const colors = {
            http_req_duration: '#ef4444',
            http_reqs: '#22c55e',
            vus: '#3b82f6',
            http_req_failed: '#f59e0b'
        };
        const labels = {
            http_req_duration: '延迟(ms)',
            http_reqs: '请求数',
            vus: 'VUs',
            http_req_failed: '失败数'
        };
        const datasets = [];
        for (const metric of this.testRawSelectedMetrics) {
            const rawData = this.testRawMetrics[metric];
            if (!rawData || rawData.length === 0) continue;
            let aggregated = this._aggregateTestRawByVu(rawData);
            if (aggregated.length === 0) continue;
            aggregated = this._spikeFilterTestRaw(aggregated);
            aggregated = this._smoothTestRawArray(aggregated);
            datasets.push({
                label: labels[metric] || metric,
                data: aggregated,
                borderColor: colors[metric] || '#64748b',
                backgroundColor: (colors[metric] || '#64748b') + '1a',
                yAxisID: 'y',
                tension: 0.3,
                pointRadius: 2,
                borderWidth: 2
            });
        }
        this.testRawChart.data.datasets = datasets;
        this.testRawChart.update('none');
    },

    /**
     * 启动测试
     * @param {Object} opts
     * @param {boolean} opts.useTempParams - 是否使用测试管理页面的临时参数覆盖配置文件。
     *                                       true=使用表单临时参数（测试管理页面）；
     *                                       false=使用配置文件默认值（仪表盘页面）
     */
    async startTest({ useTempParams = true } = {}) {
        const targets = useTempParams ? this._getTestTargets() : undefined;
        if (useTempParams && targets.length === 0) {
            toast('请至少选择一个测试目标', 'warn');
            return;
        }
        const outputMode = useTempParams ? $('#test-output-mode').value : undefined;
        const autoMode = $('#test-auto-mode').value;
        const algorithm = useTempParams ? ($('#test-analysis-strategy-select')?.value || 'doubleWindow') : undefined;
        const strategyParams = useTempParams ? this._getStrategyParams() : undefined;

        const btn = $('#test-action-btn');
        if (btn) btn.disabled = true;
        $('#test-log-output').textContent = '测试启动中...\n';

        try {
            if (autoMode === 'auto') {
                const options = {
                    targets,
                    outputMode,
                    algorithm,
                    initVUs: useTempParams ? parseInt($('#test-init-vus').value, 10) : undefined,
                    maxVUs: useTempParams ? parseInt($('#test-max-vus').value, 10) : undefined,
                    duration: useTempParams ? $('#test-duration').value : undefined,
                    waitPeriod: useTempParams ? parseInt($('#test-wait-period').value, 10) : undefined,
                    maxVuIncrement: useTempParams ? parseInt($('#test-max-vu-increment').value, 10) : undefined,
                    strategyParams
                };
                const r = await window.electronAPI.autoStart(options);
                if (r.success) {
                    toast('✅ 自动化测试流程已完成', 'success');
                } else {
                    toast('自动化测试失败: ' + r.error, 'error');
                }
            } else {
                const overrides = {
                    initVUs: useTempParams ? parseInt($('#test-init-vus').value, 10) : undefined,
                    maxVUs: useTempParams ? parseInt($('#test-max-vus').value, 10) : undefined,
                    duration: useTempParams ? $('#test-duration').value : undefined,
                    testTargets: targets,
                    outputMode: outputMode,
                    waitPeriod: useTempParams ? parseInt($('#test-wait-period').value, 10) : undefined,
                    maxVuIncrement: useTempParams ? parseInt($('#test-max-vu-increment').value, 10) : undefined
                };
                const r = await window.electronAPI.testStart(overrides);
                if (r.success) {
                    toast('测试已启动', 'info');
                } else {
                    toast('启动失败: ' + r.error, 'error');
                }
            }
        } catch (e) {
            toast('启动异常: ' + e.message, 'error');
        }
        setTimeout(() => {
            if (btn) btn.disabled = false;
            this.pollTest();
        }, 1000);
    },

    async _autoStartMonitor(sessionId, outputMode) {
        try {
            const testR = await window.electronAPI.testStatus();
            if (!testR.success || !testR.data.isRunning) {
                toast('测试未在运行，自动监测取消', 'warn');
                return;
            }
            const currentSession2Id = testR.data.currentSession2Id;
            if (!currentSession2Id) {
                toast('测试尚未生成子流程ID，稍后重试自动监测', 'warn');
                setTimeout(() => this._autoStartMonitor(sessionId, outputMode), 1500);
                return;
            }
            const monitorMode = outputMode === 'pipe' ? 'pipe' : 'tail';
            let source;
            if (monitorMode === 'tail') {
                source = `data/test/${sessionId}/${currentSession2Id}/metrics.json`;
            } else {
                source = 'pipe';
            }
            const algorithm = $('#test-analysis-strategy-select')?.value || 'doubleWindow';
            const strategyParams = this._getStrategyParams();
            const cmd = await window.electronAPI.monitorStart(sessionId, currentSession2Id, source, { algorithm, strategyParams });
            if (cmd.success) {
                toast('🤖 自动化监测已启动', 'success');
            } else {
                toast('自动监测启动失败: ' + cmd.error, 'error');
            }
        } catch (e) {
            toast('自动监测异常: ' + e.message, 'error');
        }
    },

    async resetTestConfig() {
        try {
            const r = await window.electronAPI.configGet();
            if (r.success && r.data.test) {
                const t = r.data.test;
                $('#test-init-vus').value = t.initVUs ?? 1;
                $('#test-max-vus').value = t.maxVUs ?? 400;
                $('#test-duration').value = t.duration ?? '6s';
                $('#test-wait-period').value = t.waitPeriod ?? 5;
                $('#test-max-vu-increment').value = t.maxVuIncrement ?? 100;
                $('#test-output-mode').value = t.outputMode ?? 'file';
                const targets = t.testTargets || ['cpu'];
                $$('#test-targets-group input[type="checkbox"]').forEach(cb => {
                    cb.checked = targets.includes(cb.value);
                });
            }
            if (r.success && r.data.strategies) {
                this._loadStrategyDefaults(r.data.strategies);
            }
            if (r.success && r.data.monitor) {
                const m = r.data.monitor;
                const sel = $('#test-analysis-strategy-select');
                if (sel && m.algorithm) {
                    sel.value = m.algorithm;
                }
            }
            if (r.success && r.data.test?.spikeFilter) {
                this._loadSpikeFilterSettings(r.data.test.spikeFilter);
            }
            this.onStrategyChange();
            toast('配置已重置为默认值', 'info');
        } catch (e) {
            toast('重置配置失败: ' + e.message, 'error');
        }
    },

    async stopTest() {
        const btn = $('#test-action-btn');
        if (btn) btn.disabled = true;
        try {
            const r = await window.electronAPI.testStop();
            toast(r.success ? '测试已停止' : '停止失败: ' + r.error, r.success ? 'info' : 'error');
        } catch (e) {
            toast('停止异常: ' + e.message, 'error');
        }
        setTimeout(() => {
            if (btn) btn.disabled = false;
            this.pollTest();
        }, 1000);
    },

    async resetTest() {
        $('#test-reset-btn').disabled = true;
        try {
            const r = await window.electronAPI.testReset();
            toast(r.success ? '已发送重置信号' : '重置失败: ' + r.error, r.success ? 'info' : 'error');
        } catch (e) {
            toast('重置异常: ' + e.message, 'error');
        }
        setTimeout(() => {
            $('#test-reset-btn').disabled = false;
        }, 1000);
    }
});
