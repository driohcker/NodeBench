const path = require('path');
const fs = require('fs');
const ConfigManager = require('../core/main_controller/utils/config');
const Logger = require('../core/main_controller/utils/logger');
const TestRunnerService = require('../core/main_controller/modules/test_module/service/test_runner_service');

process.env.NODE_ENV = 'development';
const testConfig = ConfigManager.getTestConfig();
const logger = new Logger('logs/quick_verify');

async function run() {
    const testRunner = new TestRunnerService(testConfig, logger);
    const testPromise = new Promise((resolve) => {
        testRunner.on('subFlowComplete', ({ result }) => resolve(result));
    });

    const startResult = await testRunner.startTest({
        target: 'cpu',
        initVUs: 1,
        maxVUs: 300,
        iterations: 20,
        duration: '3s',
        outputMode: 'file',
        waitPeriod: 2,
        serverUrl: 'http://localhost:10000',
        thinkTime: 0,
        sessionId: `qv-${Date.now()}`,
        session2Id: `cpu-${Date.now()}`
    });

    const result = await testPromise;
    console.log(`Test complete: ${result}`);
    console.log(`Metrics: data/test/${startResult.sessionId}/${startResult.session2Id}/metrics.json`);
}

run().catch(console.error);
