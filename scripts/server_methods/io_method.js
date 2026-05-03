const fs = require('fs');
const path = require('path');

function execute(params = {}) {
    const size = params.size || 1024 * 100;
    const iterations = params.iterations || 100;
    const tempDir = params.tempDir || path.join(process.cwd(), 'temp');
    
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const filePath = path.join(tempDir, `test_io.tmp`);
    const data = Buffer.alloc(size, Math.random().toString());
    
    fs.writeFileSync(filePath, data);
    
    const startTime = Date.now();
    const syncResults = [];
    const asyncResults = [];
    
    for (let i = 0; i < iterations; i++) {
        const syncStart = Date.now();
        const syncData = fs.readFileSync(filePath);
        const syncEnd = Date.now();
        
        syncResults.push({
            iteration: i + 1,
            duration: syncEnd - syncStart
        });
    }
    
    let asyncCompleted = 0;
    const asyncStart = Date.now();
    
    for (let i = 0; i < iterations; i++) {
        fs.readFile(filePath, (err, data) => {
            if (err) throw err;
            asyncCompleted++;
            
            if (asyncCompleted === iterations) {
                const asyncEnd = Date.now();
                
                asyncResults.push({
                    totalDuration: asyncEnd - asyncStart,
                    avgDuration: (asyncEnd - asyncStart) / iterations
                });
                
                fs.unlinkSync(filePath);
                
                const endTime = Date.now();
                const duration = endTime - startTime;
                
                const result = {
                    method: 'io',
                    size: size,
                    iterations: iterations,
                    duration: duration,
                    syncResults: syncResults,
                    asyncResults: asyncResults,
                    avgSyncTime: syncResults.reduce((sum, item) => sum + item.duration, 0) / syncResults.length,
                    avgAsyncTime: asyncResults[0].avgDuration,
                    timestamp: new Date().toISOString()
                };
                
                return result;
            }
        });
    }
    
    return {
        method: 'io',
        size: size,
        iterations: iterations,
        syncResults: syncResults,
        avgSyncTime: syncResults.reduce((sum, item) => sum + item.duration, 0) / syncResults.length,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    execute
};
