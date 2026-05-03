const BaseTest = require('./base/base_test.cjs');
const path = require('path');

class TestScript extends BaseTest {
    constructor(k6Driver, config, logger) {
        super(config, logger);

        this.k6Driver = k6Driver;
    }

    async run() {
        this.logger.info('开始执行简单负载测试...');

        try {
            const args = super.buildK6Args({
                vus: 20,
                duration: '6s',
                script: 'cpu'
            });

            await this.k6Driver.start(args);

        } catch (error) {
            this.logger.error(`简单负载测试执行失败: ${error.message}`);
        }


        this.logger.info('For循环步进式负载测试全部执行完毕。');
    }

}

module.exports = TestScript;