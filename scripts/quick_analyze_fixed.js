const fs = require('fs');
const path = require('path');
const ConfigManager = require('../core/main_controller/utils/config');
const Logger = require('../core/main_controller/utils/logger');
const MonitorService = require('../core/main_controller/modules/monitor_module/service/monitor_service');

process.env.NODE_ENV = 'development';
const monitorConfig = ConfigManager.getMonitorConfig();
const logger = new Logger('logs/quick_verify');

// Find latest metrics file
const testDir = path.join(process.cwd(), 'data/test');
const sessions = fs.readdirSync(testDir).filter(d => d.startsWith('qv-')).sort();
if (sessions.length === 0) {
    console.log('No metrics found');
    process.exit(1);
}
const latestSession = sessions[sessions.length - 1];
const subDirs = fs.readdirSync(path.join(testDir, latestSession)).filter(d => d.startsWith('cpu-'));
const metricsFile = path.join(testDir, latestSession, subDirs[0], 'metrics.json');

console.log(`Analyzing: ${metricsFile}`);

const monitor = new MonitorService(monitorConfig, logger);
const sessionId = `analyze-${Date.now()}`;
const session2Id = `doubleWindow-${Date.now()}`;

monitor.startMonitor(sessionId, session2Id, metricsFile, 'cpu', 'doubleWindow');

const content = fs.readFileSync(metricsFile, 'utf-8');
const lines = content.split('\n').filter(l => l.trim());

for (const line of lines) {
    monitor._processLine(line);
}

monitor._processLine(JSON.stringify({ type: 'SubFlowComplete', session2Id, timestamp: new Date().toISOString() }));

const inflection = monitor.strategy.getInflectionPoints();
const history = monitor.strategy.performanceHistory;

console.log('\n=== Inflection Points ===');
if (inflection.optimal) {
    console.log(`Optimal: VUs=${inflection.optimal.vus}, Latency=${inflection.optimal.latency.toFixed(2)}ms, RPS=${inflection.optimal.rps.toFixed(2)}`);
}
if (inflection.max) {
    console.log(`Max: VUs=${inflection.max.vus}, Latency=${inflection.max.latency.toFixed(2)}ms, RPS=${inflection.max.rps.toFixed(2)}`);
}

console.log('\n=== Performance Trend (sample) ===');
console.log('VU      Latency(ms)   RPS      ErrorRate');
console.log('----    -----------   ---      ---------');

const vuMap = new Map();
for (const p of history) {
    if (!vuMap.has(p.vus)) vuMap.set(p.vus, []);
    vuMap.get(p.vus).push(p);
}
const vusSorted = Array.from(vuMap.keys()).sort((a, b) => a - b);
for (const vus of vusSorted) {
    const pts = vuMap.get(vus);
    const avgLat = pts.reduce((a, b) => a + b.latency, 0) / pts.length;
    const avgRps = pts.reduce((a, b) => a + b.rps, 0) / pts.length;
    const avgErr = pts.reduce((a, b) => a + b.errorRate, 0) / pts.length;
    console.log(`${vus.toString().padStart(4)}    ${avgLat.toFixed(2).padStart(11)}   ${avgRps.toFixed(2).padStart(6)}   ${avgErr.toFixed(2).padStart(9)}%`);
}

monitor.stopMonitor();
