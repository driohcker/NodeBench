const routeDef = {
    GET: {
        '/status': 'getTestStatus',
        '/config': 'getConfig'
    },
    POST: {
        '/start': 'startTest',
        '/stop': 'stopTest',
        '/mode': 'setOutputMode',
        '/signal': 'onSignal'
    }
};

module.exports = routeDef;
