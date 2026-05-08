function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

function execute(params = {}) {
    const iterations = params.iterations || 30;
    const startTime = Date.now();
    
    for (let i = 0; i < iterations; i++) {
        fibonacci(25);
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    return {
        method: 'cpu',
        iterations: iterations,
        duration: duration,
        avgTime: duration / iterations,
        timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
    };
}

module.exports = {
    execute
};
