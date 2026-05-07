const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const TestFlowManager = require('../helper/TestFlowManager');
const DataFilter = require('../helper/DataFilter');

/**
 * TestRunnerService - 测试运行服务
 * 负责管理k6测试流程，支持多目标顺序测试、信号处理、数据过滤输出
 */
class TestRunnerService extends EventEmitter {
    constructor(config, logger) {
        super();
        this.config = config;
        this.logger = logger;
        this.flowManager = new TestFlowManager(config, logger);
        this.dataFilter = new DataFilter(config, logger);
        
        this.isRunning = false;
        this.currentProcess = null;
        this.currentTargetIndex = 0;
        this.targets = [];
        this.overrides = null;
        this.outputMode = config.outputMode || 'file';
        this.signalBuffer = null; // 用于接收主控端信号
        this.writeStream = null;
        this.pipeWriteStream = null;
        this.currentVUs = 0;
        this.lastLoggedVUs = -1;
        this.totalStages = 0;
        this.currentStage = 0;
    }

    /**
     * 启动测试流程
     * @param {Object} overrides - 临时覆盖配置
     */
    async startTest(overrides = {}) {
        if (this.isRunning) {
            throw new Error('测试流程已在运行中');
        }

        this.overrides = { ...this.config, ...overrides };
        this.targets = (this.overrides.testTargets && this.overrides.testTargets.length > 0) ? this.overrides.testTargets : ['cpu'];
        this.outputMode = this.overrides.outputMode || this.config.outputMode || 'file';
        this.currentTargetIndex = 0;
        this.currentVUs = 0;
        this.lastLoggedVUs = -1;
        const stages = this._buildStages();
        this.totalStages = stages.length;
        
        const sessionId = this.flowManager.generateSessionId();
        this.isRunning = true;
        this.signalBuffer = null;
        
        // 预生成第一个子流程的session2Id和目录，方便主控端立即获取
        if (this.targets.length > 0) {
            const firstTarget = this.targets[0];
            const firstSession2Id = this.flowManager.generateSession2Id(firstTarget);
            if (this.outputMode === 'file') {
                this.flowManager.createOutputDirs(sessionId, firstSession2Id);
            }
            this.logger.info(`[TestRunnerService] 预生成第一个子流程: target=${firstTarget}, session2Id=${firstSession2Id}, outputMode=${this.outputMode}`);
        }

        this.logger.info(`[TestRunnerService] 启动测试流程 sessionId=${sessionId}, 目标: ${this.targets.join(', ')}, 输出模式: ${this.outputMode}`);

        // 异步执行测试流程
        this._runFlow().catch(err => {
            this.logger.error(`[TestRunnerService] 测试流程异常: ${err.message}`);
        }).finally(() => {
            this.isRunning = false;
            this.emit('flowComplete', { sessionId });
        });

        return { sessionId };
    }

    /**
     * 执行完整的测试流程（顺序执行各目标）
     */
    async _runFlow() {
        for (let i = 0; i < this.targets.length; i++) {
            if (!this.isRunning) break;
            this.currentTargetIndex = i;
            const target = this.targets[i];
            
            this.logger.info(`[TestRunnerService] 开始执行子流程 ${i + 1}/${this.targets.length}: ${target}`);
            
            // 第一个子流程已在startTest中预生成，复用其session2Id
            let session2Id, session2Dir;
            if (i === 0 && this.flowManager.session2IdMap.has(target)) {
                session2Id = this.flowManager.session2IdMap.get(target);
                if (this.outputMode === 'file') {
                    session2Dir = path.join(process.cwd(), this.config.dataOutputDir || 'data/test', this.flowManager.sessionId, session2Id);
                }
                this.logger.info(`[TestRunnerService] 复用预生成的子流程: session2Id=${session2Id}, outputMode=${this.outputMode}`);
            } else {
                session2Id = this.flowManager.generateSession2Id(target);
                if (this.outputMode === 'file') {
                    const dirs = this.flowManager.createOutputDirs(this.flowManager.sessionId, session2Id);
                    session2Dir = dirs.session2Dir;
                }
            }

            // 执行子流程，支持重置重试
            let subFlowComplete = false;
            let retryCount = 0;
            const maxRetries = 3;

            while (!subFlowComplete && retryCount <= maxRetries) {
                if (!this.isRunning) break;
                
                const result = await this._runSubFlow(target, session2Id, session2Dir);
                
                if (result === 'stopped') {
                    this.logger.info(`[TestRunnerService] 子流程 ${target} 被停止信号中断`);
                    subFlowComplete = true;
                } else if (result === 'reset') {
                    retryCount++;
                    if (retryCount > maxRetries) {
                        this.logger.warn(`[TestRunnerService] 子流程 ${target} 重试次数超过上限，放弃`);
                        subFlowComplete = true;
                    } else {
                        this.logger.info(`[TestRunnerService] 子流程 ${target} 收到重置信号，第 ${retryCount} 次重试`);
                        // 提升MaxVUs
                        const increment = this.overrides.maxVuIncrement || 100;
                        this.overrides.maxVUs = (this.overrides.maxVUs || 400) + increment;
                        this.logger.info(`[TestRunnerService] MaxVUs 提升至 ${this.overrides.maxVUs}`);
                        // 清除之前的数据文件
                        this._clearSubFlowData(session2Dir);
                    }
                } else {
                    subFlowComplete = true;
                }
            }

            if (!this.isRunning) break;
        }

        this.logger.info(`[TestRunnerService] 测试流程全部结束 sessionId=${this.flowManager.sessionId}`);
    }

    /**
     * 执行单个子流程
     */
    async _runSubFlow(target, session2Id, session2Dir) {
        return new Promise((resolve, reject) => {
            const args = this._buildK6Args(target, session2Dir);
            const env = this._buildK6Env(target);
            
            const k6Path = process.platform === 'win32'
                ? path.join(process.cwd(), 'bin', 'k6', 'k6.exe')
                : path.join(process.cwd(), 'bin', 'k6', 'k6');

            this.logger.info(`[TestRunnerService] 启动k6: ${k6Path} ${args.join(' ')}`);

            this.currentProcess = spawn(k6Path, args, {
                cwd: process.cwd(),
                env: { ...process.env, ...env }
            });

            let subFlowFinished = false;

            // 数据输出处理
            let outputPath = null;
            if (this.outputMode === 'file' && session2Dir) {
                outputPath = path.join(session2Dir, 'metrics.json');
                this.writeStream = fs.createWriteStream(outputPath, { flags: 'w' });
            }

            this.currentProcess.stdout.on('data', (data) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                for (const line of lines) {
                    const filtered = this.dataFilter.filterLine(line);
                    if (filtered) {
                        if (this.outputMode === 'file' && this.writeStream) {
                            this.writeStream.write(filtered + '\n');
                        } else if (this.outputMode === 'pipe') {
                            this.emit('metric', filtered);
                        }
                        // 提取当前VUs用于进度显示
                        try {
                            const obj = JSON.parse(filtered);
                            if (obj.type === 'Point' && obj.metric === 'vus' && typeof obj.data?.value === 'number') {
                                this.currentVUs = obj.data.value;
                                if (this.currentVUs !== this.lastLoggedVUs) {
                                    const progress = this.totalStages > 0 ? Math.round((this.currentVUs / this.overrides.maxVUs) * 100) : 0;
                                    this.logger.info(`[TestRunnerService] 测试进度: 当前VUs=${this.currentVUs}, 目标MaxVUs=${this.overrides.maxVUs || 400}, 进度=${progress}%`);
                                    this.lastLoggedVUs = this.currentVUs;
                                }
                            }
                        } catch (e) { /* ignore */ }
                    }
                }
            });

            this.currentProcess.stderr.on('data', (data) => {
                const msg = data.toString();
                if (msg.includes('level=error')) {
                    this.logger.error(`[k6 stderr] ${msg.trim()}`);
                }
            });

            this.currentProcess.on('close', (code) => {
                this.logger.info(`[TestRunnerService] k6子流程退出，code=${code}`);
                if (this.writeStream) {
                    this.writeStream.end();
                    this.writeStream = null;
                }
                this.currentProcess = null;

                if (!subFlowFinished) {
                    // 输出子流程完毕标记
                    const completeMarker = JSON.stringify({ type: 'SubFlowComplete', target, session2Id, timestamp: new Date().toISOString() });
                    if (this.outputMode === 'file' && outputPath) {
                        fs.appendFileSync(outputPath, completeMarker + '\n');
                    } else if (this.outputMode === 'pipe') {
                        this.emit('metric', completeMarker);
                    }

                    // 等待期
                    const waitTime = (this.overrides.waitPeriod || 5) * 1000;
                    this.logger.info(`[TestRunnerService] 进入等待期 ${waitTime}ms`);
                    
                    setTimeout(() => {
                        // 检查信号缓冲
                        if (this.signalBuffer === 'reset') {
                            this.signalBuffer = null;
                            resolve('reset');
                        } else {
                            subFlowFinished = true;
                            resolve('complete');
                        }
                    }, waitTime);
                }
                
                // 清理checkSignal定时器
                clearInterval(checkSignal);
            });

            this.currentProcess.on('error', (err) => {
                this.logger.error(`[TestRunnerService] k6进程错误: ${err.message}`);
                reject(err);
            });

            // 监听信号
            const checkSignal = setInterval(() => {
                if (this.signalBuffer === 'stop') {
                    this.signalBuffer = null;
                    clearInterval(checkSignal);
                    this._killK6Process();
                    subFlowFinished = true;
                    resolve('stopped');
                } else if (this.signalBuffer === 'reset') {
                    this.signalBuffer = null;
                    clearInterval(checkSignal);
                    this._killK6Process();
                    subFlowFinished = true;
                    resolve('reset');
                }
            }, 100);
        });
    }

    /**
     * 构建k6命令行参数
     */
    _buildK6Args(target, session2Dir) {
        const args = ['run'];
        
        // 新架构下仅使用单一脚本 stepped_load_test.js
        const scriptPath = path.join(process.cwd(), 'scripts', 'test_scripts', 'stepped_load_test.js');
        
        // 统一使用stdout输出JSON Lines，由Node端过滤并分发（写入文件或emit管道）
        // 避免k6直接写文件与Node写文件产生竞争，同时保证数据经过DataFilter过滤
        args.push('--out', 'json');
        
        // 仅在file模式下导出summary到磁盘
        if (this.outputMode === 'file' && session2Dir) {
            args.push('--summary-export', path.join(session2Dir, 'summary.json'));
        }
        args.push(scriptPath);
        
        return args;
    }

    /**
     * 构建k6环境变量
     */
    _buildK6Env(target) {
        const stages = this._buildStages();
        return {
            K6_TEST_STAGES: JSON.stringify(stages),
            K6_TARGET: target,
            K6_SERVER_URL: this.config.serverUrl || 'http://localhost:10000'
            // 注意：不要传递 K6_ITERATIONS / K6_DURATION 等变量，
            // 因为 k6 会自动将 K6_ 前缀的环境变量映射为 options 覆盖，
            // 这会覆盖脚本中的 stages 配置，导致测试提前结束。
        };
    }

    /**
     * 自动构建测试阶段（stages）
     */
    _buildStages() {
        const initVUs = this.overrides.initVUs || 1;
        const maxVUs = this.overrides.maxVUs || 400;
        const iterations = this.overrides.iterations || 30;
        const duration = this.overrides.duration || '6s';
        
        const stages = [];
        const delta = Math.max(0, maxVUs - initVUs);
        
        for (let i = 0; i <= iterations; i++) {
            const ratio = iterations === 0 ? 0 : i / iterations;
            const target = Math.round(initVUs + delta * ratio);
            stages.push({ duration, target });
        }
        
        return stages;
    }

    /**
     * 停止当前测试流程
     */
    async stopTest() {
        this.logger.info('[TestRunnerService] 收到停止测试命令');
        this.isRunning = false;
        await this._killK6Process();
        if (this.writeStream) {
            this.writeStream.end();
            this.writeStream = null;
        }
        this.flowManager.reset();
        this.currentVUs = 0;
        this.lastLoggedVUs = -1;
        this.totalStages = 0;
        this.logger.info('[TestRunnerService] 测试流程已停止');
    }

    /**
     * 强制终止k6进程
     */
    async _killK6Process() {
        if (!this.currentProcess) return;
        
        const pid = this.currentProcess.pid;
        this.logger.info(`[TestRunnerService] 终止k6进程 PID=${pid}`);
        
        if (process.platform === 'win32') {
            const { exec } = require('child_process');
            await new Promise((resolve) => {
                exec(`taskkill /PID ${pid} /T /F`, (err) => {
                    if (err) this.logger.warn(`taskkill失败: ${err.message}`);
                    resolve();
                });
            });
        } else {
            this.currentProcess.kill('SIGINT');
            await new Promise((resolve) => {
                setTimeout(() => {
                    if (this.currentProcess && !this.currentProcess.killed) {
                        this.currentProcess.kill('SIGKILL');
                    }
                    resolve();
                }, 3000);
            });
        }
    }

    /**
     * 接收来自主控端的信号
     */
    onSignal(signal) {
        if (['stop', 'reset'].includes(signal)) {
            this.logger.info(`[TestRunnerService] 收到信号: ${signal}`);
            this.signalBuffer = signal;
        }
    }

    /**
     * 获取测试状态
     */
    getTestStatus() {
        const flowInfo = this.flowManager.getCurrentFlowInfo();
        const progress = this.isRunning && this.overrides?.maxVUs ? Math.round((this.currentVUs / this.overrides.maxVUs) * 100) : 0;
        return {
            isRunning: this.isRunning,
            sessionId: flowInfo.sessionId,
            currentTarget: flowInfo.currentTarget,
            currentSession2Id: flowInfo.currentSession2Id,
            targets: this.targets,
            currentTargetIndex: this.currentTargetIndex,
            outputMode: this.outputMode,
            currentVUs: this.currentVUs,
            maxVUs: this.overrides?.maxVUs || this.config.maxVUs || 400,
            progress: progress
        };
    }

    /**
     * 设置输出模式
     */
    setOutputMode(mode) {
        if (!['file', 'pipe', 'rest'].includes(mode)) {
            throw new Error(`不支持的输出模式: ${mode}`);
        }
        this.outputMode = mode;
        this.logger.info(`[TestRunnerService] 输出模式已设置为: ${mode}`);
    }

    /**
     * 清除子流程数据
     */
    _clearSubFlowData(session2Dir) {
        try {
            if (fs.existsSync(session2Dir)) {
                const files = fs.readdirSync(session2Dir);
                for (const file of files) {
                    fs.unlinkSync(path.join(session2Dir, file));
                }
                this.logger.info(`[TestRunnerService] 已清除子流程数据: ${session2Dir}`);
            }
        } catch (e) {
            this.logger.warn(`[TestRunnerService] 清除子流程数据失败: ${e.message}`);
        }
    }
}

module.exports = TestRunnerService;
