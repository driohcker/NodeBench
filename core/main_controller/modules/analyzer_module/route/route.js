const routeDef = require('./route_def');

class Route {
    constructor(controller) {
        this.controller = controller;
    }

    registerRoutes(app) {
        routeDef.routes.forEach(route => {
            const method = route.method.toLowerCase();
            app[method](route.path, (req, res) => {
                const controllerMethod = this.controller[route.controllerMethod];
                if (controllerMethod) {
                    controllerMethod(req, res);
                } else {
                    res.status(404).json({ error: '方法不存在' });
                }
            });
        });
    }
}

module.exports = Route;
