const express = require('express');

class Route {
    constructor(controller) {
        this.router = express.Router();
        this.controller = controller;
        this.setupRoutes();
    }

    setupRoutes() {
        // 固定路由
        this.router.get('/', (req, res) => {
            this.controller.getServerStatus(req, res);
        });
        this.router.get('/health', (req, res) => {
            this.controller.healthCheck(req, res);
        });
        this.router.post('/shutdown', (req, res) => {
            this.controller.shutdown(req, res);
        });

        // 动态方法路由：根据可用脚本自动注册
        const methods = this.controller.methodService.getAvailableMethods();
        for (const method of methods) {
            const path = `/${method.name}`;
            this.router.get(path, (req, res) => {
                this.controller.methodTest(req, res);
            });
            this.router.post(path, (req, res) => {
                this.controller.methodTest(req, res);
            });
        }
    }

    getRouter() {
        return this.router;
    }
}

module.exports = Route;
