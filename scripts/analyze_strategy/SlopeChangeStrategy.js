const BaseStrategy = require('./_BaseStrategy');

/**
 * SlopeChangeStrategy - 线性回归斜率变化拐点检测策略
 *
 * 原理：维护两个连续的回归窗口，分别计算线性回归斜率。
 * 当斜率从接近 0（平稳）突变为显著正值（快速上升）时，判定为拐点。
 *
 * 配置项：
 *   - windowSize: 每个回归窗口的数据点数（默认 15）
 *   - slopeThreshold: 斜率变化阈值（默认 0.3）
 *   - sustainCount: 持续超过阈值的次数（默认 2）
 *   - minDataPoints: 最小数据点数（默认 30）
 */
class SlopeChangeStrategy extends BaseStrategy {
    constructor(config, logger) {
        super(config, logger);
        this.algorithmName = 'slopeChange';
        this.windowSize = config.windowSize || 15;
        this.slopeThreshold = config.slopeThreshold || 0.3;
        this.sustainCount = config.sustainCount || 2;
        this.minDataPoints = config.minDataPoints || 30;

        this.latencies = [];
        this.sustained = 0;
        this.triggered = false;
        this.result = null;
    }

    _detect(point, elapsedMs) {
        if (this.triggered) return;

        this.latencies.push(point.latency);

        if (this.latencies.length < this.minDataPoints + this.windowSize * 2) {
            return;
        }

        const recent = this.latencies.slice(-this.windowSize * 2);
        const prevWindow = recent.slice(0, this.windowSize);
        const currWindow = recent.slice(this.windowSize);

        const slopePrev = this._linearRegressionSlope(prevWindow);
        const slopeCurr = this._linearRegressionSlope(currWindow);
        const slopeChange = slopeCurr - slopePrev;

        if (slopeChange > this.slopeThreshold && slopeCurr > 0) {
            this.sustained++;
            this.logger.info(`[SlopeChangeStrategy] 斜率变化 ${slopeChange.toFixed(2)} 超过阈值(${this.slopeThreshold})，持续计数: ${this.sustained}/${this.sustainCount}`);

            if (this.sustained >= this.sustainCount) {
                this.triggered = true;
                const meanPrev = prevWindow.reduce((a, b) => a + b, 0) / prevWindow.length;
                const meanCurr = currWindow.reduce((a, b) => a + b, 0) / currWindow.length;
                const ratio = meanPrev > 0 ? meanCurr / meanPrev : 1;

                this.result = {
                    timestamp: new Date().toISOString(),
                    vus: point.vus,
                    avgLatencyPrevMs: parseFloat(meanPrev.toFixed(2)),
                    avgLatencyCurrMs: parseFloat(meanCurr.toFixed(2)),
                    ratio: parseFloat(ratio.toFixed(2)),
                    totalDataPoints: this.latencies.length,
                    rps: point.rps || 0,
                    elapsedMs,
                    slopePrev: parseFloat(slopePrev.toFixed(3)),
                    slopeCurr: parseFloat(slopeCurr.toFixed(3)),
                    slopeChange: parseFloat(slopeChange.toFixed(3))
                };
                this.logger.info(`🚨 [SlopeChangeStrategy] 性能拐点检测到! VUs=${point.vus}, 斜率变化=${slopeChange.toFixed(2)}, 前一斜率=${slopePrev.toFixed(2)}, 当前斜率=${slopeCurr.toFixed(2)}`);
            }
        } else {
            if (this.sustained > 0) {
                this.sustained = 0;
                this.logger.info(`[SlopeChangeStrategy] 斜率变化 ${slopeChange.toFixed(2)} 未超过阈值，重置持续计数`);
            }
        }
    }

    _linearRegressionSlope(values) {
        const n = values.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += values[i];
            sumXY += i * values[i];
            sumXX += i * i;
        }
        const denominator = n * sumXX - sumX * sumX;
        if (denominator === 0) return 0;
        return (n * sumXY - sumX * sumY) / denominator;
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

module.exports = SlopeChangeStrategy;
