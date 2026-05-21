const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

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

            // 准备日志目录，用于捕获子进程输出（Linux 下调试必需）
            const logDir = path.join(process.cwd(), 'logs', 'express_service');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const outLog = path.join(logDir, `service_${Date.now()}.log`);

            // 计算 worker 数量，通过环境变量传递给被测服务（供 memory_method.js 使用）
            const os = require('os');
            const workerCount = this.config.workers || os.cpus().length;
            const envWithWorkers = { ...process.env, WORKER_COUNT: String(workerCount) };

            if (process.platform === 'win32') {
                // Windows: 使用 cmd.exe /c start 启动新窗口
                this.expressService = spawn('cmd.exe',
                    ['/c', 'start', 'cmd.exe', '/k', nodePath, expressServicePath], {
                    detached: true,
                    stdio: 'ignore',
                    windowsVerbatimArguments: true,
                    env: envWithWorkers
                });
                // Windows 下 start 命令会立即退出，不监听 exit
            } else {
                // Linux/macOS: 直接后台运行 node 进程，重定向输出到日志以便排查问题
                const stdoutLog = fs.openSync(outLog, 'a');
                const stderrLog = fs.openSync(outLog, 'a');
                this.expressService = spawn(nodePath, [expressServicePath], {
                    detached: true,
                    stdio: ['ignore', stdoutLog, stderrLog],
                    env: envWithWorkers
                });

                // Linux 下必须监听 exit，子进程不应立即退出
                this.expressService.on('exit', (code, signal) => {
                    this.logger.warn(`被测服务进程退出 (code: ${code}, signal: ${signal})`);
                    this.isRunning = false;
                    this.expressService = null;
                    try { fs.closeSync(stdoutLog); } catch (e) {}
                    try { fs.closeSync(stderrLog); } catch (e) {}
                });

                this.expressService.on('error', (err) => {
                    this.logger.error(`被测服务进程启动错误: ${err.message}`);
                    this.isRunning = false;
                    this.expressService = null;
                    try { fs.closeSync(stdoutLog); } catch (e) {}
                    try { fs.closeSync(stderrLog); } catch (e) {}
                });
            }

            this.expressService.unref();
            this.isRunning = true;

            this.logger.info('被测服务启动成功', { pid: this.expressService.pid, log: outLog });
            if (process.platform === 'win32') {
                this.logger.info('服务在新窗口中运行');
            }

            // 检查服务是否正常运行（cluster 模式 fork 16 worker 可能需要更久）
            setTimeout(() => {
                this.getStatusExpressService().then(status => {
                    this.logger.info('服务启动后状态检查', status);
                    console.log('被测服务状态:', status);
                });
            }, 3000);
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
                // 即使 health 检查失败，也尝试 kill 残留进程
                await this._killProcessIfExists();
                this.expressService = null;
                return;
            }

            this.logger.info('正在停止被测服务...');

            // 调用 /shutdown API 优雅地停止服务
            await this.callShutdownAPI();

            // 等待进程真正退出（最多等 5 秒）
            await this._waitForProcessExit(5000);

            // 如果进程还在，强制 kill
            await this._killProcessIfExists();

            this.isRunning = false;
            this.expressService = null;

            this.logger.info('被测服务停止成功');
            console.log('被测服务已停止');
        } catch (error) {
            this.logger.error('停止被测服务失败', { error: error.message });
            this.logger.info('尝试强制停止...');

            await this._killProcessIfExists();

            this.isRunning = false;
            this.expressService = null;
        }
    }

    /**
     * 等待子进程退出
     */
    async _waitForProcessExit(timeoutMs = 5000) {
        if (!this.expressService || !this.expressService.pid) return;

        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                // 发送信号 0 检查进程是否存在
                process.kill(this.expressService.pid, 0);
                // 进程还在，等一会儿再检查
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                // 进程不存在了
                return;
            }
        }
        this.logger.warn(`被测服务进程在 ${timeoutMs}ms 内未自动退出，将强制终止`);
    }

    /**
     * 如果进程存在则强制终止
     */
    async _killProcessIfExists() {
        if (!this.expressService || !this.expressService.pid) return;

        const pid = this.expressService.pid;
        try {
            process.kill(pid, 'SIGTERM');
            await new Promise(r => setTimeout(r, 500));
            try {
                process.kill(pid, 0);
                // 还在，发送 SIGKILL
                process.kill(pid, 'SIGKILL');
            } catch (e) {
                // 已经退出了
            }
        } catch (e) {
            // 进程可能已经退出
        }

        // Windows 备用方案：通过端口查找并终止残留进程
        if (process.platform === 'win32') {
            await this._killByPortWindows();
        }
    }

    /**
     * Windows 下通过端口查找并终止进程
     */
    async _killByPortWindows() {
        try {
            const { exec } = require('child_process');
            const port = this.config.serverUrl ? new URL(this.config.serverUrl).port : 10000;
            this.logger.info(`[Windows] 尝试通过端口 ${port} 查找残留进程...`);

            // 使用 netstat 查找监听该端口的 PID（精确匹配 LISTENING 状态，避免误杀客户端连接）
            const netstatCmd = `netstat -ano | findstr :${port} | findstr LISTENING`;
            const netstatResult = await new Promise((resolve) => {
                exec(netstatCmd, (err, stdout) => {
                    if (err || !stdout) return resolve('');
                    resolve(stdout);
                });
            });

            if (!netstatResult) {
                this.logger.info(`[Windows] 未找到监听端口 ${port} 的进程`);
                return;
            }

            // 提取 PID（最后一列）
            const lines = netstatResult.split('\n').filter(l => l.trim());
            const pids = new Set();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const lastPart = parts[parts.length - 1];
                if (lastPart && /^\d+$/.test(lastPart)) {
                    pids.add(lastPart);
                }
            }

            if (pids.size === 0) {
                this.logger.info(`[Windows] 未提取到有效 PID`);
                return;
            }

            for (const pid of pids) {
                this.logger.info(`[Windows] 终止端口 ${port} 关联进程 PID=${pid}`);
                await new Promise((resolve) => {
                    exec(`taskkill /F /PID ${pid}`, (err) => {
                        if (err) {
                            this.logger.warn(`[Windows] 终止 PID ${pid} 失败: ${err.message}`);
                        } else {
                            this.logger.info(`[Windows] 已终止 PID ${pid}`);
                        }
                        resolve();
                    });
                });
            }
        } catch (e) {
            this.logger.error(`[Windows] 按端口终止进程失败: ${e.message}`);
        }
    }

    callShutdownAPI() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: '127.0.0.1',
                port: 10000,
                path: '/shutdown',
                method: 'POST',
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