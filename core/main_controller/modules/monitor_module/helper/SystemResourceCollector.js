const os = require('os');

/**
 * SystemResourceCollector - 系统资源采集器
 * 定期采集 CPU 占用率、内存占用率、IO 占用率、磁盘占用率。
 * IO/磁盘通过 systeminformation 库后台异步采集并缓存，collect() 同步返回缓存值。
 */
class SystemResourceCollector {
    constructor(logger) {
        this.logger = logger;
        this.lastCpuInfo = null;

        // 缓存值（由后台异步任务更新）
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
            const si = require('systeminformation');

            // 磁盘使用率：取所有挂载点中的最大使用率
            const fsData = await si.fsSize();
            if (fsData && fsData.length > 0) {
                const maxUse = Math.max(...fsData.map(f => f.use || 0));
                this.cachedDisk = parseFloat(maxUse.toFixed(2));
            }

            // IO 使用率
            if (process.platform === 'linux' || process.platform === 'darwin') {
                // Linux/macOS: currentLoad 提供 iowait 字段
                const load = await si.currentLoad();
                if (typeof load.currentLoadIowait === 'number') {
                    this.cachedIo = parseFloat(load.currentLoadIowait.toFixed(2));
                }
            } else {
                // Windows: 尝试使用 disksIO 的等待百分比
                const ioData = await si.disksIO();
                if (ioData && typeof ioData.tWaitPercent === 'number') {
                    this.cachedIo = parseFloat(ioData.tWaitPercent.toFixed(2));
                }
            }
        } catch (e) {
            // 采集失败时保持上一次缓存值，避免抖动
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
