const BaseDetector = require('./BaseDetector');

/**
 * DoubleWindowDetector - 双滑动窗口突变检测器
 *
 * 算法逻辑（严格按论文定义实现）：
 * 设性能指标序列为 x_1, x_2, ..., x_t。
 * 维护两个窗口：
 *   前窗 W_front = {x_(t-2N+1), ..., x_(t-N)}
 *   后窗 W_back  = {x_(t-N+1), ..., x_t}
 * 窗口大小 N 为可配置参数。
 *
 * 每到达一个新数据点，窗口滑动一位，计算两个窗口的均值：
 *   μ_front = mean(W_front)
 *   μ_back  = mean(W_back)
 *
 * 性能劣化场景采用单侧判定：
 *   μ_back / μ_front > T
 *
 * 为防止数据抖动导致的误报，引入连续触发计数 K：
 *   当且仅当连续 K 次刷新数据点均满足上述条件时，才最终确认突变点。
 *
 * 参数：
 *   - windowSize (N): 默认 15
 *   - threshold (T): 默认 1.8
 *   - sustainCount (K): 默认 3
 */
class DoubleWindowDetector extends BaseDetector {
    constructor(config = {}) {
        super(config);
        this.N = config.windowSize || 15;
        this.T = config.threshold || 1.8;
        this.K = config.sustainCount || 3;

        this.dataStream = [];
        this.consecutiveCount = 0;
        this.triggered = false;
    }

    feed(value) {
        this.dataStream.push(value);

        // 已经触发过，等待 reset 后才能再次触发
        if (this.triggered) {
            return false;
        }

        // 数据不足 2N，无法计算双窗口
        if (this.dataStream.length < 2 * this.N) {
            return false;
        }

        // 取最近 2N 个数据点
        const recent = this.dataStream.slice(-2 * this.N);
        const wFront = recent.slice(0, this.N);
        const wBack = recent.slice(this.N);

        const muFront = wFront.reduce((a, b) => a + b, 0) / this.N;
        const muBack = wBack.reduce((a, b) => a + b, 0) / this.N;

        // 前窗均值过小，避免除零或噪声干扰
        if (muFront <= 0.001) {
            this.consecutiveCount = 0;
            return false;
        }

        const ratio = muBack / muFront;

        if (ratio > this.T) {
            this.consecutiveCount++;
            if (this.consecutiveCount >= this.K) {
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
            windowSize: this.N,
            threshold: this.T,
            sustainCount: this.K,
            dataPointsProcessed: this.dataStream.length
        };
    }

    reset() {
        this.dataStream = [];
        this.consecutiveCount = 0;
        this.triggered = false;
    }
}

module.exports = DoubleWindowDetector;
