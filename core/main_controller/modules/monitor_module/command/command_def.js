const commandDef = {
    commands: [
        {
            name: 'analyze',
            description: '启动分析',
            method: 'startAnalyze'
        },
        {
            name: 'config',
            description: '查看配置信息',
            method: 'getConfig'
        },
        {
            name: 'strategy',
            description: '查看可用的测试策略',
            method: 'listStrategies'
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
        },
    ]
};

module.exports = commandDef;