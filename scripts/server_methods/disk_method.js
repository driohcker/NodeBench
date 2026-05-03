const fs = require('fs');
const path = require('path');

function execute(params = {}) {
    const size = params.size || 1024 * 1024;
    const iterations = params.iterations || 10;
    const tempDir = params.tempDir || path.join(process.cwd(), 'temp');
    
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const startTime = Date.now();
    const writeResults = [];
    const readResults = [];
    
    for (let i = 0; i < iterations; i++) {
        const filePath = path.join(tempDir, `test_disk_${i}.tmp`);
        const data = Buffer.alloc(size, Math.random().toString());
        
        const writeStart = Date.now();
        fs.writeFileSync(filePath, data);
        const writeEnd = Date.now();
        
        writeResults.push({
            iteration: i + 1,
            size: size,
            duration: writeEnd - writeStart,
            throughput: size / (writeEnd - writeStart) / 1024
        });
        
        const readStart = Date.now();
        const readData = fs.readFileSync(filePath);
        const readEnd = Date.now();
        
        readResults.push({
            iteration: i + 1,
            size: size,
            duration: readEnd - readStart,
            throughput: size / (readEnd - readStart) / 1024
        });
        
        fs.unlinkSync(filePath);
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    return {
        method: 'disk',
        size: size,
        iterations: iterations,
        duration: duration,
        writeResults: writeResults,
        readResults: readResults,
        avgWriteThroughput: writeResults.reduce((sum, item) => sum + item.throughput, 0) / writeResults.length,
        avgReadThroughput: readResults.reduce((sum, item) => sum + item.throughput, 0) / readResults.length,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    execute
};
