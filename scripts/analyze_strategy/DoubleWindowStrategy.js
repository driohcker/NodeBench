const BaseStrategy = require('./_BaseStrategy');

/**
 * DoubleWindowStrategy - 双滑动窗口均值比较分析策略
 *
 * 改进版：使用全局 baseline（测试开始时的低负载基准）而非滑动窗口，
 * 计算当前窗口均值相对于全局基准的倍数。这样能够检测"延迟从低负载
 * 基准增长了多少倍"，而不是"最近两个窗口的变化"，更适合 ramp-up
 * 场景下的拐点识别。
 *
 * 配置项：
 *   - windowSize: 每个窗口的数据点数（默认 15）
 *   - optimalThreshold: 最优拐点阈值倍数（默认 3.5）
 *   - maxThreshold: 最大拐点阈值倍数（默认 8.0）
 *   - sustainCount: 持续超过阈值的次数（默认 3）
 *   - minDataPoints: 最小数据点数（默认 30）
 */
class DoubleWindowStrategy extends BaseStrategy {
    constructor(config, logger) {
        super(config, logger);
        this.algorithmName = 'doubleWindow';
        this.windowSize = config.windowSize || 15;
        this.optimalThreshold = config.optimalThreshold || 3.5;
        this.maxThreshold = config.maxThreshold || 8.0;
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
            this.logger.info(`[DoubleWindowStrategy] 全局基线建立: ${this.globalBaselineMean.toFixed(2)}ms`);
        }

        if (this.globalBaselineMean === null || this.latencies.length < this.minDataPoints + this.windowSize) {
            return;
        }

        const currWindow = this.latencies.slice(-this.windowSize);
        const meanCurr = currWindow.reduce((a, b) => a + b, 0) / currWindow.length;

        if (this.globalBaselineMean <= 0.001) return;

        const ratio = meanCurr / this.globalBaselineMean;

        // ═══════════════════════════════════════════════════════
        //  动态阈值调整 + 错误率/RPS 辅助判断
        // ═══════════════════════════════════════════════════════
        const currErrorWindow = this.errorRateHistory.slice(-this.windowSize);
        const meanCurrError = currErrorWindow.reduce((a, b) => a + b, 0) / currErrorWindow.length;

        const currRpsWindow = this.rpsHistory.slice(-this.windowSize);
        const meanCurrRps = currRpsWindow.reduce((a, b) => a + b, 0) / currRpsWindow.length;

        const currVusWindow = this.vusHistory.slice(-this.windowSize);
        const meanCurrVus = currVusWindow.reduce((a, b) => a + b, 0) / currVusWindow.length;

        // 确定当前阶段的目标阈值
        const isOptimalPhase = !this.detectedOptimal;
        const baseThreshold = isOptimalPhase ? this.optimalThreshold : this.maxThreshold;
        let effectiveThreshold = baseThreshold;
        let thresholdReason = 'base';

        // 系统仍在健康增长（低错误率 + RPS 增长）→ optimal 阶段提高阈值
        if (isOptimalPhase && meanCurrError < 1.0 && meanCurrRps > 0) {
            effectiveThreshold = baseThreshold * 1.2;
            thresholdReason = 'healthy';
        }
        // 系统已过载 → 降低阈值
        else if (meanCurrError > 2.0) {
            effectiveThreshold = baseThreshold * 0.7;
            thresholdReason = 'overloaded';
        }

        if (ratio > effectiveThreshold) {
            this.sustained++;
            this.logger.info(`[DoubleWindowStrategy] 当前均值/基线=${ratio.toFixed(2)} 超过阈值(${effectiveThreshold.toFixed(2)}, ${thresholdReason})，持续: ${this.sustained}/${this.sustainCount}, VUs=${meanCurrVus.toFixed(0)}, errorRate=${meanCurrError.toFixed(2)}%`);

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
                this.logger.info(`🚨 [DoubleWindowStrategy] 性能拐点检测到! VUs=${point.vus}, 延迟比=${ratio.toFixed(2)}, 基线=${this.globalBaselineMean.toFixed(2)}ms, 当前=${meanCurr.toFixed(2)}ms`);
            }
        } else {
            if (this.sustained > 0) {
                this.sustained = 0;
                this.logger.info(`[DoubleWindowStrategy] 比值 ${ratio.toFixed(2)} 未超过阈值(${effectiveThreshold.toFixed(2)})，重置持续计数`);
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
        // 保留全局基线，重置触发状态
        this.sustained = 0;
        this.triggered = false;
        this.result = null;
        this.logger.info('[DoubleWindowStrategy] 算法已重置（保留全局基线），继续检测最大拐点');
    }
}

module.exports = DoubleWindowStrategy;
