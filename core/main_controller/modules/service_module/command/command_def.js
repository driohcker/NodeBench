const commandDef = {
    commands: [
        {
            name: 'start',
            description: '启动被测服务',
            method: 'startExpressService'
        },
        {
            name: 'stop',
            description: '停止被测服务',
            method: 'stopExpressService'
        },
        {
            name: 'status',
            description: '查看被测服务状态',
            method: 'getStatusExpressService'
        },
        {
            name: 'config',
            description: '查看配置信息',
            method: 'getConfig'
        },
        {
            name: 'help',
            description: '显示帮助信息',
            method: 'help'
        },
        {
            name: 'exit',
            description: '退出程序',
            method: 'exit'
        }
    ]
};

module.exports = commandDef;
