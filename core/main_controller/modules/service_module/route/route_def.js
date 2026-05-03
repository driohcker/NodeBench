const routeDef = {
    routes: [
        {
            path: '/server/status',
            method: 'GET',
            controller: 'getStatusExpressService'
        },
        {
            path: '/server/start',
            method: 'POST',
            controller: 'startExpressService'
        },
        {
            path: '/server/stop',
            method: 'POST',
            controller: 'stopExpressService'
        },
        {
            path: '/server/config',
            method: 'GET',
            controller: 'getConfig'
        }
    ]
};

module.exports = routeDef;
