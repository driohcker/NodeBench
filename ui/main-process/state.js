/**
 * 主进程共享状态
 */
module.exports = {
    mainWindow: null,
    services: {},
    monitorMetricBridge: null,
    lastCpuInfo: null,
    lastCpuTime: 0,
    isMac: process.platform === 'darwin'
};
