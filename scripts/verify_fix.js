/**
 * 验证修复效果的快速测试脚本
 */
const path = require('path');
const fs = require('fs');
const ConfigManager = require('../core/main_controller/utils/config');
const Logger = require('../core/main_controller/utils/logger');
const TestRunnerService = require('../core/main_controller/modules/test_module/service/test_runner_service');
const MonitorService = require('../core/main_controller/modules/monitor_module/service/monitor_service');

process.env.NODE_ENV = 'development';

const testConfig = ConfigManager.getTestConfig();
const monitorConfig = ConfigManager.getMonitorConfig();
const logger = new Logger('logs/verify_fix');

const testOverrides = {
    target: 'cpu',
    initVUs: 1,
    maxVUs: 500,
    iterations: 30,
    duration: '2s',
    outputMode: 'file',
    waitPeriod: 2,
    serverUrl: 'http://localhost:10000',
    thinkTime: 1
};

async function runTest() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  验证修复 - 运行 k6 性能测试');
    console.log('═══════════════════════════════════════════════════════');

    const testRunner = new TestRunnerService(testConfig, logger);
    const testPromise = new Promise((resolve) => {
        testRunner.on('subFlowComplete', ({ result }) => resolve(result));
    });

    const startResult = await testRunner.startTest({
        ...testOverrides,
        sessionId: `verify-${Date.now()}`,
        session2Id: `cpu-${Date.now()}`
    });

    console.log(`  测试启动: sessionId=${startResult.sessionId}`);
    const result = await testPromise;
    console.log(`  测试完成: ${result}`);

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

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    console.log(`  数据行数: ${lines.length}`);

    for (const line of lines) {
        monitor._processLine(line);
    }

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

    // 导出完整历史数据用于验证
    const history = monitor.strategy.performanceHistory;
    const reportPath = path.join(process.cwd(), 'data/monitor', sessionId, `report_${sessionId}.json`);
    const dir = path.dirname(reportPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
        inflectionPoints: inflection,
        performanceData: history
    }, null, 2));

    monitor.stopMonitor();

    return { strategy: strategyName, inflection, history };
}

function analyzeTrend(result) {
    const history = result.history;
    console.log(`\n=== 趋势分析 ===`);

    // 找到最大拐点前后的数据
    const maxPoint = result.inflection.max;
    if (!maxPoint) {
        console.log('无最大拐点，无法分析趋势');
        return;
    }

    const maxVu = maxPoint.vus;
    const aroundMax = history.filter(p => Math.abs(p.vus - maxVu) <= 50);
    const afterMax = history.filter(p => p.vus > maxVu);

    console.log(`\n最大拐点附近 (VU ~${maxVu}):`);
    for (const p of aroundMax.slice(0, 10)) {
        console.log(`  VU=${p.vus}, latency=${p.latency.toFixed(2)}ms, rps=${p.rps.toFixed(2)}, err=${p.errorRate.toFixed(2)}%`);
    }

    if (afterMax.length > 0) {
        console.log(`\n最大拐点之后:`);
        for (const p of afterMax.slice(0, 10)) {
            console.log(`  VU=${p.vus}, latency=${p.latency.toFixed(2)}ms, rps=${p.rps.toFixed(2)}, err=${p.errorRate.toFixed(2)}%`);
        }

        const maxRps = Math.max(...aroundMax.map(p => p.rps));
        const avgAfterRps = afterMax.reduce((a, b) => a + b.rps, 0) / afterMax.length;
        const avgAfterLatency = afterMax.reduce((a, b) => a + b.latency, 0) / afterMax.length;
        const maxAroundLatency = Math.max(...aroundMax.map(p => p.latency));

        console.log(`\n关键指标:`);
        console.log(`  拐点附近最大RPS: ${maxRps.toFixed(2)}`);
        console.log(`  拐点之后平均RPS: ${avgAfterRps.toFixed(2)}`);
        console.log(`  拐点附近最大延迟: ${maxAroundLatency.toFixed(2)}ms`);
        console.log(`  拐点之后平均延迟: ${avgAfterLatency.toFixed(2)}ms`);

        if (avgAfterRps > maxRps * 1.3) {
            console.log(`  ⚠️ 警告: 拐点之后RPS明显上升，可能修复未生效`);
        } else if (avgAfterRps < maxRps * 0.9) {
            console.log(`  ✅ 拐点之后RPS下降或持平，符合理论预期`);
        } else {
            console.log(`  ✅ 拐点之后RPS基本平稳，符合理论预期`);
        }

        if (avgAfterLatency > maxAroundLatency * 1.5) {
            console.log(`  ✅ 拐点之后延迟急剧恶化，符合理论预期`);
        } else {
            console.log(`  ⚠️ 拐点之后延迟增长平缓`);
        }
    }
}

async function main() {
    const metricsFile = await runTest();
    const result = await analyzeWithStrategy(metricsFile, 'doubleWindow');
    analyzeTrend(result);
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  验证完成');
    console.log('═══════════════════════════════════════════════════════');
}

main().catch(err => {
    console.error('测试异常:', err);
    process.exit(1);
});
