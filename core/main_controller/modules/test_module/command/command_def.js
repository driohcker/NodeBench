const commandDef = {
    commands: [
        {
            name: 'start',
            description: '启动测试流程。用法: start [overridesJson]',
            method: 'startTest'
        },
        {
            name: 'stop',
            description: '停止测试流程',
            method: 'stopTest'
        },
        {
            name: 'status',
            description: '查看测试状态',
            method: 'getTestStatus'
        },
        {
            name: 'mode',
            description: '设置输出模式。用法: mode <file|pipe|rest>',
            method: 'setOutputMode'
        },
        {
            name: 'signal',
            description: '接收主控端信号。用法: signal <stop|reset>',
            method: 'onSignal'
        },
        {
            name: 'config',
            description: '查看测试端配置',
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
