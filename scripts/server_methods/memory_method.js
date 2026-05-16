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
 * 4. 【关键修改】引入"安全饱和度策略"：根据系统总内存和 worker 数量，自动计算每个 worker
 *    的安全内存配额，避免所有 worker 合计占满系统内存导致测试系统自身卡死（Swap Storm）。
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

    // ═══════════════════════════════════════════════════════════════════════
    //  安全饱和度策略（核心修改）
    // ═══════════════════════════════════════════════════════════════════════
    // 问题背景：cluster 模式下多个 worker 各自独立累积内存，默认配置下容易合计
    // 占满系统内存，触发 Swap Storm / OOM Killer，导致 Electron 主进程卡死。
    //
    // 解决思路：
    // 1. 根据系统总内存大小，动态选择安全饱和度（大内存机器可用更多，小内存需更保守）
    // 2. 将总配额按 worker 数量均摊，每个 worker 有独立上限
    // 3. 达到配额后进入"保持模式"（Hold Mode）：不再分配新内存，只维持已有引用
    //    此时继续增加并发请求数，即可观察"内存饱和下的性能拐点"
    // ═══════════════════════════════════════════════════════════════════════

    // 从环境变量读取 worker 数量（主进程在 fork 前设置，worker 继承）
    const workerCount = params.workerCount || parseInt(process.env.WORKER_COUNT, 10) || os.cpus().length;

    // 动态默认饱和度：大内存机器可用更多，小内存机器需更保守
    //  内存 >= 16GB → 70%      内存 8-16GB → 65%      内存 < 8GB → 55%
    const defaultSaturation = totalMemGB >= 16 ? 0.70 : (totalMemGB >= 8 ? 0.65 : 0.55);
    const targetSaturation = params.targetSaturation || defaultSaturation;

    // 计算每个 worker 的安全配额（MB）
    // 公式：总内存(GB) × 1024(MB/GB) × 饱和度 / worker数
    // 保底 100MB，防止小配额导致预热过慢
    const defaultMaxPoolMB = Math.max(100, Math.floor(totalMemGB * 1024 * targetSaturation / workerCount));

    // 如果用户显式传了 maxPoolMB，优先使用（向后兼容）
    const maxPoolMB = params.maxPoolMB || defaultMaxPoolMB;
    const maxPoolBytes = maxPoolMB * 1024 * 1024;

    // 如果已经达到饱和度上限，进入"保持模式"（Hold Mode）
    // 不再分配新内存，只随机 touch 已有内存防止 OS 换出，模拟"内存饱和下的工作负载"
    if (poolTotalBytes >= maxPoolBytes) {
        // 随机访问已有内存，保持物理页活跃
        if (memoryPool.length > 0) {
            const idx = Math.floor(Math.random() * memoryPool.length);
            memoryPool[idx][0] = 0xAB;
        }

        return {
            method: 'memory',
            allocMB: 0,
            poolTotalMB: Math.round(poolTotalBytes / (1024 * 1024)),
            maxPoolMB,
            saturation: Math.round((poolTotalBytes / maxPoolBytes) * 100),
            mode: 'hold',
            workerCount,
            targetSaturation,
            checksum: memoryPool.length > 0 ? memoryPool[0][0] : 0,
            timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
        };
    }

    // 未达到饱和度时，继续分配内存
    // 动态默认值：小内存机器用小值，大内存机器用较大值（上限放宽到 80MB）
    const allocMB = params.allocMB || Math.max(20, Math.min(80, Math.floor(totalMemGB * 2)));
    const size = allocMB * 1024 * 1024;

    // 如果本次分配会超出配额，调整分配大小（最后一次分配精确封顶）
    const remainingBytes = maxPoolBytes - poolTotalBytes;
    const actualSize = Math.min(size, remainingBytes);

    if (actualSize > 0) {
        // ═══════════════════════════════════════════════════════════════════════
        //  核心：allocUnsafe 不清零，仅稀疏 touch 触发物理页分配
        // ═══════════════════════════════════════════════════════════════════════
        const buffer = Buffer.allocUnsafe(actualSize);
        const pageSize = 4096;
        for (let i = 0; i < actualSize; i += pageSize) {
            buffer[i] = 0xAB;
        }

        // 保留引用，防止 GC 回收
        memoryPool.push(buffer);
        poolTotalBytes += actualSize;
    }

    const currentPoolMB = Math.round(poolTotalBytes / (1024 * 1024));
    const saturation = Math.round((poolTotalBytes / maxPoolBytes) * 100);

    // 调试日志：确认内存池增长
    console.log(`[memory_method] 分配 ${Math.round(actualSize / (1024 * 1024))}MB，当前池大小 ${currentPoolMB}MB/${maxPoolMB}MB (饱和度:${saturation}%)，系统空闲 ${Math.round(os.freemem() / (1024 * 1024))}MB`);

    // 极简扫描：只读取第一个字节，防止 V8 编译器优化掉分配操作
    const checksum = memoryPool.length > 0 ? memoryPool[memoryPool.length - 1][0] : 0;

    return {
        method: 'memory',
        allocMB: Math.round(actualSize / (1024 * 1024)),
        poolTotalMB: currentPoolMB,
        maxPoolMB,
        saturation,
        mode: saturation >= 100 ? 'hold' : 'fill',
        workerCount,
        targetSaturation,
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
