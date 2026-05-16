/**
 * Disk 性能测试方法
 *
 * 设计思路：
 * 1. 模拟数据库/日志系统的批量追加写入 + 强制刷盘（fsync）场景
 * 2. 将大写入拆分为多个小批次，每批次后 fsync，产生持续的磁盘写入压力
 * 3. 避免单次写入量过大导致响应时间不可控，同时通过多批次 fsync 绕过 OS 页缓存
 *
 * 与 IO 方法的区别：
 *   - Disk：追加写入 + fsync，测试写入吞吐量和刷盘延迟
 *   - IO：随机读取，测试读取并发能力和缓存效率
 */
const fs = require('fs');
const path = require('path');

const TEST_FILE = 'disk_benchmark.dat';
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB 上限

function execute(params = {}) {
    const blockSize = params.blockSize || (256 * 1024); // 256KB 块
    const batchCount = params.batchCount || 20;
    const writesPerBatch = params.writesPerBatch || 20;
    const tempDir = params.tempDir || path.join(process.cwd(), 'temp');

    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, TEST_FILE);

    // 若测试文件超过上限，删除重置
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_FILE_SIZE) {
        fs.unlinkSync(filePath);
    }

    const data = Buffer.alloc(blockSize, 'x');
    const startTime = Date.now();

    // 追加写入（模拟日志/事务追加），分批次 fsync 强制刷入物理磁盘
    const fd = fs.openSync(filePath, 'a');
    for (let b = 0; b < batchCount; b++) {
        for (let w = 0; w < writesPerBatch; w++) {
            fs.writeSync(fd, data);
        }
        fs.fsyncSync(fd); // 每批次强制刷盘，产生真实磁盘 I/O 压力
    }
    fs.closeSync(fd);

    const endTime = Date.now();

    return {
        method: 'disk',
        blockSize,
        batchCount,
        writesPerBatch,
        writtenBytes: blockSize * batchCount * writesPerBatch,
        fsyncCount: batchCount,
        duration: endTime - startTime,
        timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
    };
}

module.exports = {
    execute
};
