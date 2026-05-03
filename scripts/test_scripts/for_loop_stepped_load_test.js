const BaseTest = require('./base/base_test.cjs');
const path = require('path');

class ForLoopSteppedLoadTest extends BaseTest {
    constructor(k6Driver, config, logger) {
        super(config, logger);

        this.k6Driver = k6Driver;
    }

    /**
     * for-loop测试的核心执行方法。
     * 它将被一个专用的运行器服务调用。
     * @param {K6Driver} k6Driver - k6驱动实例。
     * @param {string} sessionLogDir - 用于保存日志和摘要的会话目录。
     * @returns {Promise<void>}
     */
    async run() {
        this.logger.info('开始执行For循环步进式负载测试...');

        const { initVUs, maxVUs, iterations: steps, duration } = this.config;
        
        const vusTargets = this.calculateVusTargets(initVUs, maxVUs, steps);

        this.testSessionId = Date.now();

        for (let i = 0; i < vusTargets.length; i++) {
            const currentVUs = vusTargets[i];
            const step = i + 1;
            this.logger.info(`[步骤 ${step}/${vusTargets.length}] 开始测试, 目标 VUs: ${currentVUs}`);

            // 为每个步骤运行一个独立的k6测试
            const k6Args = super.buildK6Args({
                testSessionId: this.testSessionId,
                step: i,
                vus: currentVUs,
                duration: duration,
                script: 'cpu'
            });

            try {
                // 注意：这里我们复用k6Driver，但每次都是一个全新的k6进程
                await this.k6Driver.start(k6Args, {}); 
                this.logger.info(`[步骤 ${step}/${vusTargets.length}] 测试完成。`);
                // 让父类把 summary 字段顺序排好
                this.fixSummaryFieldOrder(this.getPaths().summaryPath);
            } catch (error) {
                this.logger.error(`[步骤 ${step}/${vusTargets.length}] k6执行失败: ${error.message}`);
                this.logger.info('由于单个步骤失败，测试提前中止。');
                break; // 发生错误时中止循环
            }
        }

        this.logger.info('For循环步进式负载测试全部执行完毕。');
    }

    calculateVusTargets(initVUs, maxVUs, steps) {
        const targets = new Set();
        if (steps <= 0) {
            this.logger.warn('测试步骤 "iterations" 配置为0或更小，不生成任何有效阶段。');
        } else if (steps === 1) {
            const targetVUs = maxVUs > 0 ? maxVUs : initVUs;
            if (targetVUs > 0) targets.add(targetVUs);
        } else {
            for (let i = 0; i < steps; i++) {
                const progress = i / (steps - 1);
                const targetVUs = Math.round(initVUs + (maxVUs - initVUs) * progress);
                if (targetVUs > 0) {
                    targets.add(targetVUs);
                }
            }
        }
        return Array.from(targets).sort((a, b) => a - b);
    }
}

module.exports = ForLoopSteppedLoadTest;