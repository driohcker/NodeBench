const fs = require('fs');

/**
 * StaticDataAdapter - 静态数据流适配器
 * 负责读取 metrics.json 文件，解析并计算标准化数据点，然后依次推送给分析策略。
 * 不依赖任何具体策略实现。
 */
class StaticDataAdapter {
    constructor(logger, strategy) {
        this.logger = logger;
        this.strategy = strategy;
    }

    /**
     * 从 metrics.json 文件读取数据并推送给策略
     * @param {string} metricsPath - metrics.json 文件路径
     */
    feedFromFile(metricsPath) {
        if (!this.strategy) {
            throw new Error('未绑定分析策略');
        }

        if (!fs.existsSync(metricsPath)) {
            throw new Error(`metrics文件不存在: ${metricsPath}`);
        }

        const content = fs.readFileSync(metricsPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());

        // 按秒时间桶聚合数据
        const buckets = new Map(); // key: 秒级时间戳, value: {latencies: [], vus: null, reqs: 0, errors: 0}

        for (const line of lines) {
            try {
                const obj = JSON.parse(line);
                if (obj.type !== 'Point') continue;

                const metric = obj.metric;
                const time = obj.data?.time;
                const value = obj.data?.value;
                if (time === undefined || value === undefined) continue;

                // 按秒分桶
                const bucketKey = Math.floor(time / 1000) * 1000;
                if (!buckets.has(bucketKey)) {
                    buckets.set(bucketKey, { latencies: [], vus: null, reqs: 0, errors: 0 });
                }
                const bucket = buckets.get(bucketKey);

                if (metric === 'http_req_duration') {
                    bucket.latencies.push(value);
                } else if (metric === 'vus') {
                    bucket.vus = value; // 取该秒最后一个 vus 值
                } else if (metric === 'http_reqs') {
                    bucket.reqs += value; // 累加请求数（每个请求 value=1）
                } else if (metric === 'http_req_failed') {
                    bucket.errors += value; // 累加错误数
                }
            } catch (e) {
                // 忽略解析错误
            }
        }

        // 按时间排序，依次推送给策略
        const sortedBuckets = Array.from(buckets.entries())
            .filter(([_, bucket]) => bucket.latencies.length > 0) // 只推有 latency 数据的桶
            .sort((a, b) => a[0] - b[0]);

        if (sortedBuckets.length === 0) {
            throw new Error('metrics文件中没有有效的http_req_duration数据');
        }

        this.logger.info(`[StaticDataAdapter] 读取 ${lines.length} 行，生成 ${sortedBuckets.length} 个标准化数据点`);

        for (const [timestamp, bucket] of sortedBuckets) {
            const avgLatency = bucket.latencies.reduce((a, b) => a + b, 0) / bucket.latencies.length;
            const errorRate = bucket.reqs > 0
                ? parseFloat(((bucket.errors / bucket.reqs) * 100).toFixed(2))
                : 0;
            // 系统吞吐量应只计算成功请求，失败请求不计入有效RPS
            const successReqs = Math.max(0, bucket.reqs - bucket.errors);
            const rps = successReqs; // 每秒成功请求数（因为桶是1秒）

            const dataPoint = {
                timestamp,
                vus: bucket.vus || 0,
                latency: parseFloat(avgLatency.toFixed(2)),
                rps: parseFloat(rps.toFixed(2)),
                errorRate
            };

            this.strategy.onDataPoint(dataPoint);
        }

        this.logger.info(`[StaticDataAdapter] 数据流推送完成，共 ${sortedBuckets.length} 个点`);
    }
}

module.exports = StaticDataAdapter;
