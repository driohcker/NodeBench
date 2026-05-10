const BaseStrategy = require('./_BaseStrategy');

/**
 * SlopeChangeStrategy - 线性回归斜率变化拐点检测策略
 *
 * 改进版：使用全局归一化斜率。计算当前窗口 latency 相对于 VU 的
 * 归一化斜率（latency per VU），并与全局基准斜率比较。
 *
 * 配置项：
 *   - windowSize: 每个回归窗口的数据点数（默认 15）
 *   - optimalSlopeMultiplier: 最优拐点斜率倍数（默认 2.0）
 *   - maxSlopeMultiplier: 最大拐点斜率倍数（默认 4.0）
 *   - sustainCount: 持续超过阈值的次数（默认 3）
 *   - minDataPoints: 最小数据点数（默认 30）
 */
class SlopeChangeStrategy extends BaseStrategy {
    constructor(config, logger) {
        super(config, logger);
        this.algorithmName = 'slopeChange';
        this.windowSize = config.windowSize || 15;
        this.optimalSlopeMultiplier = config.optimalSlopeMultiplier || 2.0;
        this.maxSlopeMultiplier = config.maxSlopeMultiplier || 4.0;
        this.sustainCount = config.sustainCount || 3;
        this.minDataPoints = config.minDataPoints || 30;

        this.points = []; // {latency, vus}
        this.sustained = 0;
        this.triggered = false;
        this.result = null;
        this.globalBaselineSlope = null;
    }

    _detect(point, elapsedMs) {
        if (this.triggered) return;

        this.points.push({ latency: point.latency, vus: point.vus, rps: point.rps || 0, errorRate: point.errorRate || 0 });

        // 建立全局 baseline 斜率（前 windowSize 个点的 latency/vus 斜率）
        if (this.globalBaselineSlope === null && this.points.length >= this.windowSize) {
            const baseline = this.points.slice(0, this.windowSize);
            this.globalBaselineSlope = this._latencyPerVuSlope(baseline);
            this.logger.info(`[SlopeChangeStrategy] 全局基线斜率建立: ${this.globalBaselineSlope.toFixed(4)} ms/VU`);
        }

        if (this.globalBaselineSlope === null || this.points.length < this.minDataPoints + this.windowSize) {
            return;
        }

        const currWindow = this.points.slice(-this.windowSize);
        const currSlope = this._latencyPerVuSlope(currWindow);

        if (this.globalBaselineSlope <= 0.001) return;

        const slopeRatio = currSlope / this.globalBaselineSlope;

        const isOptimalPhase = !this.detectedOptimal;
        const baseMultiplier = isOptimalPhase ? this.optimalSlopeMultiplier : this.maxSlopeMultiplier;
        let effectiveMultiplier = baseMultiplier;

        // 低错误率时提高 optimal 阈值
        const meanError = currWindow.reduce((a, b) => a + b.errorRate, 0) / currWindow.length;
        if (isOptimalPhase && meanError < 1.0) {
            effectiveMultiplier = baseMultiplier * 1.2;
        } else if (meanError > 2.0) {
            effectiveMultiplier = baseMultiplier * 0.7;
        }

        if (slopeRatio > effectiveMultiplier && currSlope > 0) {
            this.sustained++;
            this.logger.info(`[SlopeChangeStrategy] 归一化斜率比 ${slopeRatio.toFixed(2)} 超过阈值(${effectiveMultiplier.toFixed(2)})，持续: ${this.sustained}/${this.sustainCount}`);

            if (this.sustained >= this.sustainCount) {
                this.triggered = true;
                const meanPrev = this.points.slice(-this.windowSize * 2, -this.windowSize).reduce((a, b) => a + b.latency, 0) / this.windowSize;
                const meanCurr = currWindow.reduce((a, b) => a + b.latency, 0) / currWindow.length;
                const ratio = meanPrev > 0 ? meanCurr / meanPrev : 1;

                this.result = {
                    timestamp: new Date().toISOString(),
                    vus: point.vus,
                    avgLatencyPrevMs: parseFloat(meanPrev.toFixed(2)),
                    avgLatencyCurrMs: parseFloat(meanCurr.toFixed(2)),
                    ratio: parseFloat(ratio.toFixed(2)),
                    effectiveThreshold: parseFloat(effectiveMultiplier.toFixed(2)),
                    totalDataPoints: this.points.length,
                    rps: point.rps || 0,
                    errorRate: point.errorRate || 0,
                    elapsedMs,
                    baselineSlope: parseFloat(this.globalBaselineSlope.toFixed(4)),
                    currSlope: parseFloat(currSlope.toFixed(4)),
                    slopeRatio: parseFloat(slopeRatio.toFixed(2))
                };
                this.logger.info(`🚨 [SlopeChangeStrategy] 性能拐点检测到! VUs=${point.vus}, 斜率比=${slopeRatio.toFixed(2)}, 基线斜率=${this.globalBaselineSlope.toFixed(4)}, 当前斜率=${currSlope.toFixed(4)}`);
            }
        } else {
            if (this.sustained > 0) {
                this.sustained = 0;
                this.logger.info(`[SlopeChangeStrategy] 斜率比 ${slopeRatio.toFixed(2)} 未超过阈值，重置持续计数`);
            }
        }
    }

    /**
     * 计算 latency 相对于 vus 的归一化斜率（ms/VU）
     */
    _latencyPerVuSlope(points) {
        const n = points.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (let i = 0; i < n; i++) {
            const x = points[i].vus;
            const y = points[i].latency;
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
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
        // 保留全局基线斜率，重置触发状态
        this.sustained = 0;
        this.triggered = false;
        this.result = null;
        this.logger.info('[SlopeChangeStrategy] 算法已重置（保留全局基线斜率），继续检测最大拐点');
    }
}

module.exports = SlopeChangeStrategy;
