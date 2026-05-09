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
        } catch (e) { /* ignore */ }
        this.onTestModeChange();
    },

    onTestModeChange() {
        const autoMode = $('#test-auto-mode').value;
        const strategyGroup = $('#test-analysis-strategy-group');
        if (strategyGroup) {
            strategyGroup.style.display = autoMode === 'auto' ? 'block' : 'none';
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

        $('#test-start-btn').disabled = true;
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
                    maxVuIncrement: parseInt($('#test-max-vu-increment').value, 10)
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
            $('#test-start-btn').disabled = false;
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
            const cmd = await window.electronAPI.monitorStart(sessionId, currentSession2Id, source, { algorithm });
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
                toast('配置已重置为默认值', 'info');
            }
        } catch (e) {
            toast('重置配置失败: ' + e.message, 'error');
        }
    },

    async stopTest() {
        $('#test-stop-btn').disabled = true;
        try {
            const r = await window.electronAPI.testStop();
            toast(r.success ? '测试已停止' : '停止失败: ' + r.error, r.success ? 'info' : 'error');
        } catch (e) {
            toast('停止异常: ' + e.message, 'error');
        }
        setTimeout(() => {
            $('#test-stop-btn').disabled = false;
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
