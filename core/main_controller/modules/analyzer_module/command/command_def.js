const commandDef = {
    commands: [
        {
            name: 'strategy',
            description: '选择分析策略。用法: strategy <strategyName>',
            method: 'selectStrategy'
        },
        {
            name: 'analyze',
            description: '分析数据报告。用法: analyze <sessionId>',
            method: 'analyzeDataReport'
        },
        {
            name: 'benchmark',
            description: '生成标定报告。用法: benchmark <sessionId>',
            method: 'generateBenchmarkReport'
        },
        {
            name: 'transcode',
            description: '转码标定报告。用法: transcode <sessionId> [pdf|excel]',
            method: 'transcodeReport'
        },
        {
            name: 'strategies',
            description: '列出可用分析策略',
            method: 'listStrategies'
        },
        {
            name: 'config',
            description: '查看分析端配置',
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
