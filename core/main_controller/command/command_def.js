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
            name: 'runall',
            description: '快速启动所有模块',
            method: 'runAllModules'
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