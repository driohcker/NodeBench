const routeDef = {
    GET: {
        '/strategies': 'listStrategies',
        '/config': 'getConfig'
    },
    POST: {
        '/strategy': 'selectStrategy',
        '/analyze': 'analyzeDataReport',
        '/benchmark': 'generateBenchmarkReport',
        '/transcode': 'transcodeReport'
    }
};

module.exports = routeDef;
