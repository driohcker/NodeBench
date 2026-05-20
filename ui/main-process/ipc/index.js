const server = require('./server');
const test = require('./test');
const auto = require('./auto');
const analyzer = require('./analyzer');
const monitor = require('./monitor');
const reports = require('./reports');
const system = require('./system');
const config = require('./config');
const data = require('./data');
const logs = require('./logs');
const shell = require('./shell');

function setupIpcHandlers() {
    server.register();
    test.register();
    auto.register();
    analyzer.register();
    monitor.register();
    reports.register();
    system.register();
    config.register();
    data.register();
    logs.register();
    shell.register();
}

module.exports = { setupIpcHandlers };
