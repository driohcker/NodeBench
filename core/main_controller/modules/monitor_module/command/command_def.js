const commandDef = {
    commands: [
        {
            name: 'start',
            description: '启动监测进程。用法: start <sessionId> <session2Id> [source]',
            method: 'startMonitor'
        },
        {
            name: 'stop',
            description: '停止监测进程',
            method: 'stopMonitor'
        },
        {
            name: 'mode',
            description: '设置监测模式。用法: mode <tail|pipe>',
            method: 'setMonitorMode'
        },
        {
            name: 'algorithm',
            description: '设置拐点识别算法。用法: algorithm <doubleWindow|cusum|slopeChange>',
            method: 'setAlgorithm'
        },
        {
            name: 'metrics',
            description: '输出当前测试数据',
            method: 'getCurrentMetrics'
        },
        {
            name: 'report',
            description: '生成数据报告',
            method: 'generateDataReport'
        },
        {
            name: 'status',
            description: '查看监测状态',
            method: 'getMonitorStatus'
        },
        {
            name: 'config',
            description: '查看监测端配置',
            method: 'getConfig'
        },
        {
            name: 'help',
            description: '显示帮助信息',
            method: 'showHelp'
        },
        {
            name: 'exit',
            description: '退出程序',
            method: 'exit'
        }
    ]
};

module.exports = commandDef;
