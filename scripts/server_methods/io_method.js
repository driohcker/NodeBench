/**
 * IO 性能测试方法
 *
 * 设计思路：
 * 1. 使用远大于系统可用缓存的测试文件（2GB），降低文件系统缓存命中率
 * 2. 大量随机位置同步读取，模拟数据库/缓存的高并发查询场景
 * 3. 预创建固定大小的测试文件，避免每次调用都重新生成数据
 *
 * 与 Disk 方法的区别：
 *   - Disk：追加写入 + fsync，测试写入吞吐量和刷盘延迟
 *   - IO：随机读取，测试读取并发能力和缓存效率
 */
const fs = require('fs');
const path = require('path');

const TEST_FILE = 'io_benchmark.dat';
const FILE_SIZE_MB = 2048; // 2GB 测试文件，远大于一般 OS 缓存，迫使真实磁盘 I/O

function ensureTestFile(filePath, size) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size === size) {
        return;
    }
    // 文件不存在或大小不符，重新创建
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
    const fd = fs.openSync(filePath, 'w');
    const block = Buffer.alloc(64 * 1024);
    const count = size / block.length;
    for (let i = 0; i < count; i++) {
        fs.writeSync(fd, block);
    }
    fs.closeSync(fd);
}

function execute(params = {}) {
    const blockSize = params.blockSize || (32 * 1024); // 32KB 块
    const readCount = params.readCount || 8000;
    const tempDir = params.tempDir || path.join(process.cwd(), 'temp');

    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, TEST_FILE);
    const fileSize = FILE_SIZE_MB * 1024 * 1024;
    ensureTestFile(filePath, fileSize);

    const readBuffer = Buffer.alloc(blockSize);
    const startTime = Date.now();

    // 大量随机位置同步读取，模拟高并发查询场景
    // 在高负载下，多个并发请求同时进行随机读，会饱和 I/O 子系统
    const fd = fs.openSync(filePath, 'r');
    for (let i = 0; i < readCount; i++) {
        const pos = Math.floor(Math.random() * (fileSize - blockSize));
        fs.readSync(fd, readBuffer, 0, blockSize, pos);
    }
    fs.closeSync(fd);

    const endTime = Date.now();

    return {
        method: 'io',
        blockSize,
        readCount,
        readBytes: blockSize * readCount,
        fileSizeMB: FILE_SIZE_MB,
        duration: endTime - startTime,
        timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
    };
}

module.exports = {
    execute
};
