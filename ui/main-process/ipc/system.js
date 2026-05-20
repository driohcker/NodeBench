const { ipcMain } = require('electron');
const os = require('os');
const state = require('../state');

function getCpuUsage() {
    const cpus = os.cpus();
    let idle = 0, total = 0;
    for (const cpu of cpus) {
        for (const type in cpu.times) {
            total += cpu.times[type];
        }
        idle += cpu.times.idle;
    }
    const now = Date.now();
    let usage = 0;
    if (state.lastCpuInfo && now > state.lastCpuTime) {
        const idleDiff = idle - state.lastCpuInfo.idle;
        const totalDiff = total - state.lastCpuInfo.total;
        if (totalDiff > 0) {
            usage = 100 - Math.floor((idleDiff / totalDiff) * 100);
        }
    }
    state.lastCpuInfo = { idle, total };
    state.lastCpuTime = now;
    return Math.max(0, Math.min(100, usage));
}

function register() {
    ipcMain.handle('system:stats', async () => {
        try {
            const cpu = getCpuUsage();
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memPercent = parseFloat(((usedMem / totalMem) * 100).toFixed(1));
            const uptime = os.uptime();

            return {
                success: true,
                data: {
                    cpu,
                    memory: memPercent,
                    memoryUsed: Math.round(usedMem / 1024 / 1024),
                    memoryTotal: Math.round(totalMem / 1024 / 1024),
                    uptime,
                    platform: `${os.platform()} ${os.arch()}`,
                    cpus: os.cpus().length
                }
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    });
}

module.exports = { register };
