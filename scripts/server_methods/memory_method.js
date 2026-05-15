const os = require('os');

/**
 * Memory 性能测试方法
 *
 * 设计思路：
 * 1. 每次请求分配大块内存（默认 20MB）并保留在全局池中，模拟真实业务中的
 *    缓存服务/大数据工作集，使系统内存使用率真实上升。
 * 2. 根据系统总内存动态限制池上限（默认不超过系统内存的 3%，且每个 worker
 *    上限不超过 800MB），防止低内存机器 OOM。
 * 3. 仅做轻量的顺序内存扫描（最多 1MB，步长 4KB），避免随机访问导致的
 *    CPU 缓存未命中和大量循环消耗 CPU。
 * 4. 超过 5 分钟无调用自动清理旧池，防止测试间隔期间内存泄漏。
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
    // 动态默认值：小内存机器用小值，大内存机器用中等值
    const allocMB = params.allocMB || Math.max(10, Math.min(50, Math.floor(totalMemGB * 1.5)));
    const size = allocMB * 1024 * 1024;

    // 分配内存并填充，确保真正占用物理内存（而非仅虚拟地址）
    const buffer = Buffer.alloc(size);
    buffer.fill(0xAB);

    // 保留引用，防止 GC 回收
    memoryPool.push(buffer);
    poolTotalBytes += size;

    // 调试日志：确认内存池增长
    console.log(`[memory_method] 分配 ${allocMB}MB，当前池大小 ${Math.round(poolTotalBytes / (1024 * 1024))}MB，系统空闲 ${Math.round(os.freemem() / (1024 * 1024))}MB`);

    // 限制池大小：默认不超过系统内存的 3%，且单 worker 不超过 800MB
    const maxPoolMB = params.maxPoolMB || Math.max(100, Math.min(800, Math.floor(totalMemGB * 30)));
    const maxPoolBytes = maxPoolMB * 1024 * 1024;
    while (poolTotalBytes > maxPoolBytes && memoryPool.length > 0) {
        const old = memoryPool.shift();
        poolTotalBytes -= old.length;
    }

    // 轻量顺序扫描：防止 V8 编译器优化掉分配操作
    // 顺序访问对 CPU 缓存友好，开销极低（约几十微秒）
    let checksum = 0;
    const scanBytes = Math.min(size, 1024 * 1024); // 最多扫描 1MB
    for (let i = 0; i < scanBytes; i += 4096) {
        checksum += buffer[i];
    }

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
