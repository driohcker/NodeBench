const BaseDetector = require('./BaseDetector');

/**
 * SlopeChangeDetector - 线性回归斜率变化突变检测器（严格按论文实现）
 *
 * 算法逻辑：
 *   维护一个固定大小的滑动窗口（最近 N 个数据点），每次新数据点到达后，
 *   以采样序号 i 为自变量、数据值 y_i 为因变量进行一元线性回归，估计斜率 β̂。
 *
 *   β̂ = Σ((i - ī)(y_i - ȳ)) / Σ((i - ī)^2)
 *
 *   计算当前窗口斜率 β̂_curr 与前一个窗口斜率 β̂_prev 的变化率：
 *     Δ = |β̂_curr - β̂_prev| / (β̂_prev + ε)
 *
 *   当 Δ > δ 连续 sustainCount 次时，确认拐点。
 *
 * 参数：
 *   - windowSize (N): 滑动窗口大小，默认 20
 *   - threshold (δ): 斜率变化率阈值，默认 1.0（斜率翻倍）
 *   - epsilon (ε): 防止除零小常数，默认 1e-6
 *   - sustainCount (k): 连续超过阈值次数，默认 3
 *   - minPoints: 开始检测前的最小数据点总数，默认 25
 */
class SlopeChangeDetector extends BaseDetector {
    constructor(config = {}) {
        super(config);
        this.N = config.windowSize || 20;
        this.delta = config.threshold || 1.0;
        this.epsilon = config.epsilon || 1e-6;
        this.sustainCount = config.sustainCount || 3;
        this.minPoints = config.minPoints || 25;

        this.dataStream = [];
        this.prevSlope = null;
        this.consecutiveCount = 0;
        this.triggered = false;
    }

    feed(value) {
        this.dataStream.push(value);

        if (this.triggered) {
            return false;
        }

        // 数据点不足，无法开始检测
        if (this.dataStream.length < this.minPoints) {
            return false;
        }

        // 取最近 N 个点作为当前窗口
        const currWindow = this.dataStream.slice(-this.N);
        const currSlope = this._linearRegressionSlope(currWindow);

        // 首次计算，保存为 prevSlope
        if (this.prevSlope === null) {
            this.prevSlope = currSlope;
            return false;
        }

        // 计算斜率变化率 Δ
        const denominator = this.prevSlope + this.epsilon;

        // β̂_prev <= 0 说明前一窗口不是上升趋势，不满足“加速上升”前提
        if (denominator <= 0) {
            this.prevSlope = currSlope;
            this.consecutiveCount = 0;
            return false;
        }

        const delta = Math.abs(currSlope - this.prevSlope) / denominator;

        if (delta > this.delta) {
            this.consecutiveCount++;
            if (this.consecutiveCount >= this.sustainCount) {
                this.triggered = true;
                return true;
            }
            // 斜率正在加速上升，保持 prevSlope 为旧基准（不更新），
            // 使得下一轮的 Δ 更容易持续超过阈值
        } else {
            this.consecutiveCount = 0;
            // 斜率已稳定，更新 prevSlope 为当前斜率，作为新的基准
            this.prevSlope = currSlope;
        }

        return false;
    }

    /**
     * 一元线性回归斜率估计
     * β̂ = Σ((i - ī)(y_i - ȳ)) / Σ((i - ī)^2)
     */
    _linearRegressionSlope(values) {
        const n = values.length;
        const meanI = (n - 1) / 2; // 0,1,...,n-1 的平均值
        const meanY = values.reduce((a, b) => a + b, 0) / n;

        let numerator = 0;
        let denominator = 0;
        for (let i = 0; i < n; i++) {
            numerator += (i - meanI) * (values[i] - meanY);
            denominator += (i - meanI) ** 2;
        }

        if (Math.abs(denominator) < 1e-10) {
            return 0;
        }
        return numerator / denominator;
    }

    isChangePointDetected() {
        return this.triggered;
    }

    getChangePointInfo() {
        if (!this.triggered) return null;
        return {
            windowSize: this.N,
            threshold: this.delta,
            epsilon: this.epsilon,
            sustainCount: this.sustainCount,
            minPoints: this.minPoints,
            prevSlope: this.prevSlope,
            dataPointsProcessed: this.dataStream.length
        };
    }

    reset() {
        this.dataStream = [];
        this.prevSlope = null;
        this.consecutiveCount = 0;
        this.triggered = false;
    }
}

module.exports = SlopeChangeDetector;
