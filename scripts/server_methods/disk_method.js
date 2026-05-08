/**
 * Disk 性能测试方法
 *
 * 设计思路：
 * 1. 使用追加写入 + fsync 模拟真实业务中的日志/事务写入场景
 * 2. fsync 强制将数据从 OS 页缓存刷入物理磁盘，绕过文件系统缓存
 * 3. 维护一个持久化的测试文件，避免每次调用都重新创建（减少元数据开销）
 * 4. 文件大小限制在 50MB，防止撑满磁盘
 *
 * 平衡参数（轻载下约 20-50ms，SSD 更快、HDD 更慢）：
 *   - blockSize: 4KB（OS 标准页大小，模拟数据库块写入）
 *   - writeCount: 100 次（共写入 400KB）
 */
const fs = require('fs');
const path = require('path');

const TEST_FILE = 'disk_benchmark.dat';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB 上限

function execute(params = {}) {
    const blockSize = params.blockSize || 4096; // 4KB block
    const writeCount = params.writeCount || 3000; // 共写入约 12MB
    const tempDir = params.tempDir || path.join(process.cwd(), 'temp');

    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, TEST_FILE);

    // 如果测试文件超过上限，删除重置（防止撑满磁盘）
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > MAX_FILE_SIZE) {
        fs.unlinkSync(filePath);
    }

    const data = Buffer.alloc(blockSize, 'x');
    const startTime = Date.now();

    // 追加写入（模拟日志/事务追加），然后 fsync 强制刷盘
    const fd = fs.openSync(filePath, 'a');
    for (let i = 0; i < writeCount; i++) {
        fs.writeSync(fd, data);
    }
    fs.fsyncSync(fd); // 强制刷入物理磁盘，产生真实磁盘 I/O
    fs.closeSync(fd);

    const endTime = Date.now();

    return {
        method: 'disk',
        blockSize,
        writeCount,
        writtenBytes: blockSize * writeCount,
        duration: endTime - startTime,
        timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
    };
}

module.exports = {
    execute
};
