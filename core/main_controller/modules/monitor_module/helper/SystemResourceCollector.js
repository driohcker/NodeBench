const os = require('os');

/**
 * SystemResourceCollector - 系统资源采集器
 * 定期采集 CPU 占用率、内存占用率等系统资源指标。
 * IO 和磁盘占用率因跨平台复杂性暂不采集，返回 0。
 */
class SystemResourceCollector {
    constructor(logger) {
        this.logger = logger;
        this.lastCpuInfo = null;
    }

    /**
     * 采集当前系统资源利用率
     * @returns {Object} {cpu, memory, io, disk}
     */
    collect() {
        return {
            cpu: this._getCpuUsage(),
            memory: this._getMemoryUsage(),
            io: 0,
            disk: 0
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
