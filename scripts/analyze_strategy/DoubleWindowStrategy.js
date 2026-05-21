const BaseStrategy = require('./_BaseStrategy');
const DoubleWindowDetector = require('./detectors/DoubleWindowDetector');

/**
 * DoubleWindowStrategy - 双滑动窗口分析策略（重构版）
 *
 * 职责边界（严格按新架构划分）：
 *   - DoubleWindowDetector：纯算法实现，只接收一维数据流，识别突变点。
 *   - DoubleWindowStrategy：只负责配置和实例化检测器，不混杂拐点判断逻辑。
 *   - BaseStrategy：接收突变点，结合资源负载/错误率等指标判断性能拐点，
 *     管理状态，生成报告。
 *
 * 算法配置（来自论文定义）：
 *   - windowSize (N): 窗口大小，默认 15（过小受噪声干扰，过大延迟增加）
 *   - threshold (T): 突变阈值，默认 1.8（μ_back/μ_front > T，后窗比前窗高 80%）
 *   - sustainCount (K): 连续触发次数，默认 3（防抖动第二防线）
 *
 * 拐点识别映射：
 *   - 最大拐点：错误率序列直接输入 DoubleWindowDetector，检测"从平缓到攀升"。
 *   - 最优拐点：RPS 序列经 BaseStrategy._getRpsDeviationForDetection 数学变换后
 *     （将"增加到平缓"转为"平缓到攀升"），再输入 DoubleWindowDetector。
 */
class DoubleWindowStrategy extends BaseStrategy {
    static meta = {
        name: 'doubleWindow',
        displayName: '双窗口策略',
        description: '基于双窗口滑动平均的拐点检测策略，检测错误率/RPS饱和突变',
        category: 'strategy',
        params: [
            { name: 'windowSize', type: 'number', default: 15, description: '窗口大小' },
            { name: 'threshold', type: 'number', default: 1.8, description: '突变阈值' },
            { name: 'sustainCount', type: 'number', default: 3, description: '连续触发次数' }
        ]
    };

    constructor(config, logger) {
        super(config, logger);
        this.algorithmName = 'doubleWindow';
    }

    /**
     * 创建用于最大拐点的突变检测器（检测错误率突变）
     */
    _createMaxDetector() {
        return new DoubleWindowDetector({
            windowSize: this.config.windowSize || 15,
            threshold: this.config.maxThreshold || this.config.threshold || 1.8,
            sustainCount: this.config.sustainCount || 3
        });
    }

    /**
     * 创建用于最优拐点的突变检测器（检测 RPS 饱和突变）
     */
    _createOptimalDetector() {
        return new DoubleWindowDetector({
            windowSize: this.config.windowSize || 15,
            threshold: this.config.optimalThreshold || this.config.threshold || 1.8,
            sustainCount: this.config.sustainCount || 3
        });
    }
}

module.exports = DoubleWindowStrategy;
