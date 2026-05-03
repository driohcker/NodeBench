const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class K6Driver {
    constructor(logger) {
        this.logger = logger; // 只接收logger实例
        this.k6Process = null;
        this.isRunning = false;
        
        // 根据操作系统选择k6二进制文件
        this.k6Path = process.platform === 'win32' 
            ? path.join(process.cwd(), 'bin', 'k6', 'k6.exe')
            : path.join(process.cwd(), 'bin', 'k6', 'k6');
    }

    /**
     * 启动k6测试
     * @param {string[]} args - k6命令行参数数组
     * @param {Object} env - 需要注入的环境变量
     */
    start(args, env = {}) {
        return new Promise((resolve, reject) => {
            if (this.isRunning) {
                return reject(new Error('k6已经在运行中'));
            }

            const commandStr = [this.k6Path, ...args].join(' ');
            this.logger.info(`启动k6测试，命令: ${commandStr}`);

            this.k6Process = spawn(this.k6Path, args, {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    ...env
                }
            });

            this.isRunning = true;

            let stderrOutput = '';

            this.k6Process.stdout.on('data', (data) => {
                // 将k6的输出拆分成行，逐行用logger打印，避免格式混乱
                const lines = data.toString().split('\n').filter(line => line.trim() !== '');
                lines.forEach(line => this.logger.info(`[k6] ${line}`));
            });

            this.k6Process.stderr.on('data', (data) => {
                const message = data.toString();
                stderrOutput += message;
                // 逐行打印错误
                const lines = message.split('\n').filter(line => line.trim() !== '');
                lines.forEach(line => this.logger.error(`[k6 ERROR] ${line}`));
            });

            this.k6Process.on('close', (code) => {
                this.logger.info(`k6测试结束，退出码: ${code}`);
                this.isRunning = false;
                this.k6Process = null;
                
                // k6在遇到阈值失败时会以非0码退出，这本身不是驱动程序的错误
                // 但如果退出码不是0，并且stderr中有内容，我们可能需要将其作为错误抛出
                if (code !== 0 && stderrOutput.includes('level=error')) {
                    // 仅在真正发生错误时reject
                    reject(new Error(`k6测试失败，退出码: ${code}. 查看日志获取详情.`));
                } else {
                    resolve(code); // 正常完成或因阈值失败而完成
                }
            });

            this.k6Process.on('error', (err) => {
                this.logger.error('启动k6进程失败:', err);
                this.isRunning = false;
                this.k6Process = null;
                reject(err);
            });
        });
    }

    /**
     * 停止k6测试
     * @param {number} [timeout=30000] - 等待进程正常退出的超时时间（毫秒）
     */
    stop(timeout = 30000) {
        if (!this.k6Process || !this.isRunning) {
            this.logger.info('k6未在运行中');
            return Promise.resolve();
        }

        this.logger.info(`正在停止k6测试 (PID: ${this.k6Process.pid}, 超时: ${timeout / 1000}s)...`);

        if (process.platform === 'win32') {
            // 在Windows上，使用taskkill来确保整个进程树被终止
            const pid = this.k6Process.pid;
            this.logger.info(`[Windows] 使用 taskkill /PID ${pid} /T /F 来终止进程树`);
            
            const { exec } = require('child_process');
            exec(`taskkill /PID ${pid} /T /F`, (err, stdout, stderr) => {
                if (err) {
                    // 如果进程已经不存在，taskkill会报错，这是预期的，不应视为严重错误
                    if (stderr.includes('not found')) {
                        this.logger.warn(`尝试终止的进程 PID: ${pid} 已不存在。`);
                    } else {
                        this.logger.error(`执行 taskkill 失败: ${stderr}`);
                    }
                } else {
                    this.logger.info(`taskkill 成功终止进程树 PID: ${pid}`);
                }
            });
            // 无论taskkill结果如何，我们都认为停止操作已发出
            this.isRunning = false;
            this.k6Process = null;
            return Promise.resolve();

        } else {
            // 在非Windows系统上，继续使用信号
            this.k6Process.kill('SIGINT'); // 发送中断信号，让k6优雅地关闭

            return new Promise((resolve) => {
                const forceKillTimeout = setTimeout(() => {
                    if (this.k6Process) {
                        this.logger.warn('k6进程停止超时，强制终止 (SIGKILL)');
                        this.k6Process.kill('SIGKILL');
                    }
                    resolve(); 
                }, timeout);

                this.k6Process.on('close', () => {
                    clearTimeout(forceKillTimeout);
                    this.logger.info('k6进程已成功停止');
                    resolve();
                });
            });
        }
    }

    /**
     * 检查k6是否在运行
     */
    isK6Running() {
        return this.isRunning;
    }
}

module.exports = K6Driver;