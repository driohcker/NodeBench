const BaseStrategy = require('./_BaseStrategy');

/**
 * CusumStrategy - CUSUM（累积和）拐点检测策略
 *
 * 原理：计算累积偏差和 S_i = max(0, S_{i-1} + (x_i - mu) / sigma - k)
 * 当 S_i > h 时触发拐点。
 *
 * 配置项：
 *   - baselinePoints: 计算基准的初始点数（默认 20）
 *   - cMultiplier: 允许偏移 c 相对于 sigma 的倍数（默认 0.5）
 *   - HMultiplier: 阈值 H 相对于 sigma 的倍数（默认 4.0）
 *   - minDataPoints: 最小数据点数（默认 20）
 */
class CusumStrategy extends BaseStrategy {
    constructor(config, logger) {
        super(config, logger);
        this.algorithmName = 'cusum';
        this.baselinePoints = config.baselinePoints || 20;
        this.cMultiplier = config.cMultiplier || 0.5;
        this.HMultiplier = config.HMultiplier || 4.0;
        this.minDataPoints = config.minDataPoints || 20;

        this.latencies = [];
        this.cusumPos = 0;
        this.cusumNeg = 0;
        this.baselineMean = 0;
        this.baselineStd = 0;
        this.baselineReady = false;
        this.triggered = false;
        this.result = null;
    }

    _detect(point, elapsedMs) {
        if (this.triggered) return;

        this.latencies.push(point.latency);

        if (this.latencies.length < this.minDataPoints) {
            return;
        }

        // 计算基准均值和标准差（使用前 baselinePoints 个点）
        if (!this.baselineReady) {
            const baseline = this.latencies.slice(0, this.baselinePoints);
            this.baselineMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
            const variance = baseline.reduce((sum, v) => sum + Math.pow(v - this.baselineMean, 2), 0) / baseline.length;
            this.baselineStd = Math.sqrt(variance) || 1;
            this.baselineReady = true;
            this.logger.info(`[CusumStrategy] 基准建立: mean=${this.baselineMean.toFixed(2)}, std=${this.baselineStd.toFixed(2)}`);
        }

        const value = point.latency;
        const c = this.cMultiplier * this.baselineStd;
        const H = this.HMultiplier * this.baselineStd;
        const deviation = value - this.baselineMean;

        // 正方向累积和（延迟上升）
        this.cusumPos = Math.max(0, this.cusumPos + deviation - c);
        // 负方向累积和（延迟下降，通常不关注）
        this.cusumNeg = Math.max(0, this.cusumNeg - deviation - c);

        if (this.cusumPos > H) {
            this.triggered = true;
            const ratio = this.baselineMean > 0 ? value / this.baselineMean : 1;
            this.result = {
                timestamp: new Date().toISOString(),
                vus: point.vus,
                avgLatencyPrevMs: parseFloat(this.baselineMean.toFixed(2)),
                avgLatencyCurrMs: parseFloat(value.toFixed(2)),
                ratio: parseFloat(ratio.toFixed(2)),
                totalDataPoints: this.latencies.length,
                rps: point.rps || 0,
                elapsedMs,
                cusumValue: parseFloat(this.cusumPos.toFixed(2)),
                threshold: parseFloat(H.toFixed(2))
            };
            this.logger.info(`🚨 [CusumStrategy] 性能拐点检测到! VUs=${point.vus}, CUSUM=${this.cusumPos.toFixed(2)}, threshold=${h.toFixed(2)}, 当前延迟=${value.toFixed(2)}ms`);
        } else {
            this.logger.debug(`[CusumStrategy] deviation=${deviation.toFixed(2)}, cusumPos=${this.cusumPos.toFixed(2)}, threshold=${h.toFixed(2)}`);
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
        this.cusumPos = 0;
        this.cusumNeg = 0;
        this.baselineMean = 0;
        this.baselineStd = 0;
        this.baselineReady = false;
        this.triggered = false;
        this.result = null;
    }
}

module.exports = CusumStrategy;
