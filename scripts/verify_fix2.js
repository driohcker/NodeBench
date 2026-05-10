/**
 * 验证修复效果 - 高负载测试
 * 专门验证：系统过载时，成功RPS不应上升，延迟应急剧恶化
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
const logger = new Logger('logs/verify_fix2');

const testOverrides = {
    target: 'cpu',
    initVUs: 1,
    maxVUs: 1000,
    iterations: 30,
    duration: '6s',
    outputMode: 'file',
    waitPeriod: 2,
    serverUrl: 'http://localhost:10000',
    thinkTime: 0  // 使用0思考时间产生高负载，观察过载行为
};

async function runTest() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  验证修复 - 高负载测试');
    console.log('═══════════════════════════════════════════════════════');

    const testRunner = new TestRunnerService(testConfig, logger);
    const testPromise = new Promise((resolve) => {
        testRunner.on('subFlowComplete', ({ result }) => resolve(result));
    });

    const startResult = await testRunner.startTest({
        ...testOverrides,
        sessionId: `verify2-${Date.now()}`,
        session2Id: `cpu-${Date.now()}`
    });

    console.log(`  测试启动: sessionId=${startResult.sessionId}`);
    const result = await testPromise;
    console.log(`  测试完成: ${result}`);

    await new Promise(r => setTimeout(r, 1000));

    const metricsFile = path.join(process.cwd(), 'data/test', startResult.sessionId, startResult.session2Id, 'metrics.json');
    return metricsFile;
}

async function analyzeWithStrategy(filePath, strategyName) {
    const monitor = new MonitorService(monitorConfig, logger);
    const sessionId = `analyze-${Date.now()}`;
    const session2Id = `${strategyName}-${Date.now()}`;

    monitor.startMonitor(sessionId, session2Id, filePath, 'cpu', strategyName);

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    for (const line of lines) {
        monitor._processLine(line);
    }

    monitor._processLine(JSON.stringify({ type: 'SubFlowComplete', session2Id, timestamp: new Date().toISOString() }));
    await new Promise(r => setTimeout(r, 500));

    const inflection = monitor.strategy.getInflectionPoints();
    const history = monitor.strategy.performanceHistory;

    monitor.stopMonitor();

    return { inflection, history };
}

function analyzeTrend(result) {
    const { inflection, history } = result;
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  拐点检测结果');
    console.log('═══════════════════════════════════════════════════════');

    if (inflection.optimal) {
        console.log(`  ✅ 最优拐点: VUs=${inflection.optimal.vus}, 延迟=${inflection.optimal.latency.toFixed(2)}ms, RPS=${inflection.optimal.rps.toFixed(2)}`);
    }
    if (inflection.max) {
        console.log(`  ✅ 最大拐点: VUs=${inflection.max.vus}, 延迟=${inflection.max.latency.toFixed(2)}ms, RPS=${inflection.max.rps.toFixed(2)}`);
    } else {
        console.log('  ❌ 未检测到最大拐点');
    }

    // 按VU分组统计
    const vuMap = new Map();
    for (const p of history) {
        if (!vuMap.has(p.vus)) {
            vuMap.set(p.vus, []);
        }
        vuMap.get(p.vus).push(p);
    }

    const vuStats = [];
    for (const [vus, points] of vuMap) {
        const avgLat = points.reduce((a, b) => a + b.latency, 0) / points.length;
        const avgRps = points.reduce((a, b) => a + b.rps, 0) / points.length;
        const avgErr = points.reduce((a, b) => a + b.errorRate, 0) / points.length;
        vuStats.push({ vus, avgLat, avgRps, avgErr, count: points.length });
    }
    vuStats.sort((a, b) => a.vus - b.vus);

    console.log('\n  VU阶段统计 (采样):');
    console.log('  VU      avgLatency    avgRPS    avgErrRate');
    console.log('  ----    ----------    ------    ----------');
    for (let i = 0; i < vuStats.length; i += Math.max(1, Math.floor(vuStats.length / 20))) {
        const s = vuStats[i];
        console.log(`  ${s.vus.toString().padStart(4)}    ${s.avgLat.toFixed(2).padStart(10)}ms  ${s.avgRps.toFixed(2).padStart(8)}  ${s.avgErr.toFixed(2).padStart(10)}%`);
    }

    // 趋势判断
    if (inflection.max && vuStats.length > 0) {
        const maxVu = inflection.max.vus;
        const before = vuStats.filter(s => s.vus <= maxVu);
        const after = vuStats.filter(s => s.vus > maxVu);

        if (before.length > 0 && after.length > 0) {
            const maxBeforeRps = Math.max(...before.map(s => s.avgRps));
            const avgAfterRps = after.reduce((a, b) => a + b.avgRps, 0) / after.length;
            const maxBeforeLat = Math.max(...before.map(s => s.avgLat));
            const avgAfterLat = after.reduce((a, b) => a + b.avgLat, 0) / after.length;

            console.log('\n  趋势判断:');
            console.log(`  最大拐点前最高RPS: ${maxBeforeRps.toFixed(2)}`);
            console.log(`  最大拐点后平均RPS: ${avgAfterRps.toFixed(2)}`);
            console.log(`  最大拐点前最高延迟: ${maxBeforeLat.toFixed(2)}ms`);
            console.log(`  最大拐点后平均延迟: ${avgAfterLat.toFixed(2)}ms`);

            if (avgAfterRps > maxBeforeRps * 1.2) {
                console.log('  ❌ FAIL: 拐点之后RPS明显上升，修复未生效');
            } else if (avgAfterRps < maxBeforeRps * 0.95) {
                console.log('  ✅ PASS: 拐点之后RPS下降或持平');
            } else {
                console.log('  ✅ PASS: 拐点之后RPS基本平稳');
            }

            if (avgAfterLat > maxBeforeLat * 1.3) {
                console.log('  ✅ PASS: 拐点之后延迟急剧恶化');
            } else {
                console.log('  ⚠️ WARN: 拐点之后延迟增长平缓');
            }
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
