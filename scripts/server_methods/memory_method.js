/**
 * Memory 性能测试方法
 *
 * 设计思路：
 * 1. 分配一个较大的连续内存块（模拟缓存服务/大数据工作集）
 * 2. 通过大量伪随机位置访问破坏 CPU 缓存局部性，产生真实的内存带宽压力
 * 3. 使用质数步长避免缓存行对齐，确保每次访问都跨越不同缓存行
 *
 * 平衡参数（轻载下约 30-60ms）：
 *   - memSizeMB: 30MB（足够大以产生缓存不命中，又不过大导致 OOM）
 *   - accessCount: 30000 次随机访问
 */
function execute(params = {}) {
    const memSizeMB = params.memSizeMB || 30;
    const accessCount = params.accessCount || 1500000;

    // 分配连续内存（模拟真实业务中的缓存/工作集）
    const size = memSizeMB * 1024 * 1024;
    const buffer = Buffer.alloc(size);

    const startTime = Date.now();

    // 伪随机访问：质数步长 9973 确保跨越不同缓存行，破坏缓存局部性
    // 这是内存密集型操作的主要压力来源
    const step = 9973;
    for (let i = 0; i < accessCount; i++) {
        const idx = (i * step) % size;
        buffer[idx] = (buffer[idx] + 1) & 0xFF;
    }

    const endTime = Date.now();

    return {
        method: 'memory',
        memSizeMB,
        accessCount,
        duration: endTime - startTime,
        timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
    };
}

module.exports = {
    execute
};
