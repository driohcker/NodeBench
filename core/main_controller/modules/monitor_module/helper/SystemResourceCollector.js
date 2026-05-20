const os = require('os');
const fs = require('fs');

/**
 * SystemResourceCollector - 系统资源采集器
 * 定期采集 CPU 占用率、内存占用率、IO 占用率、磁盘占用率。
 *
 * Linux: 直接读取 /proc/diskstats 的 io_ticks 计算磁盘 busy 率（类似 iostat %util），
 *        不依赖 systeminformation 的 iowait（云服务器上常为 0）。
 * Windows/macOS: 使用 systeminformation 库作为回退。
 */
class SystemResourceCollector {
    constructor(logger) {
        this.logger = logger;
        this.lastCpuInfo = null;

        // Linux /proc/diskstats 差分缓存
        this.lastDiskStats = null;   // { device: { ioTicks, time } }
        this.lastDiskCheck = 0;

        // 通用缓存值（由后台异步任务更新）
        this.cachedIo = 0;
        this.cachedDisk = 0;
        this.interval = null;

        // 启动后台异步采集
        this._startBackgroundCollection();
    }

    /**
     * 启动后台定时采集 IO/磁盘数据
     */
    _startBackgroundCollection() {
        // 立即执行一次
        this._collectAsync().catch(() => {});
        // 每 2 秒更新一次缓存
        this.interval = setInterval(() => {
            this._collectAsync().catch(() => {});
        }, 2000);
    }

    /**
     * 异步采集 IO 和磁盘使用率并更新缓存
     */
    async _collectAsync() {
        try {
            if (process.platform === 'linux') {
                // Linux: 直接读 /proc/diskstats 算 busy 率，比 iowait 更可靠
                const busy = this._getDiskBusyLinux();
                this.cachedDisk = busy;
                // IO 负载与磁盘 busy 率用同一指标（IO 测试的本质就是磁盘忙碌）
                this.cachedIo = busy;
            } else {
                const si = require('systeminformation');

                // 磁盘使用率：取所有挂载点中的最大使用率
                const fsData = await si.fsSize();
                if (fsData && fsData.length > 0) {
                    const maxUse = Math.max(...fsData.map(f => f.use || 0));
                    this.cachedDisk = parseFloat(maxUse.toFixed(2));
                }

                // IO 使用率
                if (process.platform === 'darwin') {
                    const load = await si.currentLoad();
                    if (typeof load.currentLoadIowait === 'number') {
                        this.cachedIo = parseFloat(load.currentLoadIowait.toFixed(2));
                    }
                } else {
                    // Windows: 尝试 disksIO 的等待百分比
                    const ioData = await si.disksIO();
                    if (ioData && typeof ioData.tWaitPercent === 'number') {
                        this.cachedIo = parseFloat(ioData.tWaitPercent.toFixed(2));
                    }
                }
            }
        } catch (e) {
            // 采集失败时保持上一次缓存值，避免抖动
        }
    }

    /**
     * Linux 专用：读取 /proc/diskstats 的 io_ticks 计算磁盘 busy 率
     * 类似于 iostat 的 %util 指标
     */
    _getDiskBusyLinux() {
        try {
            const content = fs.readFileSync('/proc/diskstats', 'utf8');
            const lines = content.trim().split('\n');
            const now = Date.now();
            let maxBusy = 0;

            if (!this.lastDiskStats) {
                this.lastDiskStats = {};
            }

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                // /proc/diskstats 至少 14 个字段（kernel 2.6+）
                if (parts.length < 14) continue;

                const device = parts[2];
                // 跳过 loop/ram 等无意义设备
                if (device.startsWith('loop') || device.startsWith('ram')) continue;

                // 第 13 个字段（0-based index 12）= io_ticks，累计忙碌毫秒数
                const ioTicks = parseInt(parts[12], 10);
                if (isNaN(ioTicks)) continue;

                const last = this.lastDiskStats[device];
                if (last && now > last.time) {
                    const deltaTicks = ioTicks - last.ioTicks;
                    const deltaTime = now - last.time;
                    // busy% = (忙碌时间 / 经过时间) * 100
                    // 多设备并发时单个设备不超过 100%
                    const busy = (deltaTicks / deltaTime) * 100;
                    if (busy > maxBusy) maxBusy = busy;
                }

                this.lastDiskStats[device] = { ioTicks, time: now };
            }

            return Math.min(parseFloat(maxBusy.toFixed(2)), 100);
        } catch (e) {
            return 0;
        }
    }

    /**
     * 停止后台采集定时器
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    /**
     * 采集当前系统资源利用率（同步返回，使用缓存的 IO/磁盘值）
     * @returns {Object} {cpu, memory, io, disk}
     */
    collect() {
        return {
            cpu: this._getCpuUsage(),
            memory: this._getMemoryUsage(),
            io: this.cachedIo,
            disk: this.cachedDisk
        };
    }

    _getCpuUsage() {
        try {
            const cpus = os.cpus();
            let idle = 0;
            let total = 0;
            for (const cpu of cpus) {
                for (const type in cpu.times) {
                    total += cpu.times[type];
                }
                idle += cpu.times.idle;
            }

            // 差分法计算 CPU 使用率
            if (this.lastCpuInfo) {
                const idleDiff = idle - this.lastCpuInfo.idle;
                const totalDiff = total - this.lastCpuInfo.total;
                const usage = totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : 0;
                this.lastCpuInfo = { idle, total };
                return parseFloat(usage.toFixed(2));
            } else {
                this.lastCpuInfo = { idle, total };
                return 0;
            }
        } catch (e) {
            this.logger.warn(`[SystemResourceCollector] CPU 采集失败: ${e.message}`);
            return 0;
        }
    }

    _getMemoryUsage() {
        try {
            const total = os.totalmem();
            const free = os.freemem();
            return total > 0 ? parseFloat(((total - free) / total * 100).toFixed(2)) : 0;
        } catch (e) {
            this.logger.warn(`[SystemResourceCollector] 内存采集失败: ${e.message}`);
            return 0;
        }
    }
}

module.exports = SystemResourceCollector;
