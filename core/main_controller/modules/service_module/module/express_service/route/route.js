const express = require('express');
const routeDef = require('./route_def');

class Route {
    constructor(controller) {
        this.router = express.Router();
        this.controller = controller;
        this.setupRoutes();
    }

    setupRoutes() {
        Object.keys(routeDef.GET).forEach(path => {
            const methodName = routeDef.GET[path];
            this.router.get(path, (req, res) => {
                this.controller[methodName](req, res);
            });
        });

        Object.keys(routeDef.POST).forEach(path => {
            const methodName = routeDef.POST[path];
            this.router.post(path, (req, res) => {
                this.controller[methodName](req, res);
            });
        });
    }

    getRouter() {
        return this.router;
    }
}

module.exports = Route;
