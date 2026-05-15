const os = require('os');

/**
 * Memory 性能测试方法（纯内存密集型，极低 CPU 开销）
 *
 * 设计思路：
 * 1. 使用 Buffer.allocUnsafe 代替 Buffer.alloc，避免 Node.js 内部对整段内存做清零遍历
 *    （清零 50MB 约 5000 万次写入，是主要的 CPU 开销来源）。
 * 2. 仅按操作系统页大小（4KB）稀疏写入一个字节，触发 demand-paging 让 OS 真正分配
 *    物理内存，而不做全量 fill 遍历。50MB 只需约 1.2 万次写入，CPU 开销降低约 4000 倍。
 * 3. 去掉大范围的顺序扫描，仅做极简读取防止 V8 完全优化掉分配逻辑。
 * 4. 根据系统总内存动态限制池上限，防止低内存机器 OOM。
 * 5. 超过 5 分钟无调用自动清理旧池，防止测试间隔期间内存泄漏。
 */

// 全局内存池
const memoryPool = [];
let poolTotalBytes = 0;
let lastCallTime = 0;

function execute(params = {}) {
    const now = Date.now();
    const resetIntervalMs = params.resetIntervalMs || 5 * 60 * 1000; // 5 分钟

    // 若间隔超过阈值，认为是新测试会话，清理旧池避免泄漏
    if (now - lastCallTime > resetIntervalMs) {
        memoryPool.length = 0;
        poolTotalBytes = 0;
    }
    lastCallTime = now;

    const totalMemGB = os.totalmem() / (1024 * 1024 * 1024);
    // 动态默认值：小内存机器用小值，大内存机器用较大值（上限放宽到 80MB）
    const allocMB = params.allocMB || Math.max(20, Math.min(80, Math.floor(totalMemGB * 2)));
    const size = allocMB * 1024 * 1024;

    // ═══════════════════════════════════════════════════════════════════════
    //  核心修改：allocUnsafe 不清零，仅稀疏 touch 触发物理页分配
    // ═══════════════════════════════════════════════════════════════════════
    const buffer = Buffer.allocUnsafe(size);
    const pageSize = 4096;
    for (let i = 0; i < size; i += pageSize) {
        buffer[i] = 0xAB;
    }

    // 保留引用，防止 GC 回收
    memoryPool.push(buffer);
    poolTotalBytes += size;

    // 调试日志：确认内存池增长
    console.log(`[memory_method] 分配 ${allocMB}MB，当前池大小 ${Math.round(poolTotalBytes / (1024 * 1024))}MB，系统空闲 ${Math.round(os.freemem() / (1024 * 1024))}MB`);

    // 限制池大小：默认不超过系统内存的 6%，且单 worker 不超过 2GB
    const maxPoolMB = params.maxPoolMB || Math.max(200, Math.min(2048, Math.floor(totalMemGB * 60)));
    const maxPoolBytes = maxPoolMB * 1024 * 1024;
    while (poolTotalBytes > maxPoolBytes && memoryPool.length > 0) {
        const old = memoryPool.shift();
        poolTotalBytes -= old.length;
    }

    // 极简扫描：只读取第一个字节，防止 V8 编译器优化掉分配操作
    const checksum = buffer[0];

    return {
        method: 'memory',
        allocMB,
        poolTotalMB: Math.round(poolTotalBytes / (1024 * 1024)),
        checksum,
        timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
    };
}

module.exports = {
    execute,
    clearPool: () => {
        memoryPool.length = 0;
        poolTotalBytes = 0;
    }
};
