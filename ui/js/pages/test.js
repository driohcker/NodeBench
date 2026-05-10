/**
 * 测试管理页面
 */

Object.assign(App, {
    async loadTest() {
        await this.pollTest();
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

    async startTest() {
        const targets = this._getTestTargets();
        if (targets.length === 0) {
            toast('请至少选择一个测试目标', 'warn');
            return;
        }
        const outputMode = $('#test-output-mode').value;
        const autoMode = $('#test-auto-mode').value;
        const algorithm = $('#test-analysis-strategy-select')?.value || 'doubleWindow';
        const strategyParams = this._getStrategyParams();

        const btn = $('#test-action-btn');
        if (btn) btn.disabled = true;
        $('#test-log-output').textContent = '测试启动中...\n';

        try {
            if (autoMode === 'auto') {
                const options = {
                    targets,
                    outputMode,
                    algorithm,
                    initVUs: parseInt($('#test-init-vus').value, 10),
                    maxVUs: parseInt($('#test-max-vus').value, 10),
                    duration: $('#test-duration').value,
                    waitPeriod: parseInt($('#test-wait-period').value, 10),
                    maxVuIncrement: parseInt($('#test-max-vu-increment').value, 10),
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
                    initVUs: parseInt($('#test-init-vus').value, 10),
                    maxVUs: parseInt($('#test-max-vus').value, 10),
                    duration: $('#test-duration').value,
                    testTargets: targets,
                    outputMode: outputMode,
                    waitPeriod: parseInt($('#test-wait-period').value, 10),
                    maxVuIncrement: parseInt($('#test-max-vu-increment').value, 10)
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
