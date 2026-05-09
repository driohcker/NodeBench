/**
 * 报告中心页面
 */

Object.assign(App, {
    async loadReports() {
        try {
            const r = await window.electronAPI.reportsList();
            const tbody = $('#reports-table');
            if (!r.success || !r.data || r.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center">暂无报告</td></tr>';
                this.reportList = [];
                this.selectedReportPath = null;
                $('#reports-selected-path').value = '';
                return;
            }
            this.reportList = r.data;
            tbody.innerHTML = r.data.map((rep, idx) => {
                return `<tr data-idx="${idx}" style="cursor:pointer;">
                    <td><code>${this.escapeHtml(rep.name)}</code></td>
                    <td>${this.escapeHtml(rep.sessionId || '-')}</td>
                    <td>${fmtDate(rep.createdAt)}</td>
                    <td>${this.formatBytes(rep.size)}</td>
                    <td>
                        <button class="btn btn-small btn-ghost report-open-btn" data-idx="${idx}">打开</button>
                    </td>
                </tr>`;
            }).join('');
            $$('#reports-table tr').forEach(tr => {
                tr.addEventListener('click', () => this.selectReport(parseInt(tr.dataset.idx, 10)));
            });
            $$('#reports-table .report-open-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openReportFile(parseInt(btn.dataset.idx, 10));
                });
            });
        } catch (e) {
            console.error('loadReports error:', e);
            $('#reports-table').innerHTML = '<tr><td colspan="5" class="text-muted text-center">加载失败</td></tr>';
        }
    },

    selectReport(idx) {
        const rep = this.reportList[idx];
        if (!rep) return;
        this.selectedReportPath = rep.path;
        $('#reports-selected-path').value = rep.path;
        $$('#reports-table tr').forEach(tr => tr.style.background = '');
        const rows = $$('#reports-table tr');
        if (rows[idx]) rows[idx].style.background = 'rgba(59,130,246,0.12)';
    },

    async openSelectedReport() {
        if (!this.selectedReportPath) { toast('请先在列表中选择一份报告', 'warn'); return; }
        await this.openReportFileByPath(this.selectedReportPath);
    },

    async openReportFile(idx) {
        const rep = this.reportList[idx];
        if (!rep) return;
        await this.openReportFileByPath(rep.path);
    },

    async openReportFileByPath(filePath) {
        try {
            const r = await window.electronAPI.reportsOpen(filePath);
            if (r.success) {
                toast('报告已在浏览器中打开', 'success');
            } else {
                toast('打开失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('打开异常: ' + e.message, 'error');
        }
    },

    async convertReport(format) {
        if (!this.selectedReportPath) { toast('请先在列表中选择一份报告', 'warn'); return; }
        const statusEl = $('#reports-convert-status');
        statusEl.textContent = `正在转换为 ${format.toUpperCase()}，请稍候...`;
        statusEl.className = 'settings-status';
        try {
            let r;
            if (format === 'pdf') {
                r = await window.electronAPI.reportsConvertToPdf(this.selectedReportPath);
            } else if (format === 'docx') {
                r = await window.electronAPI.reportsConvertToDocx(this.selectedReportPath);
            }
            if (r.success) {
                statusEl.textContent = `✓ 转换成功: ${r.outputPath}`;
                statusEl.className = 'settings-status success';
            } else {
                statusEl.textContent = '转换失败: ' + r.error;
                statusEl.className = 'settings-status error';
            }
        } catch (e) {
            statusEl.textContent = '转换异常: ' + e.message;
            statusEl.className = 'settings-status error';
        }
    },

    async deleteSelectedReport() {
        if (!this.selectedReportPath) { toast('请先在列表中选择一份报告', 'warn'); return; }
        if (!confirm('确定要删除这份报告吗？此操作不可恢复。')) return;
        try {
            const r = await window.electronAPI.reportsDelete(this.selectedReportPath);
            if (r.success) {
                toast('报告已删除');
                this.selectedReportPath = null;
                $('#reports-selected-path').value = '';
                this.loadReports();
            } else {
                toast('删除失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('删除异常: ' + e.message, 'error');
        }
    }
});
