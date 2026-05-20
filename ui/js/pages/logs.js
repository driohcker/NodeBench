/**
 * 日志中心页面
 */

Object.assign(App, {
    async loadLogs(mod) {
        if (!mod) {
            const active = $('#logs-tab-bar .tab-btn.active');
            mod = active ? active.dataset.module : 'main';
        }
        const fileSelect = $('#logs-file-select');
        const fileName = (fileSelect && fileSelect.value) ? fileSelect.value : null;
        try {
            const r = await window.electronAPI.logsRead(mod, 200, fileName);
            const output = $('#logs-output');
            if (!r.success) {
                output.textContent = '读取失败: ' + (r.error || '未知错误');
            } else if (r.data === undefined || r.data === null) {
                output.textContent = '暂无日志';
            } else {
                output.textContent = r.data;
            }
            output.scrollTop = output.scrollHeight;
        } catch (e) {
            $('#logs-output').textContent = '读取异常: ' + e.message;
        }
    },

    async loadLogFiles(mod) {
        if (!mod) {
            const active = $('#logs-tab-bar .tab-btn.active');
            mod = active ? active.dataset.module : 'main';
        }
        const fileSelect = $('#logs-file-select');
        if (!fileSelect) return;
        try {
            const r = await window.electronAPI.logsList(mod);
            fileSelect.innerHTML = '';
            if (r.success && r.data && r.data.length > 0) {
                r.data.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.name;
                    const dateStr = fmtDate(f.mtime);
                    const sizeStr = f.size < 1024 ? `${f.size} B` : f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`;
                    opt.textContent = `${f.name} (${sizeStr}, ${dateStr})`;
                    fileSelect.appendChild(opt);
                });
                fileSelect.selectedIndex = 0;
            } else {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = '暂无日志文件';
                fileSelect.appendChild(opt);
            }
        } catch (e) {
            fileSelect.innerHTML = '<option value="">加载失败</option>';
        }
    },

    async deleteLogFile() {
        const active = $('#logs-tab-bar .tab-btn.active');
        const mod = active ? active.dataset.module : 'main';
        const fileSelect = $('#logs-file-select');
        const fileName = fileSelect ? fileSelect.value : '';
        if (!fileName) {
            toast('没有可删除的日志文件', 'warn');
            return;
        }
        if (!confirm(`确定要删除日志文件 "${fileName}" 吗？此操作不可恢复。`)) {
            return;
        }
        try {
            const r = await window.electronAPI.logsDelete(mod, fileName);
            if (r.success) {
                toast('日志文件已删除', 'success');
                await this.loadLogFiles();
                await this.loadLogs();
            } else {
                toast('删除失败: ' + (r.error || '未知错误'), 'error');
            }
        } catch (e) {
            toast('删除异常: ' + e.message, 'error');
        }
    }
});
