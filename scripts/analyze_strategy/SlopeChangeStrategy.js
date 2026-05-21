const BaseStrategy = require('./_BaseStrategy');
const SlopeChangeDetector = require('./detectors/SlopeChangeDetector');

/**
 * SlopeChangeStrategy - 线性回归斜率变化分析策略（重构版）
 *
 * 职责边界（严格按新架构划分）：
 *   - SlopeChangeDetector：纯算法实现，维护滑动窗口，通过比较相邻窗口
 *     的线性回归斜率变化率识别突变点。
 *   - SlopeChangeStrategy：只负责配置和实例化检测器。
 *   - BaseStrategy：接收突变点，结合资源负载/错误率等指标判断性能拐点。
 *
 * 算法特点：对响应时间从线性增长转变为指数增长前的斜率转折敏感，
 *   擅长捕捉趋势转折型劣化。
 *
 * 配置：
 *   - windowSize (N): 滑动窗口大小，默认 20
 *   - threshold (δ): 斜率变化率阈值，默认 1.0（斜率翻倍）
 *   - epsilon (ε): 防止除零小常数，默认 1e-6
 *   - sustainCount (k): 连续超过阈值次数，默认 3
 *   - minPoints: 开始检测前的最小数据点总数，默认 25
 */
class SlopeChangeStrategy extends BaseStrategy {
    static meta = {
        name: 'slopeChange',
        displayName: '斜率变化策略',
        description: '线性回归斜率变化分析策略，擅长捕捉趋势转折型劣化',
        category: 'strategy',
        params: [
            { name: 'windowSize', type: 'number', default: 20, description: '滑动窗口大小' },
            { name: 'threshold', type: 'number', default: 1.0, description: '斜率变化率阈值' },
            { name: 'epsilon', type: 'number', default: 1e-6, description: '防止除零小常数' },
            { name: 'sustainCount', type: 'number', default: 3, description: '连续超过阈值次数' },
            { name: 'minPoints', type: 'number', default: 25, description: '开始检测前最小数据点数' }
        ]
    };

    constructor(config, logger) {
        super(config, logger);
        this.algorithmName = 'slopeChange';
    }

    _createMaxDetector() {
        return new SlopeChangeDetector({
            windowSize: this.config.windowSize || 20,
            threshold: this.config.threshold || 1.0,
            epsilon: this.config.epsilon || 1e-6,
            sustainCount: this.config.sustainCount || 3,
            minPoints: this.config.minPoints || 25
        });
    }

    _createOptimalDetector() {
        return new SlopeChangeDetector({
            windowSize: this.config.windowSize || 20,
            threshold: this.config.threshold || 1.0,
            epsilon: this.config.epsilon || 1e-6,
            sustainCount: this.config.sustainCount || 3,
            minPoints: this.config.minPoints || 25
        });
    }
}

module.exports = SlopeChangeStrategy;
