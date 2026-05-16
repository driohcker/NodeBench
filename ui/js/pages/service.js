/**
 * 服务管理页面
 */

Object.assign(App, {
    async loadService() {
        await this.pollServer();
        try {
            const r = await window.electronAPI.serverConfig();
            if (r.success) {
                const c = r.data;
                $('#service-url').textContent = c.serverUrl || '-';
                $('#service-control-url').textContent = c.controlUrl || '-';
                $('#service-log-dir').textContent = c.logDir || '-';

                const fields = {
                    'cfg-serverUrl': c.serverUrl,
                    'cfg-controlUrl': c.controlUrl,
                    'cfg-mode': c.mode,
                    'cfg-workers': c.workers,
                };
                for (const [id, value] of Object.entries(fields)) {
                    const el = document.getElementById(id);
                    if (el && !el.classList.contains('changed')) {
                        el.value = value !== undefined && value !== null ? value : '';
                    }
                }
                const stats = await window.electronAPI.configStats();
                $('#cfg-env').value = stats.data?.environment || 'development';
                $('#cfg-methodsDir').value = c.methodsDir || '-';
            }
        } catch (e) { console.error('loadService error:', e); }
        this.loadMethods();
    },

    async saveServiceConfig() {
        const statusEl = $('#service-config-save-status');
        statusEl.textContent = '保存中...';
        statusEl.className = '';
        try {
            const changes = {};
            $$('#page-service .form-input[data-config-key], #page-service .form-select[data-config-key]').forEach(el => {
                if (el.classList.contains('changed')) {
                    const key = el.dataset.configKey;
                    let value = el.value;
                    if (el.type === 'number') value = parseInt(value, 10);
                    changes[key] = value;
                }
            });
            if (Object.keys(changes).length === 0) {
                statusEl.textContent = '没有需要保存的更改';
                statusEl.className = 'text-muted';
                return;
            }
            const r = await window.electronAPI.configSet(changes);
            if (r.success) {
                statusEl.textContent = '✓ 配置已保存，热重载生效中...';
                statusEl.className = 'success';
                $$('#page-service .changed').forEach(el => el.classList.remove('changed'));
                setTimeout(() => this.loadService(), 500);
            } else {
                statusEl.textContent = '保存失败: ' + r.error;
                statusEl.className = 'error';
            }
        } catch (e) {
            statusEl.textContent = '保存异常: ' + e.message;
            statusEl.className = 'error';
        }
    },

    async resetServiceConfig() {
        if (!confirm('确定要重置所有配置为默认值吗？\n这会删除 local.json 中的自定义配置。')) return;
        const statusEl = $('#service-config-save-status');
        try {
            const r = await window.electronAPI.configReset();
            if (r.success) {
                statusEl.textContent = '✓ 已重置为默认值';
                statusEl.className = 'success';
                $$('#page-service .changed').forEach(el => el.classList.remove('changed'));
                setTimeout(() => this.loadService(), 500);
            } else {
                statusEl.textContent = '重置失败: ' + r.error;
                statusEl.className = 'error';
            }
        } catch (e) {
            statusEl.textContent = '重置异常: ' + e.message;
            statusEl.className = 'error';
        }
    },

    async loadMethods() {
        try {
            const r = await window.electronAPI.serverMethods();
            const tbody = $('#service-methods-table');
            if (!r.success || !r.data || r.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">暂无方法</td></tr>';
                return;
            }
            tbody.innerHTML = r.data.map(m => {
                const iconMap = { cpu: '🔥', memory: '💾', disk: '💿', io: '📡', network: '📡' };
                const icon = iconMap[m.name] || '⚙️';
                return `
                <tr>
                    <td><span class="tag tag-${m.name}">${icon} ${m.name.toUpperCase()}</span></td>
                    <td>${this.formatBytes(m.size)}</td>
                    <td>${fmtDate(m.modified)}</td>
                    <td>
                        <button class="btn btn-small btn-ghost" onclick="App.openMethodEditor('${m.name}')">编辑</button>
                        <button class="btn btn-small btn-danger" onclick="App.deleteMethod('${m.name}')">删除</button>
                    </td>
                </tr>
            `}).join('');
        } catch (e) {
            console.error('loadMethods error:', e);
            $('#service-methods-table').innerHTML = '<tr><td colspan="4" class="text-muted text-center">加载失败</td></tr>';
        }
    },

    async openMethodEditor(methodName) {
        try {
            const r = await window.electronAPI.serverReadMethod(methodName);
            if (!r.success) {
                toast('读取方法失败: ' + r.error, 'error');
                return;
            }
            $('#method-editor-name').textContent = r.data.name;
            $('#method-editor-textarea').value = r.data.content;
            $('#method-editor-status').textContent = '';
            $('#method-editor-status').className = '';
            $('#method-editor-card').style.display = 'block';
            $('#method-editor-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) {
            toast('打开编辑器异常: ' + e.message, 'error');
        }
    },

    async saveMethodContent() {
        const name = $('#method-editor-name').textContent;
        const content = $('#method-editor-textarea').value;
        const statusEl = $('#method-editor-status');
        statusEl.textContent = '保存中...';
        statusEl.className = '';
        try {
            const r = await window.electronAPI.serverSaveMethod(name, content);
            if (r.success) {
                statusEl.textContent = '✓ 保存成功';
                statusEl.className = 'success';
                this.loadMethods();
            } else {
                statusEl.textContent = '保存失败: ' + r.error;
                statusEl.className = 'error';
            }
        } catch (e) {
            statusEl.textContent = '保存异常: ' + e.message;
            statusEl.className = 'error';
        }
    },

    async deleteMethod(methodName) {
        if (!confirm(`确定要删除方法 "${methodName}" 吗？此操作不可恢复。`)) return;
        try {
            const r = await window.electronAPI.serverDeleteMethod(methodName);
            if (r.success) {
                toast('方法已删除: ' + methodName, 'success');
                this.loadMethods();
                $('#method-editor-card').style.display = 'none';
            } else {
                toast('删除失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('删除异常: ' + e.message, 'error');
        }
    },

    async createNewMethod() {
        const name = prompt('请输入新方法名称（英文，如 disk、network）：', 'new_method');
        if (!name) return;
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeName) {
            toast('无效的方法名称', 'error');
            return;
        }
        const template = `function execute(params = {}) {
    const startTime = Date.now();
    // TODO: 实现 ${safeName} 测试逻辑
    const result = {
        method: '${safeName}',
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
    };
    return result;
}

module.exports = { execute };
`;
        try {
            const r = await window.electronAPI.serverSaveMethod(safeName, template);
            if (r.success) {
                toast('新方法已创建: ' + safeName, 'success');
                this.loadMethods();
                this.openMethodEditor(safeName);
            } else {
                toast('创建失败: ' + r.error, 'error');
            }
        } catch (e) {
            toast('创建异常: ' + e.message, 'error');
        }
    },

    async startServer() {
        $('#service-start-btn, #dash-start-server').disabled = true;
        try {
            const r = await window.electronAPI.serverStart();
            toast(r.success ? '被测服务启动指令已发送' : '启动失败: ' + r.error, r.success ? 'info' : 'error');
        } catch (e) {
            toast('启动异常: ' + e.message, 'error');
        }
        setTimeout(() => {
            $('#service-start-btn, #dash-start-server').disabled = false;
            this.pollServer();
        }, 1500);
    },

    async stopServer() {
        $('#service-stop-btn').disabled = true;
        try {
            const r = await window.electronAPI.serverStop();
            toast(r.success ? '被测服务停止指令已发送' : '停止失败: ' + r.error, r.success ? 'info' : 'error');
        } catch (e) {
            toast('停止异常: ' + e.message, 'error');
        }
        setTimeout(() => {
            $('#service-stop-btn').disabled = false;
            this.pollServer();
        }, 1500);
    }
});
