const routeDef = {
    GET: {
        '/': 'getServerStatus',
        '/health': 'healthCheck',
        '/cpu': 'cpuTest',
        '/memory': 'memoryTest',
        '/disk': 'diskTest',
        '/io': 'ioTest',
        '/shutdown': 'shutdown'
    },
    POST: {
        '/cpu': 'cpuTest',
        '/memory': 'memoryTest',
        '/disk': 'diskTest',
        '/io': 'ioTest',
        '/shutdown': 'shutdown'
    }
};

module.exports = routeDef;
