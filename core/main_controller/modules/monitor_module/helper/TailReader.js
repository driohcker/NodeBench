const fs = require('fs');
const readline = require('readline');
const { EventEmitter } = require('events');

/**
 * TailReader - 持续追踪文件追加内容的 Reader
 *
 * 已弃用
 * 
 * 类似于 Unix 的 `tail -f`，每隔 interval 毫秒检查文件大小，
 * 仅读取新增部分并通过 'line' 事件逐行输出。
 *
 * 关键设计：
 * 1. 逐行处理（不一次性读入内存），避免 k6 高输出时内存爆炸
 * 2. 每处理 500 行 pause/resume 让出事件循环，防止阻塞 UI
 * 3. _poll 开始时立即更新 lastSize，防止并发时重复读取
 * 4. isPolling 标志防止并发 _poll
 */
class TailReader extends EventEmitter {
    constructor(filePath, options = {}) {
        super();
        this.filePath = filePath;
        this.interval = options.interval || 200;
        this.logger = options.logger || console;
        this.maxLinesPerPoll = options.maxLinesPerPoll || 10000; // 单次 poll 最多处理 10000 行，超出丢弃

        this.lastSize = 0;
        this.timer = null;
        this.running = false;
        this.lineCount = 0;
        this.isPolling = false;
    }

    start() {
        if (this.running) return;

        if (!fs.existsSync(this.filePath)) {
            this.logger.warn(`[TailReader] 文件不存在，等待创建: ${this.filePath}`);
            this.lastSize = 0;
        } else {
            const stat = fs.statSync(this.filePath);
            this.lastSize = stat.size;
            this.logger.info(`[TailReader] 开始追踪文件: ${this.filePath}, 初始大小: ${this.lastSize} bytes`);
        }

        this.running = true;
        this.lineCount = 0;
        this.isPolling = false;
        this.timer = setInterval(() => this._poll(), this.interval);
    }

    _poll() {
        if (!this.running || this.isPolling) return;

        try {
            if (!fs.existsSync(this.filePath)) {
                return; // 文件尚未创建，继续等待
            }

            const stat = fs.statSync(this.filePath);
            const currentSize = stat.size;

            if (currentSize > this.lastSize) {
                // 立即更新 lastSize，防止并发 poll 重复读取同一段数据
                const readStart = this.lastSize;
                this.lastSize = currentSize;
                this.isPolling = true;

                const stream = fs.createReadStream(this.filePath, { start: readStart });
                const rl = readline.createInterface({ input: stream });

                let processed = 0;
                let paused = false;

                rl.on('line', (line) => {
                    if (paused) return;
                    processed++;
                    this.lineCount++;
                    this.emit('line', line);

                    // 每 500 行 pause 一下让出事件循环，防止 k6 高输出时阻塞主进程
                    if (processed % 500 === 0) {
                        paused = true;
                        rl.pause();
                        setImmediate(() => {
                            paused = false;
                            rl.resume();
                        });
                    }

                    // 超过单次上限则丢弃剩余（避免积压导致内存/CPU爆炸）
                    if (processed >= this.maxLinesPerPoll) {
                        rl.close();
                    }
                });

                rl.on('close', () => {
                    this.isPolling = false;
                    if (processed >= this.maxLinesPerPoll) {
                        this.logger.warn(`[TailReader] 单次 poll 数据量过大，已截断处理 (${this.maxLinesPerPoll}/${processed} 行)`);
                    }
                });

                rl.on('error', (err) => {
                    this.isPolling = false;
                    this.logger.error(`[TailReader] 读取错误: ${err.message}`);
                });
            } else if (currentSize < this.lastSize) {
                // 文件被截断或重建，从头开始读取
                this.logger.info(`[TailReader] 文件被截断，从头读取: ${this.filePath}`);
                this.lastSize = 0;
            }
        } catch (err) {
            this.isPolling = false;
            this.logger.error(`[TailReader] poll 错误: ${err.message}`);
        }
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.running = false;
        this.logger.info(`[TailReader] 停止追踪，共读取 ${this.lineCount} 行`);
    }

    getStatus() {
        return {
            running: this.running,
            filePath: this.filePath,
            lastSize: this.lastSize,
            lineCount: this.lineCount
        };
    }
}

module.exports = TailReader;
