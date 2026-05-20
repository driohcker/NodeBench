const blessed = require('blessed');
const readline = require('readline');
const MainController = require('../core/main_controller/controller/main');
const Config = require('../core/main_controller/utils/config');
const Logger = require('../core/main_controller/utils/logger');
const CliCommands = require('./commands');

/**
 * NodeBench CLI 应用
 *
 * 支持两种模式:
 * 1. TTY 模式 (默认): 使用 blessed 实现输入输出分离的终端 UI
 *    - 上部: 日志输出区 (可滚动)
 *    - 中部: 实时状态栏
 *    - 底部: 命令输入区
 * 2. 非 TTY 模式: 使用标准 readline (CI/管道环境降级)
 */
class CliApp {
    constructor() {
        this.config = Config;
        this.logger = new Logger(this.config.getMainConfig().logDir);
        this.controller = null;
        this.commands = null;

        // UI 组件 (blessed 模式)
        this.screen = null;
        this.logBox = null;
        this.statusBox = null;
        this.inputBox = null;
        this.promptBox = null;
        this.titleBox = null;

        // readline (降级模式)
        this.rl = null;
        this.isTTY = process.stdin.isTTY && process.stdout.isTTY;

        this.statusTimer = null;
        this._origConsoleLog = null;
        this._origConsoleError = null;
        this._origConsoleWarn = null;
    }

    async start() {
        if (this.isTTY) {
            await this._startBlessedMode();
        } else {
            await this._startReadlineMode();
        }
    }

    // ═══════════════════════════════════════════════
    // Blessed 模式 (TTY)
    // ═══════════════════════════════════════════════

    async _startBlessedMode() {
        // 1. 创建 blessed UI
        this._createBlessedUI();

        // 2. 重定向 console 输出到 logBox
        this._redirectConsole();

        // 3. 初始化主控制器
        this.logger.info('CLI 正在初始化...');
        try {
            this.controller = new MainController(this.config, this.logger);
        } catch (err) {
            this.logBox.log(`{red-fg}❌ 初始化失败: ${err.message}{/red-fg}`);
            this.screen.render();
            throw err;
        }

        this.commands = new CliCommands(this.controller, this.logger, this.logBox);

        // 4. 显示欢迎信息
        this._showBanner();

        // 5. 启动状态轮询
        this._startStatusPoll();

        // 6. 聚焦输入框并手动开始读取输入
        this.inputBox.focus();
        this.inputBox.readInput();
        this.screen.render();
    }

    _createBlessedUI() {
        // 关键修复：设置 input: false，让 screen 不再监听 stdin
        // 避免 screen 的 keypress 监听器与 textbox.readInput() 竞争 stdin
        // 这是解决 Linux 终端下字符重复输入的根本原因
        this.screen = blessed.screen({
            smartCSR: true,
            title: 'NodeBench CLI',
            mouse: false,
            fullUnicode: true,
            input: false
        });

        // ─── 标题栏 ───
        this.titleBox = blessed.box({
            parent: this.screen,
            top: 0,
            left: 0,
            width: '100%',
            height: 1,
            content: ' {bold}NodeBench CLI{/bold} | 输入 {green-fg}help{/green-fg} 查看命令 | Ctrl+C 退出 ',
            tags: true,
            style: {
                fg: 'white',
                bg: 'blue'
            }
        });

        // ─── 日志输出区 ───
        this.logBox = blessed.log({
            parent: this.screen,
            top: 1,
            left: 0,
            width: '100%',
            height: '100%-4',
            border: { type: 'line' },
            label: ' 系统输出 ',
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: ' ',
                inverse: true,
                style: { bg: 'cyan' }
            },
            style: {
                border: { fg: 'cyan' },
                fg: 'white',
                bg: 'black',
                scrollbar: { bg: 'cyan' }
            },
            keys: false,
            vi: false
        });

        // ─── 状态栏 ───
        this.statusBox = blessed.box({
            parent: this.screen,
            bottom: 1,
            left: 0,
            width: '100%',
            height: 1,
            content: ' 初始化中...',
            tags: true,
            style: {
                fg: 'white',
                bg: 'grey'
            }
        });

        // ─── 输入提示 ───
        this.promptBox = blessed.box({
            parent: this.screen,
            bottom: 0,
            left: 0,
            width: 3,
            height: 1,
            content: ' > ',
            tags: true,
            style: {
                fg: 'green',
                bold: true,
                bg: 'black'
            }
        });

        // ─── 输入框 ───
        // 使用 textbox 但不启用 inputOnFocus，改为手动控制 readInput()
        // 避免 Linux 终端下 stdin 被重复读取导致字符翻倍
        this.inputBox = blessed.textbox({
            parent: this.screen,
            bottom: 0,
            left: 3,
            width: '100%-3',
            height: 1,
            inputOnFocus: false,
            style: {
                fg: 'white',
                bg: 'black',
                focus: {
                    fg: 'white',
                    bg: 'black'
                }
            },
            keys: false
        });

        // ─── 输入处理 ───
        this.inputBox.on('submit', async (text) => {
            this.inputBox.clearValue();
            this.screen.render();

            const cmd = text.trim();
            if (!cmd) {
                this.inputBox.readInput();
                return;
            }

            this.logBox.log(`{green-fg}> ${cmd}{/green-fg}`);
            this.screen.render();

            if (cmd === 'exit' || cmd === 'quit') {
                await this.commands.cmdExit();
                return;
            }

            try {
                await this.commands.execute(cmd);
            } catch (err) {
                this.logBox.log(`{red-fg}✗ 命令执行失败: ${err.message}{/red-fg}`);
                this.screen.render();
            }

            // 命令执行完后重新读取输入
            this.inputBox.readInput();
        });

        // Ctrl+C 取消输入时退出
        this.inputBox.on('cancel', async () => {
            if (this.commands) {
                await this.commands.cmdExit();
            } else {
                process.exit(0);
            }
        });

        // 绑定全局键盘滚动：上下键/PageUp/PageDown 滚动日志区
        this.screen.key(['pageup', 'pagedown', 'up', 'down'], (ch, key) => {
            if (!this.logBox) return;
            if (key.name === 'pageup') {
                this.logBox.scroll(-10);
            } else if (key.name === 'pagedown') {
                this.logBox.scroll(10);
            } else if (key.name === 'up') {
                this.logBox.scroll(-1);
            } else if (key.name === 'down') {
                this.logBox.scroll(1);
            }
            this.screen.render();
        });
    }

    // ═══════════════════════════════════════════════
    // Readline 降级模式 (非 TTY)
    // ═══════════════════════════════════════════════

    async _startReadlineMode() {
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('           NodeBench CLI (readline 模式)');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('');

        // 初始化主控制器
        try {
            this.controller = new MainController(this.config, this.logger);
        } catch (err) {
            console.error('❌ 初始化失败:', err.message);
            throw err;
        }

        this.commands = new CliCommands(this.controller, this.logger, null);

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'nb> '
        });

        this.rl.prompt();

        this.rl.on('line', async (line) => {
            const cmd = line.trim();
            if (!cmd) {
                this.rl.prompt();
                return;
            }

            if (cmd === 'exit' || cmd === 'quit') {
                await this.commands.cmdExit();
                this.rl.close();
                return;
            }

            try {
                await this.commands.execute(cmd);
            } catch (err) {
                console.error('✗ 命令执行失败:', err.message);
            }

            this.rl.prompt();
        });

        this.rl.on('close', () => {
            console.log('\n👋 NodeBench CLI 已退出');
            process.exit(0);
        });
    }

    // ═══════════════════════════════════════════════
    // Console 重定向
    // ═══════════════════════════════════════════════

    _redirectConsole() {
        this._origConsoleLog = console.log;
        this._origConsoleError = console.error;
        this._origConsoleWarn = console.warn;

        console.log = (...args) => {
            const msg = this._formatArgs(args);
            if (this.logBox) {
                this.logBox.log(msg);
                if (this.screen) this.screen.render();
            } else {
                this._origConsoleLog.apply(console, args);
            }
        };

        console.error = (...args) => {
            const msg = this._formatArgs(args);
            if (this.logBox) {
                this.logBox.log(`{red-fg}${msg}{/red-fg}`);
                if (this.screen) this.screen.render();
            } else {
                this._origConsoleError.apply(console, args);
            }
        };

        console.warn = (...args) => {
            const msg = this._formatArgs(args);
            if (this.logBox) {
                this.logBox.log(`{yellow-fg}${msg}{/yellow-fg}`);
                if (this.screen) this.screen.render();
            } else {
                this._origConsoleWarn.apply(console, args);
            }
        };
    }

    _formatArgs(args) {
        return args.map(a => {
            if (a instanceof Error) return a.stack || a.message;
            if (typeof a === 'object') {
                try {
                    return JSON.stringify(a);
                } catch {
                    return String(a);
                }
            }
            return String(a);
        }).join(' ');
    }

    _restoreConsole() {
        if (this._origConsoleLog) console.log = this._origConsoleLog;
        if (this._origConsoleError) console.error = this._origConsoleError;
        if (this._origConsoleWarn) console.warn = this._origConsoleWarn;
    }

    // ═══════════════════════════════════════════════
    // 状态轮询
    // ═══════════════════════════════════════════════

    _showBanner() {
        this.logBox.log('');
        this.logBox.log(' {bold}╔══════════════════════════════════════════════════════════════╗{/bold}');
        this.logBox.log(' {bold}║           NodeBench CLI 命令交互工具                        ║{/bold}');
        this.logBox.log(' {bold}║           输入 {green-fg}help{/green-fg} 查看可用命令                              ║{/bold}');
        this.logBox.log(' {bold}╚══════════════════════════════════════════════════════════════╝{/bold}');
        this.logBox.log('');
    }

    _startStatusPoll() {
        this._updateStatus();
        this.statusTimer = setInterval(() => {
            this._updateStatus();
        }, 3000);
    }

    _stopStatusPoll() {
        if (this.statusTimer) {
            clearInterval(this.statusTimer);
            this.statusTimer = null;
        }
    }

    /**
     * 渲染迷你进度条（blessed 文本模式）
     * @param {number} percent 0-100
     * @param {number} width 进度条宽度（字符数）
     * @returns {string}
     */
    _renderProgressBar(percent, width = 8) {
        const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        const filled = Math.round((p / 100) * width);
        const empty = width - filled;
        return '{green-fg}' + '='.repeat(filled) + '{/green-fg}' + '{gray-fg}' + '-'.repeat(empty) + '{/gray-fg}';
    }

    async _updateStatus() {
        try {
            const parts = [];

            try {
                const s = await this.controller.handleServerModuleCommand('status');
                parts.push(`🖥️ ${s && s.isRunning ? '{green-fg}运行{/green-fg}' : '{red-fg}停止{/red-fg}'}`);
            } catch (e) {
                parts.push('🖥️ 未知');
            }

            try {
                const t = await this.controller.handleTestModuleCommand('status');
                parts.push(`⚡ ${t && t.isRunning ? '{yellow-fg}运行{/yellow-fg}' : '{gray-fg}空闲{/gray-fg}'}`);
            } catch (e) {
                parts.push('⚡ 未知');
            }

            if (this.controller.autoTestRunning) {
                parts.push(`🤖 {yellow-fg}自动测试中{/yellow-fg}`);
                try {
                    const progress = await this.controller.getAutoTestProgress();
                    if (progress) {
                        const bar = this._renderProgressBar(progress.overallProgress, 6);
                        const targetInfo = progress.currentTarget ? ` 🎯 ${progress.currentTarget.toUpperCase()}` : '';
                        parts.push(`📊 ${bar} ${progress.overallProgress}%${targetInfo}`);
                    }
                } catch (e) {
                    // 忽略进度获取错误
                }
            }

            if (this.statusBox) {
                this.statusBox.setContent(' ' + parts.join('  |  '));
                if (this.screen) this.screen.render();
            }
        } catch (e) {
            // 忽略状态更新错误
        }
    }

    // ═══════════════════════════════════════════════
    // 生命周期
    // ═══════════════════════════════════════════════

    destroy() {
        this._stopStatusPoll();
        this._restoreConsole();
        if (this.screen) {
            this.screen.destroy();
        }
        if (this.rl) {
            this.rl.close();
        }
    }
}

module.exports = CliApp;
