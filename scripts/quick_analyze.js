/**
 * 快速分析已有的 k6 测试数据，通过 MonitorService 完整 pipeline。
 */
const path = require('path');
const fs = require('fs');
const ConfigManager = require('../core/main_controller/utils/config');
const Logger = require('../core/main_controller/utils/logger');
const MonitorService = require('../core/main_controller/modules/monitor_module/service/monitor_service');

process.env.NODE_ENV = 'development';
const monitorConfig = ConfigManager.getMonitorConfig();
const logger = new Logger('logs/test_inflection');

function analyze(filePath, strategyName) {
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`  策略: ${strategyName}`);
  console.log(`═══════════════════════════════════════════════════════`);

  const monitor = new MonitorService(monitorConfig, logger);
  monitor.startMonitor(`s-${Date.now()}`, `s2-${Date.now()}`, filePath, 'cpu', strategyName);

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  console.log(`  数据行数: ${lines.length}`);

  for (const line of lines) {
    monitor._processLine(line);
  }

  // 模拟结束标记
  monitor._processLine(JSON.stringify({ type: 'SubFlowComplete', session2Id: 'test', timestamp: new Date().toISOString() }));

  const inflection = monitor.strategy.getInflectionPoints();
  const status = monitor.strategy.getStatus();

  console.log(`  数据点数: ${status.dataPoints}`);
  if (inflection.optimal) {
    console.log(`  ✅ 最优拐点: VUs=${inflection.optimal.vus}, 延迟=${inflection.optimal.latency.toFixed(2)}ms`);
  } else {
    console.log(`  ❌ 未检测到最优拐点`);
  }
  if (inflection.max) {
    console.log(`  ✅ 最大拐点: VUs=${inflection.max.vus}, 延迟=${inflection.max.latency.toFixed(2)}ms`);
  } else {
    console.log(`  ❌ 未检测到最大拐点`);
  }

  const vusSet = new Set(status.history.vus.map(p => p.v));
  const vusArr = Array.from(vusSet).sort((a, b) => a - b);
  console.log(`  VU 范围: ${vusArr[0]} ~ ${vusArr[vusArr.length - 1]}, 唯一VU阶段数: ${vusArr.length}`);

  monitor.stopMonitor();
  return { strategy: strategyName, optimal: inflection.optimal, max: inflection.max };
}

function main() {
  const filePath = process.argv[2] || 'data/test/test-1778397478211/cpu-1778397478211/metrics.json';
  if (!fs.existsSync(filePath)) {
    console.error('文件不存在:', filePath);
    process.exit(1);
  }

  const strategies = ['doubleWindow', 'cusum', 'slopeChange'];
  const results = [];
  for (const s of strategies) {
    results.push(analyze(filePath, s));
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  汇总');
  console.log('═══════════════════════════════════════════════════════');
  for (const r of results) {
    const opt = r.optimal ? r.optimal.vus : 'N/A';
    const max = r.max ? r.max.vus : 'N/A';
    console.log(`  ${r.strategy}: optimal=${opt}, max=${max} (期望 ~200, ~700)`);
  }
}

main();
