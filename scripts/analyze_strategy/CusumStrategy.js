const BaseStrategy = require('./_BaseStrategy');

/**
 * CusumStrategy - 基于全局基线倍数的拐点检测策略
 *
 * 原 CUSUM 累积和算法在 ramp-up 线性增长场景下会立即触发（因为
 * 每个点的 deviation 始终为正，累积和单调递增）。
 *
 * 改进版：改用与 DoubleWindow 一致的"当前窗口均值 / 全局基线倍数"模型。
 * 最优拐点 = 延迟持续 > optimalRatio × baseline
 * 最大拐点 = 延迟持续 > maxRatio × baseline
 *
 * 配置项：
 *   - windowSize: 当前均值窗口大小（默认 15）
 *   - optimalRatio: 最优拐点倍数（默认 3.5）
 *   - maxRatio: 最大拐点倍数（默认 8.0）
 *   - sustainCount: 持续超过阈值的次数（默认 3）
 *   - minDataPoints: 最小数据点数（默认 30）
 */
class CusumStrategy extends BaseStrategy {
    constructor(config, logger) {
        super(config, logger);
        this.algorithmName = 'cusum';
        this.windowSize = config.windowSize || 15;
        this.optimalRatio = config.optimalRatio || 3.5;
        this.maxRatio = config.maxRatio || 8.0;
        this.sustainCount = config.sustainCount || 3;
        this.minDataPoints = config.minDataPoints || 30;

        this.latencies = [];
        this.vusHistory = [];
        this.rpsHistory = [];
        this.errorRateHistory = [];
        this.sustained = 0;
        this.triggered = false;
        this.result = null;
        this.globalBaselineMean = null;
    }

    _detect(point, elapsedMs) {
        if (this.triggered) return;

        this.latencies.push(point.latency);
        this.vusHistory.push(point.vus);
        this.rpsHistory.push(point.rps || 0);
        this.errorRateHistory.push(point.errorRate || 0);

        // 建立全局 baseline（前 windowSize 个点的均值）
        if (this.globalBaselineMean === null && this.latencies.length >= this.windowSize) {
            const baseline = this.latencies.slice(0, this.windowSize);
            this.globalBaselineMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
            this.logger.info(`[CusumStrategy] 全局基线建立: ${this.globalBaselineMean.toFixed(2)}ms`);
        }

        if (this.globalBaselineMean === null || this.latencies.length < this.minDataPoints + this.windowSize) {
            return;
        }

        const currWindow = this.latencies.slice(-this.windowSize);
        const meanCurr = currWindow.reduce((a, b) => a + b, 0) / currWindow.length;

        if (this.globalBaselineMean <= 0.001) return;

        const ratio = meanCurr / this.globalBaselineMean;

        const currErrorWindow = this.errorRateHistory.slice(-this.windowSize);
        const meanCurrError = currErrorWindow.reduce((a, b) => a + b, 0) / currErrorWindow.length;

        const currRpsWindow = this.rpsHistory.slice(-this.windowSize);
        const meanCurrRps = currRpsWindow.reduce((a, b) => a + b, 0) / currRpsWindow.length;

        const currVusWindow = this.vusHistory.slice(-this.windowSize);
        const meanCurrVus = currVusWindow.reduce((a, b) => a + b, 0) / currVusWindow.length;

        const isOptimalPhase = !this.detectedOptimal;
        const baseThreshold = isOptimalPhase ? this.optimalRatio : this.maxRatio;
        let effectiveThreshold = baseThreshold;
        let thresholdReason = 'base';

        if (isOptimalPhase && meanCurrError < 1.0 && meanCurrRps > 0) {
            effectiveThreshold = baseThreshold * 1.2;
            thresholdReason = 'healthy';
        } else if (meanCurrError > 2.0) {
            effectiveThreshold = baseThreshold * 0.7;
            thresholdReason = 'overloaded';
        }

        if (ratio > effectiveThreshold) {
            this.sustained++;
            this.logger.info(`[CusumStrategy] 当前均值/基线=${ratio.toFixed(2)} 超过阈值(${effectiveThreshold.toFixed(2)}, ${thresholdReason})，持续: ${this.sustained}/${this.sustainCount}, VUs=${meanCurrVus.toFixed(0)}, errorRate=${meanCurrError.toFixed(2)}%`);

            if (this.sustained >= this.sustainCount) {
                this.triggered = true;
                this.result = {
                    timestamp: new Date().toISOString(),
                    vus: point.vus,
                    avgLatencyPrevMs: parseFloat(this.globalBaselineMean.toFixed(2)),
                    avgLatencyCurrMs: parseFloat(meanCurr.toFixed(2)),
                    ratio: parseFloat(ratio.toFixed(2)),
                    effectiveThreshold: parseFloat(effectiveThreshold.toFixed(2)),
                    totalDataPoints: this.latencies.length,
                    rps: point.rps || 0,
                    errorRate: point.errorRate || 0,
                    elapsedMs
                };
                this.logger.info(`🚨 [CusumStrategy] 性能拐点检测到! VUs=${point.vus}, 延迟比=${ratio.toFixed(2)}, 基线=${this.globalBaselineMean.toFixed(2)}ms, 当前=${meanCurr.toFixed(2)}ms`);
            }
        } else {
            if (this.sustained > 0) {
                this.sustained = 0;
                this.logger.info(`[CusumStrategy] 比值 ${ratio.toFixed(2)} 未超过阈值(${effectiveThreshold.toFixed(2)})，重置持续计数`);
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
        this.sustained = 0;
        this.triggered = false;
        this.result = null;
        this.logger.info('[CusumStrategy] 算法已重置（保留全局基线），继续检测最大拐点');
    }
}

module.exports = CusumStrategy;
