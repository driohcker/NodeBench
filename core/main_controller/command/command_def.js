const commandDef = {
    commands: [
        {
            name: 'server',
            description: '服务端命令入口',
            method: 'handleServerModuleCommand'
        },
        {
            name: 'test',
            description: '测试端命令入口',
            method: 'handleTestModuleCommand'
        },
        {
            name: 'monitor',
            description: '监测端命令入口',
            method: 'handleMonitorModuleCommand'
        },
        {
            name: 'analyzer',
            description: '分析端命令入口',
            method: 'handleAnalyzerModuleCommand'
        },
        {
            name: 'runall',
            description: '快速启动所有模块',
            method: 'runAllModules'
        },
        {
            name: 'auto',
            description: '一键自动化性能标定（Auto-PIP：启动服务→阶梯负载→实时监测拐点→生成报告）',
            method: 'runAutoTest'
        },
        {
            name: 'config',
            description: '获取主控端配置',
            method: 'getConfig'
        },
        {
            name: 'exit',
            description: '退出程序',
            method: 'exit'
        },
        {
            name: 'help',
            description: '显示帮助信息',
            method: 'help'
        }
    ]
};

module.exports = commandDef;
