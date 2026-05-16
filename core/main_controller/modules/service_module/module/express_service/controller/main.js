const express = require('express');
const cluster = require('cluster');
const os = require('os');
const Config = require('../../../../../utils/config');
const Logger = require('../../../../../utils/logger');
const Route = require('../route/route');
const MethodService = require('../service/method_service');

class MainController {
    constructor() {
        this.config = Config.getServerConfig();
        this.logger = new Logger(this.config.expressLogDir);

        this.methodService = new MethodService(this.logger);
        this.route = new Route(this);

        this.app = express();
        
        this.server = null;
        this.isRunning = false;
        this.isShuttingDown = false; // 添加关闭标志
        
        if (!cluster.isMaster) {
            this.setupMiddleware();
        }
    }

    setupMiddleware() {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        this.app.use((req, res, next) => {
            this.logger.info(`收到请求: ${req.method} ${req.path}`, {
                ip: req.ip,
                query: req.query,
                body: req.body
            });
            next();
        });
    }

    async start() {
        try {
            if (this.isRunning) {
                this.logger.warn('服务已在运行中');
                return;
            }

            if (cluster.isMaster) {
                this.logger.info('准备启动被测服务', this.config);
            }

            if (this.config.mode === 'cluster') {
                await this.startClusterMode();
            } else {
                await this.startSingleMode();
            }
        } catch (error) {
            this.logger.error('启动服务失败', { error: error.message });
            throw error;
        }
    }

    async initialize() {
        try {
            if (cluster.isMaster) {
                this.logger.info('初始化被测服务...');
                this.logger.info('被测服务初始化成功！');
            }
        } catch (error) {
            this.logger.error('初始化失败', { error: error.message });
            throw error;
        }
    }

    async startClusterMode() {
        const workers = this.config.workers || os.cpus().length;
        
        if (cluster.isMaster) {
            this.logger.info(`集群模式启动，主进程 PID: ${process.pid}，工作进程数: ${workers}`);
            
            // 【关键】设置环境变量供 worker 进程继承，用于 memory_method.js 计算安全配额
            process.env.WORKER_COUNT = String(workers);
            this.logger.info(`已设置 WORKER_COUNT=${workers}，memory 测试将采用安全饱和度策略`);
            
            let workersStarted = 0;
            
            for (let i = 0; i < workers; i++) {
                const worker = cluster.fork();
                
                worker.on('listening', () => {
                    workersStarted++;
                    if (workersStarted === workers) {
                        this.logger.info(`所有 ${workers} 个工作进程已启动完成`);
                    }
                });
            }

            cluster.on('exit', (worker, code, signal) => {
                this.logger.warn(`工作进程 ${worker.process.pid} 退出 (code: ${code}, signal: ${signal})`);
                
                // 如果不是正在关闭状态，才重新启动工作进程
                if (!this.isShuttingDown) {
                    this.logger.warn('重新启动工作进程...');
                    cluster.fork();
                }
            });

            // 监听工作进程的消息
            cluster.on('message', (worker, message) => {
                if (message === 'shutdown') {
                    this.logger.info('收到关闭请求，正在关闭所有工作进程...');
                    this.isShuttingDown = true;
                    
                    // 关闭所有工作进程
                    for (const id in cluster.workers) {
                        cluster.workers[id].send('shutdown');
                    }
                    
                    // 延迟退出主进程
                    setTimeout(() => {
                        process.exit(0);
                    }, 2000);
                }
            });

            this.isRunning = true;
        } else {
            await this.startServer();
        }
    }

    async startSingleMode() {
        this.logger.info(`单机模式启动，进程 PID: ${process.pid}`);
        await this.startServer();
    }

    async startServer() {
        if (cluster.isMaster) {
            this.logger.info('主进程不启动服务器');
            return;
        }

        // 工作进程监听关闭消息
        process.on('message', (message) => {
            if (message === 'shutdown') {
                this.logger.info('收到关闭消息，正在退出工作进程...');
                process.exit(0);
            }
        });

        const serverUrl = new URL(this.config.serverUrl);
        const port = serverUrl.port || 10000;
        
        this.app.use('/', this.route.getRouter());
        
        this.server = this.app.listen(port, () => {
            if (this.config.mode === 'cluster') {
                this.logger.info(`[Worker ${process.pid}] 服务已启动，监听端口 ${port}`);
            } else {
                this.logger.info(`服务已启动，监听端口 ${port}`);
            }
            this.isRunning = true;
        });

        this.server.on('error', (error) => {
            this.logger.error(`服务启动失败: ${error.message}`);
            throw error;
        });
    }

    async stop() {
        try {
            if (!this.isRunning) {
                this.logger.warn('服务未运行');
                return;
            }

            // 设置关闭标志，阻止集群自动重启
            this.isShuttingDown = true;

            this.logger.info('准备停止被测服务');

            if (this.server) {
                await new Promise((resolve, reject) => {
                    this.server.close((error) => {
                        if (error) {
                            this.logger.error('关闭服务失败', { error: error.message });
                            reject(error);
                        } else {
                            this.logger.info('Express服务已关闭');
                            resolve();
                        }
                    });
                });
            }

            if (this.config.mode === 'cluster' && cluster.isMaster) {
                for (const id in cluster.workers) {
                    cluster.workers[id].kill();
                }
                this.logger.info('已关闭所有工作进程');
            }

            this.isRunning = false;
            this.logger.info('被测服务已停止');
        } catch (error) {
            this.logger.error('停止服务失败', { error: error.message });
            throw error;
        }
    }

    async getServerStatus(req, res) {
        try {
            const status = {
                running: this.isRunning,
                mode: this.config.mode,
                pid: process.pid,
                workers: this.config.mode === 'cluster' && cluster.isMaster 
                    ? Object.keys(cluster.workers).length 
                    : 1,
                availableMethods: this.methodService.getAvailableMethods()
            };
            
            this.logger.info('获取服务状态', status);
            res.json({
                success: true,
                data: status
            });
        } catch (error) {
            this.logger.error('获取服务状态失败', { error: error.message });
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async healthCheck(req, res) {
        try {
            res.json({
                success: true,
                status: 'healthy',
                timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async cpuTest(req, res) {
        try {
            const params = req.method === 'POST' ? req.body : req.query;
            const result = await this.methodService.executeCpuTest(params);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error) {
            this.logger.error('CPU测试处理失败', { error: error.message });
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async memoryTest(req, res) {
        try {
            const params = req.method === 'POST' ? req.body : req.query;
            const result = await this.methodService.executeMemoryTest(params);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error) {
            this.logger.error('内存测试处理失败', { error: error.message });
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async diskTest(req, res) {
        try {
            const params = req.method === 'POST' ? req.body : req.query;
            const result = await this.methodService.executeDiskTest(params);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error) {
            this.logger.error('磁盘测试处理失败', { error: error.message });
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async ioTest(req, res) {
        try {
            const params = req.method === 'POST' ? req.body : req.query;
            const result = await this.methodService.executeIoTest(params);
            
            if (result.success) {
                res.json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error) {
            this.logger.error('IO测试处理失败', { error: error.message });
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    async shutdown(req, res) {
        try {
            this.logger.info('收到关闭请求，正在停止服务...');
            
            res.json({
                success: true,
                message: '服务正在关闭',
                timestamp: new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
            });
            
            // 延迟执行关闭，确保响应能够发送
            setTimeout(async () => {
                if (cluster.isMaster) {
                    // 主进程直接关闭
                    await this.stop();
                    process.exit(0);
                } else {
                    // 工作进程发送关闭消息给主进程
                    process.send('shutdown');
                    await this.stop();
                }
            }, 1000);
            
        } catch (error) {
            this.logger.error('关闭服务失败', { error: error.message });
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
}

module.exports = MainController;
