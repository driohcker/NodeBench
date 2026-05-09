/**
 * NodeBench GUI 通用工具函数
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString('zh-CN');
}

function setStatus(indicator, textEl, running) {
    indicator.className = 'status-indicator ' + (running ? 'running' : 'stopped');
    textEl.textContent = running ? '运行中' : '已停止';
}

function toast(msg, type = 'info') {
    console.log(`[${type}] ${msg}`);
    let container = $('#toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:360px;';
        document.body.appendChild(container);
    }
    const el = document.createElement('div');
    const colors = {
        info:    { bg: 'rgba(59,130,246,0.95)', border: '#3b82f6' },
        success: { bg: 'rgba(34,197,94,0.95)', border: '#22c55e' },
        warn:    { bg: 'rgba(245,158,11,0.95)', border: '#f59e0b' },
        error:   { bg: 'rgba(239,68,68,0.95)', border: '#ef4444' }
    };
    const c = colors[type] || colors.info;
    el.style.cssText = `background:${c.bg};color:#fff;border-left:4px solid ${c.border};padding:12px 16px;border-radius:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);opacity:0;transform:translateY(20px);transition:all 0.3s ease;pointer-events:auto;`;
    el.textContent = msg;
    container.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => {
        el.style.opacity = '0'; el.style.transform = 'translateY(20px)';
        setTimeout(() => el.remove(), 300);
    }, 3000);
}
