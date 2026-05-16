const routeDef = {
    GET: {
        '/status': 'getMonitorStatus',
        '/metrics': 'getCurrentMetrics',
        '/config': 'getConfig'
    },
    POST: {
        '/start': 'startMonitor',
        '/stop': 'stopMonitor',
        '/mode': 'setMonitorMode',
        '/algorithm': 'setAlgorithm',
        '/report': 'generateDataReport'
    }
};

module.exports = routeDef;
