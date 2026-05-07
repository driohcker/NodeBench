const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

async function execute(params = {}) {
    const size = params.size || 1024 * 100;
    const iterations = params.iterations || 100;
    const tempDir = params.tempDir || path.join(process.cwd(), 'temp');

    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, `test_io.tmp`);
    const data = Buffer.alloc(size, Math.random().toString());

    await fsPromises.writeFile(filePath, data);

    const startTime = Date.now();
    const syncResults = [];

    for (let i = 0; i < iterations; i++) {
        const syncStart = Date.now();
        fs.readFileSync(filePath);
        const syncEnd = Date.now();

        syncResults.push({
            iteration: i + 1,
            duration: syncEnd - syncStart
        });
    }

    const asyncStart = Date.now();
    const asyncPromises = [];

    for (let i = 0; i < iterations; i++) {
        asyncPromises.push(fsPromises.readFile(filePath));
    }

    await Promise.all(asyncPromises);
    const asyncEnd = Date.now();

    fs.unlinkSync(filePath);

    const endTime = Date.now();
    const duration = endTime - startTime;

    return {
        method: 'io',
        size: size,
        iterations: iterations,
        duration: duration,
        syncResults: syncResults,
        avgSyncTime: syncResults.reduce((sum, item) => sum + item.duration, 0) / syncResults.length,
        asyncResults: [{
            totalDuration: asyncEnd - asyncStart,
            avgDuration: (asyncEnd - asyncStart) / iterations
        }],
        avgAsyncTime: (asyncEnd - asyncStart) / iterations,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    execute
};
