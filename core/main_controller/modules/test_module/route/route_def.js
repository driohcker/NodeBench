const routeDef = {
    GET: {
        '/': 'getServerStatus',
        '/health': 'healthCheck',
        '/status': 'getTestStatus',
        '/config': 'getConfig',
        '/scripts': 'listScripts'
    },
    POST: {
        '/start': 'startTest',
        '/stop': 'stopTest'
    }
};

module.exports = routeDef;