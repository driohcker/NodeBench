/**
 * 系统设置页面
 */

Object.assign(App, {
    async loadSettings() {
        try {
            const r = await window.electronAPI.configGet();
            if (!r.success) return;
            const cfg = r.data;

            const statsR = await window.electronAPI.configStats();
            if (statsR.success) {
                const s = statsR.data;
                $('#settings-env-value').textContent = s.environment;
                $('#settings-env-badge').textContent = s.environment;
                $('#settings-sources-value').textContent = s.sources.map(src => src.name).join(' → ');
                $('#settings-sources-count').textContent = s.sourcesCount;
            }

            // ─── 测试参数 ───
            this._setInput('set-test-initVUs', cfg.test?.initVUs);
            this._setInput('set-test-maxVUs', cfg.test?.maxVUs);
            this._setInput('set-test-duration', cfg.test?.duration);
            this._setInput('set-test-waitPeriod', cfg.test?.waitPeriod);
            this._setInput('set-test-maxVuIncrement', cfg.test?.maxVuIncrement);
            this._setInput('set-test-outputMode', cfg.test?.outputMode);
            this._setInput('set-test-logDir', cfg.test?.logDir);
            const targets = cfg.test?.testTargets || ['cpu'];
            $$('#set-test-testTargets input[type="checkbox"]').forEach(cb => {
                cb.checked = targets.includes(cb.value);
            });

            // ─── 服务参数 ───
            const serverMode = cfg.server?.express?.mode || cfg.server?.mode || 'cluster';
            this._setInput('set-server-mode', serverMode);
            this._setInput('set-server-workers', cfg.server?.express?.workers ?? cfg.server?.workers);
            this._setInput('set-server-serverUrl', cfg.server?.express?.serverUrl ?? cfg.server?.serverUrl);
            this._setInput('set-server-controlUrl', cfg.server?.express?.controlUrl ?? cfg.server?.controlUrl);
            this._setInput('set-server-logDir', cfg.server?.logDir);
            this._setInput('set-server-expressLogDir', cfg.server?.express?.logDir);

            // ─── 监控参数 ───
            this._setInput('set-monitor-monitorMode', cfg.monitor?.monitorMode);
            this._setInput('set-monitor-logDir', cfg.monitor?.logDir);

            // ─── 分析参数 ───
            this._setInput('set-monitor-algorithm', cfg.monitor?.algorithm);
            this._setInput('set-monitor-batchSize', cfg.monitor?.batchSize);

            // 策略独立配置
            const dw = cfg.strategies?.DoubleWindowStrategy || {};
            this._setInput('set-strat-dw-windowSize', dw.windowSize);
            this._setInput('set-strat-dw-threshold', dw.threshold);
            this._setInput('set-strat-dw-sustainCount', dw.sustainCount);

            const cs = cfg.strategies?.CusumStrategy || {};
            this._setInput('set-strat-cs-baselinePoints', cs.baselinePoints);
            this._setInput('set-strat-cs-cMultiplier', cs.cMultiplier);
            this._setInput('set-strat-cs-HMultiplier', cs.HMultiplier);
            this._setInput('set-strat-cs-sustainCount', cs.sustainCount);

            const sc = cfg.strategies?.SlopeChangeStrategy || {};
            this._setInput('set-strat-sc-windowSize', sc.windowSize);
            this._setInput('set-strat-sc-threshold', sc.threshold);
            this._setInput('set-strat-sc-epsilon', sc.epsilon);
            this._setInput('set-strat-sc-sustainCount', sc.sustainCount);
            this._setInput('set-strat-sc-minPoints', sc.minPoints);

            // 大波动过滤器配置
            const spike = cfg.test?.spikeFilter || {};
            this._setInput('set-test-spike-enabled', String(spike.enabled !== false));
            this._setInput('set-test-spike-windowSize', spike.windowSize);
            this._setInput('set-test-spike-threshold', spike.threshold);
            this._setInput('set-test-spike-minAbsoluteThreshold', spike.minAbsoluteThreshold);
            this._setInput('set-test-spike-minHistory', spike.minHistory);
            const spikeMetrics = spike.metrics || ['http_reqs', 'http_req_duration'];
            $$('#set-test-spike-metrics input[type="checkbox"]').forEach(cb => {
                cb.checked = spikeMetrics.includes(cb.value);
            });

            this._setInput('set-analyzer-logDir', cfg.analyzer?.logDir);

            // ─── 全局/主模块 ───
            this._setInput('set-global-k6Dir', cfg.global?.k6Dir);
            this._setInput('set-global-nodeDir', cfg.global?.nodeDir);
            this._setInput('set-main-url', cfg.main?.url);
            this._setInput('set-main-logDir', cfg.main?.logDir);
            this._setInput('set-main-env', statsR.data?.environment);

            $('#settings-save-status').textContent = '';
        } catch (e) {
            console.error('loadSettings error:', e);
        }
    },

    _setInput(id, value) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('changed')) {
            el.value = value !== undefined && value !== null ? value : '';
        }
    },

    async saveSettings() {
        const statusEl = $('#settings-save-status');
        statusEl.textContent = '保存中...';
        statusEl.className = 'settings-status';

        const changes = {};

        // ─── 测试参数 ───
        const testFields = [
            { id: 'set-test-initVUs', key: 'test.initVUs', type: 'int' },
            { id: 'set-test-maxVUs', key: 'test.maxVUs', type: 'int' },
            { id: 'set-test-duration', key: 'test.duration', type: 'string' },
            { id: 'set-test-waitPeriod', key: 'test.waitPeriod', type: 'int' },
            { id: 'set-test-maxVuIncrement', key: 'test.maxVuIncrement', type: 'int' },
            { id: 'set-test-outputMode', key: 'test.outputMode', type: 'string' },
            { id: 'set-test-logDir', key: 'test.logDir', type: 'string' },
        ];
        testFields.forEach(f => {
            const el = document.getElementById(f.id);
            if (el && el.classList.contains('changed')) {
                let val = el.value;
                if (f.type === 'int') val = parseInt(val, 10);
                if (f.type === 'float') val = parseFloat(val);
                changes[f.key] = val;
            }
        });
        const targetCheckboxes = $$('#set-test-testTargets input[type="checkbox"]');
        const selectedTargets = Array.from(targetCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
        if (selectedTargets.length > 0) {
            changes['test.testTargets'] = selectedTargets;
        }

        // ─── 服务参数 ───
        const serverFields = [
            { id: 'set-server-serverUrl', key: 'server.express.serverUrl', type: 'string' },
            { id: 'set-server-controlUrl', key: 'server.express.controlUrl', type: 'string' },
            { id: 'set-server-mode', key: 'server.express.mode', type: 'string' },
            { id: 'set-server-workers', key: 'server.express.workers', type: 'int' },
            { id: 'set-server-logDir', key: 'server.logDir', type: 'string' },
            { id: 'set-server-expressLogDir', key: 'server.express.logDir', type: 'string' },
        ];
        serverFields.forEach(f => {
            const el = document.getElementById(f.id);
            if (el && el.classList.contains('changed')) {
                let val = el.value;
                if (f.type === 'int') val = parseInt(val, 10);
                changes[f.key] = val;
            }
        });

        // ─── 监控参数 ───
        const monitorFields = [
            { id: 'set-monitor-monitorMode', key: 'monitor.monitorMode', type: 'string' },
            { id: 'set-monitor-logDir', key: 'monitor.logDir', type: 'string' },
            { id: 'set-monitor-algorithm', key: 'monitor.algorithm', type: 'string' },
            { id: 'set-monitor-batchSize', key: 'monitor.batchSize', type: 'int' },
        ];
        monitorFields.forEach(f => {
            const el = document.getElementById(f.id);
            if (el && el.classList.contains('changed')) {
                let val = el.value;
                if (f.type === 'int') val = parseInt(val, 10);
                changes[f.key] = val;
            }
        });

        // ─── 大波动过滤器配置 ───
        const spikeFields = [
            { id: 'set-test-spike-enabled', key: 'test.spikeFilter.enabled', type: 'bool' },
            { id: 'set-test-spike-windowSize', key: 'test.spikeFilter.windowSize', type: 'int' },
            { id: 'set-test-spike-threshold', key: 'test.spikeFilter.threshold', type: 'float' },
            { id: 'set-test-spike-minAbsoluteThreshold', key: 'test.spikeFilter.minAbsoluteThreshold', type: 'int' },
            { id: 'set-test-spike-minHistory', key: 'test.spikeFilter.minHistory', type: 'int' },
        ];
        spikeFields.forEach(f => {
            const el = document.getElementById(f.id);
            if (el && el.classList.contains('changed')) {
                let val = el.value;
                if (f.type === 'bool') val = val === 'true';
                if (f.type === 'int') val = parseInt(val, 10);
                if (f.type === 'float') val = parseFloat(val);
                changes[f.key] = val;
            }
        });
        const spikeMetricCheckboxes = $$('#set-test-spike-metrics input[type="checkbox"]');
        const selectedSpikeMetrics = Array.from(spikeMetricCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
        if (selectedSpikeMetrics.length > 0) {
            changes['test.spikeFilter.metrics'] = selectedSpikeMetrics;
        }

        // ─── 分析参数 ───
        const analyzerFields = [
            { id: 'set-analyzer-logDir', key: 'analyzer.logDir', type: 'string' },
            { id: 'set-analyzer-strategyDir', key: 'analyzer.strategyDir', type: 'string' },
        ];

        // ─── 策略独立配置 ───
        const strategyFields = [
            { id: 'set-strat-dw-windowSize', key: 'strategies.DoubleWindowStrategy.windowSize', type: 'int' },
            { id: 'set-strat-dw-threshold', key: 'strategies.DoubleWindowStrategy.threshold', type: 'float' },
            { id: 'set-strat-dw-sustainCount', key: 'strategies.DoubleWindowStrategy.sustainCount', type: 'int' },
            { id: 'set-strat-cs-baselinePoints', key: 'strategies.CusumStrategy.baselinePoints', type: 'int' },
            { id: 'set-strat-cs-cMultiplier', key: 'strategies.CusumStrategy.cMultiplier', type: 'float' },
            { id: 'set-strat-cs-HMultiplier', key: 'strategies.CusumStrategy.HMultiplier', type: 'float' },
            { id: 'set-strat-cs-sustainCount', key: 'strategies.CusumStrategy.sustainCount', type: 'int' },
            { id: 'set-strat-sc-windowSize', key: 'strategies.SlopeChangeStrategy.windowSize', type: 'int' },
            { id: 'set-strat-sc-threshold', key: 'strategies.SlopeChangeStrategy.threshold', type: 'float' },
            { id: 'set-strat-sc-epsilon', key: 'strategies.SlopeChangeStrategy.epsilon', type: 'float' },
            { id: 'set-strat-sc-sustainCount', key: 'strategies.SlopeChangeStrategy.sustainCount', type: 'int' },
            { id: 'set-strat-sc-minPoints', key: 'strategies.SlopeChangeStrategy.minPoints', type: 'int' },
        ];
        analyzerFields.forEach(f => {
            const el = document.getElementById(f.id);
            if (el && el.classList.contains('changed')) {
                let val = el.value;
                if (f.type === 'int') val = parseInt(val, 10);
                changes[f.key] = val;
            }
        });
        strategyFields.forEach(f => {
            const el = document.getElementById(f.id);
            if (el && el.classList.contains('changed')) {
                let val = el.value;
                if (f.type === 'int') val = parseInt(val, 10);
                if (f.type === 'float') val = parseFloat(val);
                changes[f.key] = val;
            }
        });

        // ─── 全局与主模块 ───
        const globalFields = [
            { id: 'set-global-k6Dir', key: 'global.k6Dir', type: 'string' },
            { id: 'set-global-nodeDir', key: 'global.nodeDir', type: 'string' },
            { id: 'set-main-url', key: 'main.url', type: 'string' },
            { id: 'set-main-logDir', key: 'main.logDir', type: 'string' },
        ];
        globalFields.forEach(f => {
            const el = document.getElementById(f.id);
            if (el && el.classList.contains('changed')) {
                let val = el.value;
                if (f.type === 'int') val = parseInt(val, 10);
                changes[f.key] = val;
            }
        });

        if (Object.keys(changes).length === 0) {
            statusEl.textContent = '没有变更需要保存';
            statusEl.className = 'settings-status';
            return;
        }

        try {
            const r = await window.electronAPI.configSet(changes);
            if (r.success) {
                statusEl.textContent = '✓ 设置已保存并生效';
                statusEl.className = 'settings-status success';
                $$('#page-settings .changed').forEach(el => el.classList.remove('changed'));
                await this.loadSettings();
            } else {
                statusEl.textContent = '保存失败: ' + (r.error || '未知错误');
                statusEl.className = 'settings-status error';
            }
        } catch (e) {
            statusEl.textContent = '保存异常: ' + e.message;
            statusEl.className = 'settings-status error';
        }
    },

    async resetSettings() {
        if (!confirm('确定要重置所有设置为默认值吗？这将删除本地自定义配置。')) return;

        const statusEl = $('#settings-save-status');
        statusEl.textContent = '重置中...';
        statusEl.className = 'settings-status';

        try {
            const r = await window.electronAPI.configReset();
            if (r.success) {
                statusEl.textContent = '✓ 已重置为默认值，页面即将刷新...';
                statusEl.className = 'settings-status success';
                $$('#page-settings .changed').forEach(el => el.classList.remove('changed'));
                await this.loadSettings();
            } else {
                statusEl.textContent = '重置失败: ' + (r.error || '未知错误');
                statusEl.className = 'settings-status error';
            }
        } catch (e) {
            statusEl.textContent = '重置异常: ' + e.message;
            statusEl.className = 'settings-status error';
        }
    }
});
