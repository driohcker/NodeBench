const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const TestFlowManager = require('../helper/TestFlowManager');
const DataFilter = require('../helper/DataFilter');
const { extractMetaFromK6Script } = require('../../../utils/metaExtractor');

/**
 * TestRunnerService - 测试运行服务
 * 负责管理k6单一测试子流程执行、信号处理、数据过滤输出
 * 不再内部循环多个目标，也不负责重试决策，完全由主控端调控
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
        this.overrides = null;
        this.outputMode = config.outputMode || 'file';
        this.signalBuffer = null;
        this.writeStream = null;
        this.currentVUs = 0;
        this.lastLoggedVUs = -1;
        this.totalStages = 0;
    }

    /**
     * 启动单一测试子流程
     * @param {Object} overrides - 临时覆盖配置，需包含 target, sessionId, session2Id
     */
    async startTest(overrides = {}) {
        if (this.isRunning) {
            throw new Error('测试流程已在运行中');
        }

        this.overrides = { ...this.config, ...overrides };
        // 兼容旧调用：未提供 target 时，使用 testTargets 的第一个
        let target = this.overrides.target;
        if (!target) {
            const fallbackTargets = this.overrides.testTargets || this.config.testTargets || ['cpu'];
            target = fallbackTargets[0];
            this.overrides.target = target;
        }
        this.outputMode = this.overrides.outputMode || this.config.outputMode || 'file';
        this.currentVUs = 0;
        this.lastLoggedVUs = -1;
        const stages = this._buildStages();
        this.totalStages = stages.length;
        
        let sessionId = this.overrides.sessionId;
        if (!sessionId) {
            sessionId = this.flowManager.generateSessionId();
        } else {
            this.flowManager.sessionId = sessionId;
        }
        
        let session2Id = this.overrides.session2Id;
        if (!session2Id) {
            session2Id = this.flowManager.generateSession2Id(target);
        } else {
            this.flowManager.session2IdMap.set(target, session2Id);
            this.flowManager.currentTarget = target;
            this.flowManager.currentSession2Id = session2Id;
        }
        
        if (this.outputMode === 'file') {
            this.flowManager.createOutputDirs(sessionId, session2Id);
            // 写入 target 信息供离线分析使用
            const session2Dir = path.join(process.cwd(), this.config.dataOutputDir || 'data/test', sessionId, session2Id);
            try {
                fs.writeFileSync(path.join(session2Dir, 'target.info'), target);
            } catch (e) {
                this.logger.warn(`[TestRunnerService] 写入 target.info 失败: ${e.message}`);
            }
        }

        this.isRunning = true;
        this.signalBuffer = null;
        this.dataFilter.reset(); // 重置大波动过滤状态，避免跨测试污染历史窗口

        this.logger.info(`[TestRunnerService] 启动单一测试子流程 sessionId=${sessionId}, session2Id=${session2Id}, target=${target}, outputMode=${this.outputMode}`);

        // 执行单一子流程
        const session2Dir = this.outputMode === 'file'
            ? path.join(process.cwd(), this.config.dataOutputDir || 'data/test', sessionId, session2Id)
            : null;

        let result;
        try {
            result = await this._runSubFlow(target, session2Id, session2Dir);
            this.logger.info(`[TestRunnerService] 子流程结束 target=${target}, result=${result}`);
        } catch (err) {
            this.logger.error(`[TestRunnerService] 子流程异常: ${err.message}`);
            result = 'error';
        } finally {
            this.isRunning = false;
            this.lastResult = result || 'complete';
            this.emit('subFlowComplete', { sessionId, session2Id, target, result: this.lastResult });
        }

        return { sessionId, session2Id, target };
    }

    /**
     * 执行单个子流程（一次k6运行）
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
            // file 模式同时保存原始 k6 JSON（metrics.json）并 emit('metric') 走管道
            // pipe 模式只 emit('metric')
            let outputPath = null;
            if (this.outputMode === 'file' && session2Dir) {
                outputPath = path.join(session2Dir, 'metrics.json');
                this.writeStream = fs.createWriteStream(outputPath, { flags: 'w' });
            }

            this.currentProcess.stdout.on('data', (data) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                for (const line of lines) {
                    // 先解析原始JSON，提取vus以更新当前VUs
                    let rawMetricData = null;
                    try {
                        const rawObj = JSON.parse(line);
                        if (rawObj.type === 'Point' && rawObj.data?.value !== undefined) {
                            // 优先从原始数据中更新currentVUs
                            if (rawObj.metric === 'vus' && typeof rawObj.data?.value === 'number') {
                                this.currentVUs = rawObj.data.value;
                            }
                            rawMetricData = {
                                metric: rawObj.metric,
                                time: rawObj.data?.time,
                                value: rawObj.data?.value,
                                currentVUs: this.currentVUs
                            };
                        }
                    } catch (e) { /* ignore non-JSON lines */ }

                    // 推送原始数据给测试管理页面（用于原始趋势图诊断）
                    if (rawMetricData) {
                        this.emit('rawMetric', rawMetricData);
                    }

                    const filtered = this.dataFilter.filterLine(line);
                    if (filtered) {
                        // 统一走管道 emit，无论 file 还是 pipe 模式
                        this.emit('metric', filtered);
                        // file 模式下同时保存原始 k6 JSON 到磁盘（后手备份）
                        if (this.outputMode === 'file' && this.writeStream) {
                            this.writeStream.write(filtered + '\n');
                        }
                        // 提取当前VUs用于进度显示（兜底，如果原始解析时没更新到）
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
                    const now = new Date();
                    const pad = (n) => String(n).padStart(2, '0');
                    const localTs = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
                    const completeMarker = JSON.stringify({ type: 'SubFlowComplete', target, session2Id, timestamp: localTs });
                    // 统一通过 emit 发送 SubFlowComplete 标记
                    this.emit('metric', completeMarker);
                    // file 模式下同时追加到磁盘文件
                    if (this.outputMode === 'file' && outputPath) {
                        fs.appendFileSync(outputPath, completeMarker + '\n');
                    }

                    // 等待期（保持与主控端信号同步）
                    const waitTime = (this.overrides.waitPeriod || 5) * 1000;
                    this.logger.info(`[TestRunnerService] 进入等待期 ${waitTime}ms`);
                    
                    setTimeout(() => {
                        // 检查信号缓冲
                        if (this.signalBuffer === 'stop') {
                            this.signalBuffer = null;
                            subFlowFinished = true;
                            resolve('stopped');
                        } else if (this.signalBuffer === 'reset') {
                            this.signalBuffer = null;
                            subFlowFinished = true;
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
     * 扫描测试脚本目录
     */
    _scanTestScripts() {
        const scriptDir = path.join(process.cwd(), 'scripts', 'test_scripts');
        if (!fs.existsSync(scriptDir)) return [];
        const files = fs.readdirSync(scriptDir).filter(f => f.endsWith('_test.js'));
        return files.map(f => {
            const filePath = path.join(scriptDir, f);
            const meta = extractMetaFromK6Script(filePath) || {};
            const name = meta.name || f.replace('_test.js', '');
            return {
                name,
                fileName: f,
                filePath,
                meta: {
                    displayName: meta.displayName || name,
                    description: meta.description || '',
                    targets: meta.targets || [],
                    ...meta
                }
            };
        });
    }

    /**
     * 根据测试目标选择对应的测试脚本
     */
    _resolveTestScript(target) {
        const scripts = this._scanTestScripts();
        // 优先选择明确支持该 target 的脚本
        const matched = scripts.find(s => s.meta.targets.includes(target));
        if (matched) {
            this.logger.info(`[TestRunnerService] 选择测试脚本: ${matched.fileName} (支持目标: ${target})`);
            return matched.filePath;
        }
        // fallback: 使用第一个可用脚本（兼容旧架构）
        if (scripts.length > 0) {
            this.logger.info(`[TestRunnerService] 未找到明确支持 ${target} 的脚本，fallback 到: ${scripts[0].fileName}`);
            return scripts[0].filePath;
        }
        // 最终 fallback: 硬编码路径（防止完全无脚本时崩溃）
        return path.join(process.cwd(), 'scripts', 'test_scripts', 'stepped_load_test.js');
    }

    /**
     * 构建k6命令行参数
     */
    _buildK6Args(target, session2Dir) {
        const args = ['run'];
        
        // 插件化：根据 target 动态选择测试脚本
        const scriptPath = this._resolveTestScript(target);
        
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
            K6_SERVER_URL: this.config.serverUrl || 'http://localhost:10000',
            K6_THINK_TIME: String(this.overrides.thinkTime || this.config.thinkTime || '1')
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
            currentTargetIndex: 0,
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
