const fs = require('fs');
const path = require('path');

// 清除可能的 require 缓存
const generatorPath = path.resolve(__dirname, '../core/main_controller/modules/analyzer_module/helper/BenchmarkReportGenerator.js');
Object.keys(require.cache).forEach(key => {
    if (key.includes('BenchmarkReportGenerator')) {
        delete require.cache[key];
    }
});

const BenchmarkReportGenerator = require(generatorPath);

const sessionId = process.argv[2] || '1778839666970';
const dataDir = path.resolve(__dirname, `../data/monitor/${sessionId}`);

if (!fs.existsSync(dataDir)) {
    console.error(`Data directory not found: ${dataDir}`);
    process.exit(1);
}

const dataReports = [];
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
files.forEach(f => {
    const fp = path.join(dataDir, f);
    try {
        const content = fs.readFileSync(fp, 'utf8');
        dataReports.push(JSON.parse(content));
        console.log(`Loaded: ${f}`);
    } catch (e) {
        console.error(`Failed to load ${f}:`, e.message);
    }
});

// 读取默认配置
const configPath = path.resolve(__dirname, '../config/default.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const logger = {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args)
};

const generator = new BenchmarkReportGenerator(config, logger);
const reportPath = generator.generateBenchmarkReport(sessionId, dataReports);
console.log(`\nReport generated: ${reportPath}`);
