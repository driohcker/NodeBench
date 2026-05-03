function execute(params = {}) {
    const size = params.size || 10000000;
    const iterations = params.iterations || 5;
    
    const startTime = Date.now();
    const memoryUsage = [];
    
    for (let i = 0; i < iterations; i++) {
        const beforeMemory = process.memoryUsage();
        
        const array = new Array(size).fill(Math.random());
        
        const afterMemory = process.memoryUsage();
        
        memoryUsage.push({
            iteration: i + 1,
            heapUsed: afterMemory.heapUsed - beforeMemory.heapUsed,
            heapTotal: afterMemory.heapTotal - beforeMemory.heapTotal,
            rss: afterMemory.rss - beforeMemory.rss
        });
        
        array.length = 0;
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    return {
        method: 'memory',
        size: size,
        iterations: iterations,
        duration: duration,
        memoryUsage: memoryUsage,
        avgMemoryUsed: memoryUsage.reduce((sum, item) => sum + item.heapUsed, 0) / memoryUsage.length,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    execute
};
