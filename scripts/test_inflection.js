/**
 * 拐点检测算法集成测试脚本
 * 运行一次 k6 测试保存到文件，然后用三种策略分别分析。
 */
const path = require('path');
const fs = require('fs');
const ConfigManager = require('../core/main_controller/utils/config');
const Logger = require('../core/main_controller/utils/logger');
const TestRunnerService = require('../core/main_controller/modules/test_module/service/test_runner_service');
const MonitorService = require('../core/main_controller/modules/monitor_module/service/monitor_service');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const testConfig = ConfigManager.getTestConfig();
const monitorConfig = ConfigManager.getMonitorConfig();
const logger = new Logger('logs/test_inflection');

const testOverrides = {
    target: 'cpu',
    initVUs: 1,
    maxVUs: 1000,
    iterations: 50,
    duration: '2s',
    outputMode: 'file',
    waitPeriod: 2,
    serverUrl: 'http://localhost:10000'
};

async function runTest() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  运行 k6 性能测试');
    console.log('═══════════════════════════════════════════════════════');

    const serverReady = await new Promise(resolve => {
        const net = require('net');
        const sock = new net.Socket();
        sock.setTimeout(1000);
        sock.on('connect', () => { sock.destroy(); resolve(true); });
        sock.on('error', () => resolve(false));
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
        sock.connect(10000, 'localhost');
    });

    if (!serverReady) {
        console.error('❌ Server 未在 localhost:10000 运行');
        process.exit(1);
    }
    console.log('✅ Server 检测通过');

    const testRunner = new TestRunnerService(testConfig, logger);
    const testPromise = new Promise((resolve) => {
        testRunner.on('subFlowComplete', ({ result }) => resolve(result));
    });

    const startResult = await testRunner.startTest({
        ...testOverrides,
        sessionId: `test-${Date.now()}`,
        session2Id: `cpu-${Date.now()}`
    });

    console.log(`  测试启动: sessionId=${startResult.sessionId}`);
    const result = await testPromise;
    console.log(`  测试完成: ${result}`);

    // 等待文件写入完成
    await new Promise(r => setTimeout(r, 1000));

    const metricsFile = path.join(process.cwd(), 'data/test', startResult.sessionId, startResult.session2Id, 'metrics.json');
    console.log(`  数据文件: ${metricsFile}`);

    return metricsFile;
}

async function analyzeWithStrategy(filePath, strategyName) {
    console.log(`\n═══════════════════════════════════════════════════════`);
    console.log(`  分析策略: ${strategyName}`);
    console.log(`═══════════════════════════════════════════════════════`);

    const monitor = new MonitorService(monitorConfig, logger);
    const sessionId = `analyze-${Date.now()}`;
    const session2Id = `${strategyName}-${Date.now()}`;

    monitor.startMonitor(sessionId, session2Id, filePath, 'cpu', strategyName);

    // 读取文件数据
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    console.log(`  数据行数: ${lines.length}`);

    for (const line of lines) {
        monitor._processLine(line);
    }

    // 模拟 SubFlowComplete
    monitor._processLine(JSON.stringify({ type: 'SubFlowComplete', session2Id, timestamp: new Date().toISOString() }));

    await new Promise(r => setTimeout(r, 500));

    const inflection = monitor.strategy.getInflectionPoints();
    const status = monitor.strategy.getStatus();

    console.log(`  数据点数: ${status.dataPoints}`);
    if (inflection.optimal) {
        console.log(`  ✅ 最优拐点: VUs=${inflection.optimal.vus}, 延迟=${inflection.optimal.latency}ms, RPS=${inflection.optimal.rps}`);
    } else {
        console.log(`  ❌ 未检测到最优拐点`);
    }
    if (inflection.max) {
        console.log(`  ✅ 最大拐点: VUs=${inflection.max.vus}, 延迟=${inflection.max.latency}ms, RPS=${inflection.max.rps}`);
    } else {
        console.log(`  ❌ 未检测到最大拐点`);
    }

    monitor.stopMonitor();

    return {
        strategy: strategyName,
        optimal: inflection.optimal,
        max: inflection.max,
        dataPoints: status.dataPoints
    };
}

async function main() {
    const metricsFile = await runTest();

    const strategies = ['doubleWindow', 'cusum', 'slopeChange'];
    const results = [];
    for (const strategy of strategies) {
        const r = await analyzeWithStrategy(metricsFile, strategy);
        results.push(r);
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  测试结果汇总');
    console.log('═══════════════════════════════════════════════════════');
    for (const r of results) {
        const optVu = r.optimal ? r.optimal.vus : 'N/A';
        const maxVu = r.max ? r.max.vus : 'N/A';
        const optOk = r.optimal && r.optimal.vus >= 150 && r.optimal.vus <= 300 ? '✅' : '❌';
        const maxOk = r.max && r.max.vus >= 600 && r.max.vus <= 800 ? '✅' : '❌';
        console.log(`  ${optOk} ${r.strategy}: optimal=${optVu}, max=${maxVu} (期望: ~200, ~700)`);
    }

    const allOptimalOk = results.every(r => r.optimal && r.optimal.vus >= 150 && r.optimal.vus <= 300);
    const allMaxOk = results.every(r => r.max && r.max.vus >= 600 && r.max.vus <= 800);

    if (allOptimalOk && allMaxOk) {
        console.log('\n🎉 所有策略均通过测试!');
        process.exit(0);
    } else {
        console.log('\n⚠️ 部分策略未通过测试，需要调整参数');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('测试异常:', err);
    process.exit(1);
});
