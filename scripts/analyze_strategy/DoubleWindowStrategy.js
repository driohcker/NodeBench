const BaseStrategy = require('./_BaseStrategy');

/**
 * DoubleWindowStrategy - 双滑动窗口均值比较分析策略
 *
 * 维护两个连续的数据窗口，当当前窗口均值 / 历史窗口均值 > threshold
 * 且持续 sustainCount 次时，判定为性能拐点。
 *
 * 配置项：
 *   - windowSize: 每个窗口的数据点数（默认 10）
 *   - threshold: 延迟比阈值（默认 1.5）
 *   - sustainCount: 持续超过阈值的次数（默认 3）
 *   - minDataPoints: 最小数据点数（默认 20）
 */
class DoubleWindowStrategy extends BaseStrategy {
    constructor(config, logger) {
        super(config, logger);
        this.algorithmName = 'doubleWindow';
        this.windowSize = config.windowSize || 10;
        this.threshold = config.threshold || 1.5;
        this.sustainCount = config.sustainCount || 3;
        this.minDataPoints = config.minDataPoints || 20;

        this.latencies = [];
        this.sustained = 0;
        this.triggered = false;
        this.result = null;
    }

    _detect(point, elapsedMs) {
        if (this.triggered) return;

        this.latencies.push(point.latency);

        // 至少积累 minDataPoints + windowSize*2 个数据点才开始检测
        if (this.latencies.length < this.minDataPoints + this.windowSize * 2) {
            return;
        }

        const recent = this.latencies.slice(-this.windowSize * 2);
        const prevWindow = recent.slice(0, this.windowSize);
        const currWindow = recent.slice(this.windowSize);

        const meanPrev = prevWindow.reduce((a, b) => a + b, 0) / prevWindow.length;
        const meanCurr = currWindow.reduce((a, b) => a + b, 0) / currWindow.length;

        if (meanPrev <= 0.001) return;

        const ratio = meanCurr / meanPrev;

        if (ratio > this.threshold) {
            this.sustained++;
            this.logger.info(`[DoubleWindowStrategy] 窗口均值比 ${ratio.toFixed(2)} 超过阈值(${this.threshold})，持续计数: ${this.sustained}/${this.sustainCount}`);

            if (this.sustained >= this.sustainCount) {
                this.triggered = true;
                this.result = {
                    timestamp: new Date().toISOString(),
                    vus: point.vus,
                    avgLatencyPrevMs: parseFloat(meanPrev.toFixed(2)),
                    avgLatencyCurrMs: parseFloat(meanCurr.toFixed(2)),
                    ratio: parseFloat(ratio.toFixed(2)),
                    totalDataPoints: this.latencies.length,
                    rps: point.rps || 0,
                    elapsedMs
                };
                this.logger.info(`🚨 [DoubleWindowStrategy] 性能拐点检测到! VUs=${point.vus}, 延迟比=${ratio.toFixed(2)}`);
            }
        } else {
            if (this.sustained > 0) {
                this.sustained = 0;
                this.logger.info(`[DoubleWindowStrategy] 窗口均值比 ${ratio.toFixed(2)} 未超过阈值，重置持续计数`);
            }
        }
    }

    _isTriggered() {
        return this.triggered;
    }

    _getResult() {
        return this.result;
    }

    _resetAlgorithm() {
        this.latencies = [];
        this.sustained = 0;
        this.triggered = false;
        this.result = null;
    }
}

module.exports = DoubleWindowStrategy;
