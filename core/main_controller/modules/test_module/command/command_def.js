const commandDef = {
    commands: [
        {
            name: 'start',
            description: '启动测试',
            method: 'startTest'
        },
        {
            name: 'stop',
            description: '停止测试',
            method: 'stopTest'
        },
        {
            name: 'status',
            description: '查看测试状态',
            method: 'getTestStatus'
        },
        {
            name: 'config',
            description: '查看配置信息',
            method: 'getConfig'
        },
        {
            name: 'scripts',
            description: '查看可用的测试脚本',
            method: 'listScripts'
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
        {
            name: 'result',
            description: '重新分析指定的测试会话。用法: result <sessionId>',
            method: 'reanalyze'
        }
    ]
};

module.exports = commandDef;