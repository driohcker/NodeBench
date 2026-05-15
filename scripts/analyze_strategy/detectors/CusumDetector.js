const BaseDetector = require('./BaseDetector');

/**
 * CusumDetector - CUSUM 累积和突变检测器（严格按论文实现）
 *
 * 算法逻辑：
 *   在测试初始阶段（前 N 个采样点）计算基线均值 μ_0 和标准差 σ。
 *   S_0 = 0
 *   S_t = max(0, S_{t-1} + x_t - μ_0 - c)
 *
 * 其中：
 *   - c = cMultiplier × σ  为自适应偏移量
 *   - H = HMultiplier × σ  为自适应阈值
 *   当 S_t > H 连续 sustainCount 次时，确认突变。
 *
 * 参数：
 *   - baselinePoints (N): 建立基线所需的点数，默认 20
 *   - cMultiplier: 偏移量倍数系数，默认 0.5
 *   - HMultiplier: 阈值倍数系数，默认 4.0
 *   - sustainCount: 连续超过阈值次数，默认 3
 */
class CusumDetector extends BaseDetector {
    constructor(config = {}) {
        super(config);
        this.baselinePoints = config.baselinePoints || 20;
        this.cMultiplier = config.cMultiplier || 0.5;
        this.HMultiplier = config.HMultiplier || 4.0;
        this.sustainCount = config.sustainCount || 3;

        this.dataStream = [];
        this.S = 0;
        this.mu0 = null;
        this.sigma = null;
        this.c = null;
        this.H = null;
        this.consecutiveCount = 0;
        this.triggered = false;
    }

    feed(value) {
        this.dataStream.push(value);

        if (this.triggered) {
            return false;
        }

        // ═══════════════════════════════════════════════════════
        //  阶段一：建立基线（μ_0 和 σ）
        // ═══════════════════════════════════════════════════════
        if (this.mu0 === null) {
            if (this.dataStream.length < this.baselinePoints) {
                return false;
            }
            const baseline = this.dataStream.slice(0, this.baselinePoints);
            this.mu0 = baseline.reduce((a, b) => a + b, 0) / this.baselinePoints;

            // 计算标准差 σ
            const variance = baseline.reduce((sq, v) => sq + (v - this.mu0) ** 2, 0) / this.baselinePoints;
            this.sigma = Math.sqrt(variance);

            // 防止 σ 为 0 或极小值导致 c/H 失效
            const effectiveSigma = this.sigma < 1e-6 ? 1e-6 : this.sigma;
            this.c = this.cMultiplier * effectiveSigma;
            this.H = this.HMultiplier * effectiveSigma;
        }

        // ═══════════════════════════════════════════════════════
        //  阶段二：CUSUM 累积和更新
        // ═══════════════════════════════════════════════════════
        this.S = Math.max(0, this.S + value - this.mu0 - this.c);

        if (this.S > this.H) {
            this.consecutiveCount++;
            if (this.consecutiveCount >= this.sustainCount) {
                this.triggered = true;
                return true;
            }
        } else {
            this.consecutiveCount = 0;
        }

        return false;
    }

    isChangePointDetected() {
        return this.triggered;
    }

    getChangePointInfo() {
        if (!this.triggered) return null;
        return {
            baselinePoints: this.baselinePoints,
            cMultiplier: this.cMultiplier,
            HMultiplier: this.HMultiplier,
            sustainCount: this.sustainCount,
            mu0: this.mu0,
            sigma: this.sigma,
            c: this.c,
            H: this.H,
            S: this.S,
            dataPointsProcessed: this.dataStream.length
        };
    }

    reset() {
        this.dataStream = [];
        this.S = 0;
        this.mu0 = null;
        this.sigma = null;
        this.c = null;
        this.H = null;
        this.consecutiveCount = 0;
        this.triggered = false;
    }
}

module.exports = CusumDetector;
