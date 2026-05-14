const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

class ExpressService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;

        this.expressService = null;
        this.isRunning = false;

        this.serverUrl = this.config.serverUrl;
    }


    async startExpressService() {
        try {
            // 检查服务是否已经在运行
            const isServiceRunning = await this.checkServiceHealth();
            
            if (isServiceRunning) {
                this.logger.info('被测服务已在运行中');
                this.isRunning = true;
                return;
            }

            this.logger.info('正在启动被测服务...');
            
            const expressServicePath = path.join(
                __dirname, 
                '..', 
                'module', 
                'express_service', 
                'index.js'
            );

            // 使用内置的 Node.js 二进制启动服务
            const nodePath = process.platform === 'win32'
                ? path.join(process.cwd(), 'bin', 'node', 'node.exe')
                : path.join(process.cwd(), 'bin', 'node', 'node');

            if (process.platform === 'win32') {
                // Windows: 使用 cmd.exe /c start 启动新窗口
                this.expressService = spawn('cmd.exe',
                    ['/c', 'start', 'cmd.exe', '/k', nodePath, expressServicePath], {
                    detached: true,
                    stdio: 'ignore',
                    windowsVerbatimArguments: true
                });
            } else {
                // Linux/macOS: 直接后台运行 node 进程
                this.expressService = spawn(nodePath, [expressServicePath], {
                    detached: true,
                    stdio: 'ignore'
                });
            }

            // 不监听 exit 事件，因为 start 命令会立即退出
            // 而是设置一个定时器来检查服务状态

            this.expressService.unref();
            this.isRunning = true;
            
            this.logger.info('被测服务启动成功', { pid: this.expressService.pid });
            this.logger.info('服务在新窗口中运行');
            
            // 检查服务是否正常运行
            setTimeout(() => {
                this.getStatusExpressService().then(status => {
                    this.logger.info('服务启动后状态检查', status);
                    console.log('被测服务状态:', status);
                });
            }, 2000);
        } catch (error) {
            this.logger.error('启动被测服务失败', { error: error.message });
            throw error;
        }
    }

    async stopExpressService() {
        try {
            // 检查服务是否真的在运行
            const isServiceRunning = await this.checkServiceHealth();
            
            if (!isServiceRunning) {
                this.logger.warn('被测服务未运行');
                this.isRunning = false;
                this.expressService = null;
                return;
            }

            this.logger.info('正在停止被测服务...');
            
            // 调用 /shutdown API 优雅地停止服务
            await this.callShutdownAPI();

            this.isRunning = false;
            this.expressService = null;
            
            this.logger.info('被测服务停止成功');
            console.log('被测服务已停止');
        } catch (error) {
            this.logger.error('停止被测服务失败', { error: error.message });
            this.logger.info('尝试强制停止...');
            
            // 如果 API 调用失败，尝试强制停止
            if (this.expressService && this.expressService.pid) {
                try {
                    process.kill(this.expressService.pid);
                } catch (e) {
                    // 进程可能已经退出
                }
            }
            
            this.isRunning = false;
            this.expressService = null;
        }
    }

    callShutdownAPI() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'localhost',
                port: 10000,
                path: '/shutdown',
                method: 'GET',
                timeout: 5000
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    this.logger.info('关闭API请求已发送');
                    // 等待服务完全关闭
                    setTimeout(resolve, 2000);
                });
            });

            req.on('error', (error) => {
                this.logger.error('调用关闭API失败', { error: error.message });
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });

            req.end();
        });
    }

    async getStatusExpressService() {
        // 通过 HTTP 请求检查服务是否真的在运行
        const isServiceRunning = await this.checkServiceHealth();
        
        return {
            isRunning: isServiceRunning,
            service: isServiceRunning ? 'active' : 'inactive',
            mode: this.config.mode || '-',
            workers: this.config.workers || '-'
        };
    }

    checkServiceHealth() {
        return new Promise((resolve) => {
            const options = {
                hostname: 'localhost',
                port: 10000,
                path: '/health',
                method: 'GET',
                timeout: 3000
            };

            const req = http.request(options, (res) => {
                resolve(res.statusCode === 200);
            });

            req.on('error', () => {
                resolve(false);
            });

            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });

            req.end();
        });
    }
}

module.exports = ExpressService;