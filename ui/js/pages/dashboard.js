/**
 * 仪表盘页面
 */

Object.assign(App, {
    async loadDashboard() {
        try {
            const r = await window.electronAPI.dataSessions();
            if (r.success) {
                this.sessions = r.data;
                $('#dash-session-count').textContent = r.data.length;
                const tbody = $('#dash-session-table');
                if (r.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center">暂无数据</td></tr>';
                } else {
                    const rows = [];
                    for (const s of r.data.slice(0, 6)) {
                        let peakRps = '--', peakVus = '--', p95 = '--', optimal = '--';
                        if (s.hasResult) {
                            try {
                                const rr = await window.electronAPI.dataReadResult(s.sessionId);
                                if (rr.success && rr.data.performance_trend) {
                                    const trend = rr.data.performance_trend;
                                    peakRps = Math.max(...trend.map(t => t.rps)).toFixed(1);
                                    peakVus = Math.max(...trend.map(t => t.vus));
                                    p95 = trend[trend.length - 1].p95_latency_ms;
                                }
                                if (rr.success && rr.data.optimalInflectionPoint) {
                                    optimal = rr.data.optimalInflectionPoint.vus;
                                }
                            } catch (e) { /* ignore */ }
                        }
                        rows.push(`
                            <tr>
                                <td><code>${s.sessionId}</code></td>
                                <td>${fmtDate(s.createdAt)}</td>
                                <td>${peakRps}</td>
                                <td>${peakVus}</td>
                                <td>${p95}ms</td>
                                <td>${optimal} VUs</td>
                            </tr>
                        `);
                    }
                    tbody.innerHTML = rows.join('');
                }
            }
        } catch (e) { console.error(e); }

        this.pollSystemStats();
        if (this.testStartTime) this.pollTestRuntime();
    }
});
