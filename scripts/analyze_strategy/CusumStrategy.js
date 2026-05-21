const BaseStrategy = require('./_BaseStrategy');
const CusumDetector = require('./detectors/CusumDetector');

/**
 * CusumStrategy - CUSUM 累积和分析策略（重构版）
 *
 * 职责边界（严格按新架构划分）：
 *   - CusumDetector：纯算法实现，接收一维数据流，通过累积和识别突变点。
 *   - CusumStrategy：只负责配置和实例化检测器。
 *   - BaseStrategy：接收突变点，结合资源负载/错误率等指标判断性能拐点。
 *
 * 算法特点：对微小且持续的均值偏移敏感，擅长捕捉慢漂移型劣化。
 *
 * 配置：
 *   - baselinePoints: 建立基线 μ_0 和 σ 所需的点数，默认 20
 *   - cMultiplier: 偏移量倍数系数 c = cMultiplier × σ，默认 0.5
 *   - HMultiplier: 阈值倍数系数 H = HMultiplier × σ，默认 4.0
 *   - sustainCount: 连续超过阈值次数，默认 3
 */
class CusumStrategy extends BaseStrategy {
    static meta = {
        name: 'cusum',
        displayName: 'CUSUM策略',
        description: '累积和分析策略，对微小且持续的均值偏移敏感，擅长捕捉慢漂移型劣化',
        category: 'strategy',
        params: [
            { name: 'baselinePoints', type: 'number', default: 20, description: '基线建立所需点数' },
            { name: 'cMultiplier', type: 'number', default: 0.5, description: '偏移量倍数系数' },
            { name: 'HMultiplier', type: 'number', default: 4.0, description: '阈值倍数系数' },
            { name: 'sustainCount', type: 'number', default: 3, description: '连续超过阈值次数' }
        ]
    };

    constructor(config, logger) {
        super(config, logger);
        this.algorithmName = 'cusum';
    }

    _createMaxDetector() {
        return new CusumDetector({
            baselinePoints: this.config.baselinePoints || 20,
            cMultiplier: this.config.cMultiplier || 0.5,
            HMultiplier: this.config.HMultiplier || 4.0,
            sustainCount: this.config.sustainCount || 3
        });
    }

    _createOptimalDetector() {
        return new CusumDetector({
            baselinePoints: this.config.baselinePoints || 20,
            cMultiplier: this.config.cMultiplier || 0.5,
            HMultiplier: this.config.HMultiplier || 4.0,
            sustainCount: this.config.sustainCount || 3
        });
    }
}

module.exports = CusumStrategy;
