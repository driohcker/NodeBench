const path = require('path');
const fs = require('fs');

class SteppedLoadTest {

    constructor(k6Driver, config, logger) {
        super(config, logger);

        this.k6Driver = k6Driver;
    }

    async run() {
        // 1. 必填参数
        const { initVUs, maxVUs, iterations: steps, duration } = this.config;
        
        const options = {
            startVus: initVUs,
            endVus: maxVUs,
            stepCount: steps,
            stepDuration: duration,
        };

        const stages = this.buildStages(options);

        // 2. 生成 stages 并写进环境变量
        const env = this.buildK6Env({
            stages: stages
        });

        // 3. 合并到本次 k6 启动环境
        const k6Args = this.buildK6Args({
            testSessionId: this.testSessionId,
            script: 'cpu'
        });


        // 4. 启动 k6（复用父类 k6Driver）
        try {
            await this.k6Driver.start(k6Args, {});
            this.logger.info('stepped_load 测试完成');
            // 5. 让父类把 summary 字段排好队
            this.fixSummaryFieldOrder(this.summaryPath);
        } catch (e) {
            this.logger.error(`stepped_load 执行失败: ${e.message}`);
        }
    }
}

module.exports = SteppedLoadTest;