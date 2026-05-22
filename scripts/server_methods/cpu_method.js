/**
 * CPU 性能测试方法
 *
 * 设计思路：
 * 1. 使用斐波那契递归计算，模拟真实业务中的复杂算法/逻辑运算
 * 2. 递归深度足够大，确保 V8 难以完全内联优化，产生稳定的 CPU 密集型负载
 * 3. 参数可配置，适应不同性能的机器
 */
function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

function execute(params = {}) {
    const n = params.fibN || 26;
    const iterations = params.iterations || 20;
    const startTime = Date.now();

    for (let i = 0; i < iterations; i++) {
        fibonacci(n);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    return {
        method: 'cpu',
        n,
        iterations,
        duration,
        avgTime: duration / iterations,
        timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
    };
}

module.exports = {
    meta: {
        name: 'cpu',
        displayName: 'CPU测试',
        description: '通过斐波那契递归计算产生CPU负载',
        category: 'server_method',
        params: [
            { name: 'fibN', type: 'number', default: 26, description: '斐波那契数列长度' },
            { name: 'iterations', type: 'number', default: 20, description: '迭代次数' }
        ]
    },
    execute
};
