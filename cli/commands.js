const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/**
 * CLI 命令封装层
 * 将复杂的内部命令转换为简洁的用户命令
 */
class CliCommands {
    constructor(mainController, logger, logBox) {
        this.controller = mainController;
        this.logger = logger;
        this.logBox = logBox;
    }

    log(msg) {
        if (this.logBox) {
            this.logBox.log(msg);
            if (this.logBox.screen) this.logBox.screen.render();
        } else {
            // 非 TTY 模式: 过滤 blessed 标签
            const clean = msg
                .replace(/\{[a-z0-9_-]+-fg\}/g, '')
                .replace(/\{\/[a-z0-9_-]+-fg\}/g, '')
                .replace(/\{bold\}/g, '')
                .replace(/\{\/bold\}/g, '')
                .replace(/\{[a-z0-9_]+\}/g, '');
            console.log(clean);
        }
    }

    async execute(commandLine) {
        const parts = commandLine.trim().split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (cmd) {
            case 'start': return await this.cmdStart(args);
            case 'stop': return await this.cmdStop(args);
            case 'restart': return await this.cmdRestart(args);
            case 'on': return await this.cmdOn(args);
            case 'off': return await this.cmdOff(args);
            case 'run': return await this.cmdRun(args);
            case 'reset': return await this.cmdReset(args);
            case 'status': return await this.cmdStatus(args);
            case 'config': return await this.cmdConfig(args);
            case 'clear': return await this.cmdClear(args);
            case 'report': return await this.cmdReport(args);
            case 'help': return this.cmdHelp();
            case 'exit':
            case 'quit': return await this.cmdExit();
            default:
                this.log(`❓ 未知命令: ${cmd}，输入 {yellow-fg}help{/yellow-fg} 查看可用命令`);
        }
    }

    // ───────────────────────────────────────────────
    // 系统控制命令
    // ───────────────────────────────────────────────

    async cmdStart(args) {
        const target = (args[0] || 'server').toLowerCase();
        this.log(`▶ 启动 ${target}...`);
        try {
            switch (target) {
                case 'server':
                case 's':
                case 'srv':
                    await this.controller.handleServerModuleCommand('start');
                    this.log('✅ 被测服务已启动');
                    break;
                case 'test':
                case 't':
                    await this.controller.handleTestModuleCommand('start');
                    this.log('✅ 测试模块已启动');
                    break;
                case 'monitor':
                case 'm':
                    this.log('⚠️  monitor 模块由 run 命令自动管理，无需手动启动');
                    break;
                case 'analyzer':
                case 'a':
                    this.log('⚠️  analyzer 为被动分析模块，无需手动启动');
                    break;
                default:
                    this.log(`❌ 未知模块: ${target}，可用: server, test`);
            }
        } catch (err) {
            this.log(`❌ 启动失败: ${err.message}`);
        }
    }

    async cmdStop(args) {
        const target = (args[0] || 'server').toLowerCase();
        this.log(`■ 停止 ${target}...`);
        try {
            switch (target) {
                case 'server':
                case 's':
                case 'srv':
                    await this.controller.handleServerModuleCommand('stop');
                    this.log('✅ 被测服务已停止');
                    break;
                case 'test':
                case 't':
                    await this.controller.handleTestModuleCommand('stop');
                    this.log('✅ 测试模块已停止');
                    break;
                case 'monitor':
                case 'm':
                    await this.controller.handleMonitorModuleCommand('stop');
                    this.log('✅ 监控模块已停止');
                    break;
                case 'all':
                    await this.controller.handleServerModuleCommand('stop');
                    await this.controller.handleTestModuleCommand('stop');
                    await this.controller.handleMonitorModuleCommand('stop');
                    this.log('✅ 所有模块已停止');
                    break;
                default:
                    this.log(`❌ 未知模块: ${target}，可用: server, test, monitor, all`);
            }
        } catch (err) {
            this.log(`❌ 停止失败: ${err.message}`);
        }
    }

    async cmdRestart(args) {
        this.log('⟲ 重启被测服务...');
        try {
            await this.controller.handleServerModuleCommand('stop');
            await this.controller.handleServerModuleCommand('start');
            this.log('✅ 被测服务已重启');
        } catch (err) {
            this.log(`❌ 重启失败: ${err.message}`);
        }
    }

    async cmdOn(args) {
        this.log('▶ 启动所有模块...');
        try {
            await this.controller.runAllModules();
            this.log('✅ 所有模块已启动');
        } catch (err) {
            this.log(`❌ 启动失败: ${err.message}`);
        }
    }

    async cmdOff(args) {
        this.log('■ 停止所有模块...');
        try {
            await this.controller.handleServerModuleCommand('stop');
            await this.controller.handleTestModuleCommand('stop');
            await this.controller.handleMonitorModuleCommand('stop');
            this.log('✅ 所有模块已停止');
        } catch (err) {
            this.log(`❌ 停止失败: ${err.message}`);
        }
    }

    // ───────────────────────────────────────────────
    // 测试流程命令
    // ───────────────────────────────────────────────

    async cmdRun(args) {
        const sub = args[0];
        if (sub === 'stop') {
            this.log('■ 停止自动化测试...');
            try {
                await this.controller.stopAutoTest();
                this.log('✅ 自动化测试已停止');
            } catch (err) {
                this.log(`❌ 停止失败: ${err.message}`);
            }
        } else {
            this.log('🚀 启动自动化性能标定流程...');
            this.log('   步骤: 启动服务 → 阶梯负载 → 实时监测拐点 → 生成报告');
            try {
                const result = await this.controller.runAutoTest();
                this.log(`✅ 自动化测试完成`);
                this.log(`   Session ID: {cyan-fg}${result?.sessionId}{/cyan-fg}`);
            } catch (err) {
                this.log(`❌ 自动化测试失败: ${err.message}`);
            }
        }
    }

    async cmdReset(args) {
        this.log('⟲ 发送重置信号到测试端...');
        try {
            await this.controller.handleTestModuleCommand('reset');
            this.log('✅ 重置信号已发送');
        } catch (err) {
            this.log(`❌ 重置失败: ${err.message}`);
        }
    }

    // ───────────────────────────────────────────────
    // 状态与配置
    // ───────────────────────────────────────────────

    async cmdStatus(args) {
        this.log('');
        this.log(' {bold}══════════════════════ 系统状态 ══════════════════════{/bold}');

        // 服务状态
        try {
            const s = await this.controller.handleServerModuleCommand('status');
            const running = s?.isRunning;
            this.log(` 🖥️  被测服务  ${running ? '{green-fg}● 运行中{/green-fg}' : '{red-fg}● 已停止{/red-fg}'}`);
            if (running) {
                this.log(`     模式: ${s.mode || '-'}  |  Workers: ${s.workers || '-'}  |  URL: ${s.service || '-'}`);
            }
        } catch (e) {
            this.log(` 🖥️  被测服务  {red-fg}● 查询失败{/red-fg} (${e.message})`);
        }

        // 测试状态
        try {
            const t = await this.controller.handleTestModuleCommand('status');
            const running = t?.isRunning;
            this.log(` ⚡ 测试模块  ${running ? '{yellow-fg}● 运行中{/yellow-fg}' : '{gray-fg}● 空闲{/gray-fg}'}`);
            if (running) {
                this.log(`     目标: ${t.currentTarget || '-'}  |  VUs: ${t.currentVUs || '-'}/${t.maxVUs || '-'}  |  进度: ${t.progress || '-'}`);
                this.log(`     Session: ${t.sessionId || '-'}  |  Session2: ${t.currentSession2Id || '-'}`);
            }
        } catch (e) {
            this.log(` ⚡ 测试模块  {red-fg}● 查询失败{/red-fg}`);
        }

        // 自动测试状态
        if (this.controller.autoTestRunning) {
            this.log(` 🤖 自动测试  {yellow-fg}● 运行中{/yellow-fg}  Session: ${this.controller.currentSessionId || '-'}`);
        } else {
            this.log(` 🤖 自动测试  {gray-fg}● 未运行{/gray-fg}`);
        }

        this.log(' {bold}═══════════════════════════════════════════════════════{/bold}');
        this.log('');
    }

    async cmdConfig(args) {
        try {
            const isAll = args[0] === 'all';
            await this.controller.getConfig(isAll ? 'all' : '');
        } catch (err) {
            this.log(`❌ 获取配置失败: ${err.message}`);
        }
    }

    // ───────────────────────────────────────────────
    // 清理命令
    // ───────────────────────────────────────────────

    async cmdClear(args) {
        if (args.length === 0) {
            this.log('用法: clear <logs|reports|data|all> [sessionId]');
            return;
        }

        const type = args[0].toLowerCase();
        const sid = args[1];

        switch (type) {
            case 'logs':
            case 'log':
                await this._clearLogs();
                break;
            case 'reports':
            case 'report':
                await this._clearReports();
                break;
            case 'data':
            case 'datas':
                await this._clearData(sid);
                break;
            case 'all':
                await this._clearLogs();
                await this._clearReports();
                await this._clearData();
                break;
            default:
                this.log(`❌ 未知清除类型: ${type}，可用: logs, reports, data, all`);
        }
    }

    async _clearLogs() {
        const logDirs = [
            'logs/main', 'logs/server', 'logs/test',
            'logs/monitor', 'logs/analyzer', 'logs/express_service',
            'logs/config'
        ];
        let total = 0;
        for (const dir of logDirs) {
            const d = path.join(process.cwd(), dir);
            if (fs.existsSync(d)) {
                try {
                    const files = fs.readdirSync(d);
                    for (const f of files) {
                        fs.unlinkSync(path.join(d, f));
                        total++;
                    }
                } catch (e) {
                    // 忽略单个目录错误
                }
            }
        }
        this.log(`🗑️  已清除 ${total} 个日志文件`);
    }

    async _clearReports() {
        const dir = path.join(process.cwd(), 'reports');
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir).filter(f =>
                f.endsWith('.html') || f.endsWith('.pdf') || f.endsWith('.xlsx') || f.endsWith('.docx')
            );
            for (const f of files) {
                fs.unlinkSync(path.join(dir, f));
            }
            this.log(`🗑️  已清除 ${files.length} 个报告文件`);
        } else {
            this.log('⚠️  报告目录不存在');
        }
    }

    async _clearData(sid) {
        if (sid) {
            const dir = path.join(process.cwd(), 'data/monitor', sid);
            if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                for (const f of files) {
                    fs.unlinkSync(path.join(dir, f));
                }
                fs.rmdirSync(dir);
                this.log(`🗑️  已清除 Session {cyan-fg}${sid}{/cyan-fg} 的数据 (${files.length} 个文件)`);
            } else {
                this.log(`⚠️  Session {cyan-fg}${sid}{/cyan-fg} 的数据目录不存在`);
            }
        } else {
            const dir = path.join(process.cwd(), 'data/monitor');
            if (fs.existsSync(dir)) {
                const sessions = fs.readdirSync(dir).filter(f => {
                    const p = path.join(dir, f);
                    return fs.statSync(p).isDirectory();
                });
                let total = 0;
                for (const session of sessions) {
                    const sd = path.join(dir, session);
                    const files = fs.readdirSync(sd);
                    for (const f of files) {
                        fs.unlinkSync(path.join(sd, f));
                    }
                    fs.rmdirSync(sd);
                    total += files.length;
                }
                this.log(`🗑️  已清除 ${sessions.length} 个 Session 的数据 (${total} 个文件)`);
            } else {
                this.log('⚠️  数据目录不存在');
            }
        }
    }

    // ───────────────────────────────────────────────
    // 报告查看
    // ───────────────────────────────────────────────

    async cmdReport(args) {
        const reportDir = path.join(process.cwd(), 'reports');
        if (!fs.existsSync(reportDir)) {
            this.log('⚠️  报告目录不存在');
            return;
        }

        const sub = args[0];

        // report list
        if (sub === 'list') {
            const files = fs.readdirSync(reportDir)
                .filter(f => f.startsWith('benchmark_report_') && f.endsWith('.html'))
                .sort((a, b) => {
                    const sa = fs.statSync(path.join(reportDir, a));
                    const sb = fs.statSync(path.join(reportDir, b));
                    return sb.mtime - sa.mtime;
                });

            if (files.length === 0) {
                this.log('📄 暂无标定报告');
                return;
            }

            this.log('');
            this.log(' {bold}══════════════════════ 标定报告列表 ══════════════════════{/bold}');
            files.forEach((f, i) => {
                const st = fs.statSync(path.join(reportDir, f));
                const size = (st.size / 1024).toFixed(1);
                const time = st.mtime.toLocaleString('zh-CN');
                const sid = f.replace('benchmark_report_', '').replace('.html', '');
                this.log(`  ${i + 1}. {cyan-fg}${sid}{/cyan-fg}  (${size} KB)  ${time}`);
            });
            this.log(`  共 ${files.length} 个报告`);
            this.log(' {bold}═════════════════════════════════════════════════════════{/bold}');
            this.log('');
            return;
        }

        // report <sessionId> 或 report (最新)
        let sessionId = sub;
        let reportFile;

        if (!sessionId) {
            const files = fs.readdirSync(reportDir)
                .filter(f => f.startsWith('benchmark_report_') && f.endsWith('.html'))
                .sort((a, b) => {
                    const sa = fs.statSync(path.join(reportDir, a));
                    const sb = fs.statSync(path.join(reportDir, b));
                    return sb.mtime - sa.mtime;
                });
            if (files.length === 0) {
                this.log('📄 暂无标定报告');
                return;
            }
            reportFile = path.join(reportDir, files[0]);
            sessionId = files[0].replace('benchmark_report_', '').replace('.html', '');
        } else {
            reportFile = path.join(reportDir, `benchmark_report_${sessionId}.html`);
            if (!fs.existsSync(reportFile)) {
                this.log(`❌ 报告不存在: {cyan-fg}${sessionId}{/cyan-fg}`);
                this.log('   使用 {yellow-fg}report list{/yellow-fg} 查看可用报告');
                return;
            }
        }

        // 解析报告并终端输出
        this._printReport(reportFile, sessionId);
    }

    _printReport(reportFile, sessionId) {
        const html = fs.readFileSync(reportFile, 'utf8');
        // 去除 HTML 标签，保留纯文本
        const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n');

        // 提取会话ID和生成时间
        const sessionMatch = text.match(/会话ID:\s*(\d+)/);
        const timeMatch = text.match(/生成时间:\s*([\d\/\s:]+)/);

        // 提取水桶效应结论
        const bottleneckMatch = text.match(/根据水桶效应，系统整体性能受限于\s*([^。]+)/);
        const tagMatches = [...text.matchAll(/(\w+):\s*(严重瓶颈|中等瓶颈|轻度瓶颈|正常)\s*\(占用([^,]+),\s*延迟([^)]+)\)/g)];

        // 提取拐点表格数据
        const inflectionRows = [...text.matchAll(/(\d+)\s+(cpu|memory|io|disk)\s+([\d_]+)\s+([\d]+)\s+VUs\s*\/\s*([\d.]+)ms\s+([\d]+)\s+VUs\s*\/\s*([\d.]+)ms\s+(\w+)\s+(\d+)/gi)];

        // 提取水桶效应分析表
        const bucketRows = [...text.matchAll(/(CPU|MEMORY|IO|DISK)\s+([\d.]+)%\s+(\d+)ms\s+([\d.]+)%\s+(\d+)\s*VUs\s+([\d.]+)ms\s+(\d+)\s*\/100\s+(严重瓶颈|中等瓶颈|轻度瓶颈|正常)/gi)];

        // 提取系统信息
        const hostnameMatch = text.match(/主机名\s*([A-Za-z0-9_-]+)/);
        const osMatch = text.match(/操作系统\s*([\w\s]+)\s+Node/);
        // 在机器环境区域内匹配 CPU 型号
        const envAreaMatch = text.match(/机器环境\s*(.+?)\s*📊\s*拐点检测概览/);
        const envArea = envAreaMatch ? envAreaMatch[1] : text;
        const cpuMatch = envArea.match(/CPU\s+(.+?)\s+核心数/);
        const coresMatch = text.match(/核心数\s*(\d+)/);
        const memMatch = text.match(/总内存\s*([\d.]+\s*GB)/);

        this.log('');
        this.log(' {bold}══════════════════════ 性能标定报告 ══════════════════════{/bold}');
        this.log(` 会话ID: {cyan-fg}${sessionId}{/cyan-fg}  ${timeMatch ? `| 生成时间: ${timeMatch[1].trim()}` : ''}`);
        this.log(' {bold}═════════════════════════════════════════════════════════{/bold}');
        this.log('');

        // 系统环境
        if (hostnameMatch || osMatch || cpuMatch) {
            this.log(' {bold}🖥️  机器环境{/bold}');
            if (hostnameMatch) this.log(`   主机名: ${hostnameMatch[1]}`);
            if (osMatch) this.log(`   操作系统: ${osMatch[1].trim()}`);
            if (cpuMatch) this.log(`   CPU: ${cpuMatch[1].trim()}`);
            if (coresMatch) this.log(`   核心数: ${coresMatch[1]}`);
            if (memMatch) this.log(`   总内存: ${memMatch[1]}`);
            this.log('');
        }

        // 性能瓶颈评估
        if (bottleneckMatch || tagMatches.length > 0) {
            this.log(' {bold}🎯 性能瓶颈评估{/bold}');
            if (bottleneckMatch) {
                this.log(`   水桶效应结论: 系统整体性能受限于 {red-fg}${bottleneckMatch[1].trim()}{/red-fg}`);
            }
            tagMatches.forEach(m => {
                this.log(`   ${m[1]}: {red-fg}${m[2]}{/red-fg} (占用${m[3]}, 延迟${m[4]})`);
            });
            this.log('');
        }

        // 拐点检测概览
        this.log(' {bold}📊 拐点检测概览{/bold}');
        if (inflectionRows.length > 0) {
            inflectionRows.forEach(m => {
                const target = m[2].toUpperCase();
                this.log(`   ${target}:`);
                this.log(`     最优拐点: {green-fg}${m[4]} VUs{/green-fg} / ${m[5]}ms`);
                this.log(`     最大拐点: {yellow-fg}${m[6]} VUs{/yellow-fg} / ${m[7]}ms`);
                this.log(`     算法: ${m[8]}  |  数据点: ${m[9]}`);
            });
        } else {
            // 备用提取：直接从文本中匹配 KPI 卡片
            const kpiMatches = [...text.matchAll(/(CPU|MEMORY|IO|DISK)[^\d]*(\d+)[^\d]*最优拐点[^\d]*最大:\s*(\d+)\s*VUs\s*\/\s*([\d.]+)ms/gi)];
            if (kpiMatches.length > 0) {
                kpiMatches.forEach(m => {
                    this.log(`   ${m[1]}:`);
                    this.log(`     最优拐点: {green-fg}${m[2]} VUs{/green-fg}`);
                    this.log(`     最大拐点: {yellow-fg}${m[3]} VUs{/yellow-fg} / ${m[4]}ms`);
                });
            }
        }
        this.log('');

        // 水桶效应分析
        if (bucketRows.length > 0) {
            this.log(' {bold}🪣 水桶效应分析{/bold}');
            // 找系统水位线
            const waterlineMatch = text.match(/系统水位线[^\d]*(\d+)\/100[^)]*受限于\s*(\w+)/);
            if (waterlineMatch) {
                this.log(`   系统水位线: 受限于 ${waterlineMatch[2]}，瓶颈得分 {yellow-fg}${waterlineMatch[1]}/100{/yellow-fg}`);
            }
            this.log('');
            this.log('   {bold}资源      峰值占用  峰值延迟  峰值错误  最大VUs   最大延迟   瓶颈得分  评级{/bold}');
            this.log('   ──────────────────────────────────────────────────────────────────────');
            bucketRows.forEach(m => {
                const target = m[1].padEnd(8);
                const occ = m[2].padStart(8);
                const lat = m[3].padStart(9);
                const err = m[4].padStart(8);
                const vus = m[5].padStart(7) + ' VUs';
                const mlat = m[6].padStart(9) + 'ms';
                const score = m[7].padStart(6) + '/100';
                const level = m[8];
                const levelColor = level.includes('严重') ? 'red-fg' : level.includes('中等') ? 'yellow-fg' : 'green-fg';
                this.log(`   ${target}${occ}${lat}${err}  ${vus}  ${mlat}  ${score}  {${levelColor}}${level}{/${levelColor}}`);
            });
            this.log('');
        }

        this.log(' {bold}═════════════════════════════════════════════════════════{/bold}');
        this.log('');
    }

    // ───────────────────────────────────────────────
    // 帮助与退出
    // ───────────────────────────────────────────────

    cmdHelp() {
        this.log('');
        this.log(' {bold}╔════════════════════════════════════════════════════════════════╗{/bold}');
        this.log(' {bold}║           NodeBench CLI 命令列表                               ║{/bold}');
        this.log(' {bold}╚════════════════════════════════════════════════════════════════╝{/bold}');
        this.log('');
        this.log(' {green-fg}▸ 系统控制{/green-fg}');
        this.log('    start [server|test]         启动指定模块（默认 server）');
        this.log('    stop  [server|test|monitor|all]  停止指定模块（默认 server）');
        this.log('    restart                     重启被测服务');
        this.log('    on                          启动所有模块（服务+测试）');
        this.log('    off                         停止所有模块');
        this.log('');
        this.log(' {green-fg}▸ 测试流程{/green-fg}');
        this.log('    run                         启动自动化性能标定流程');
        this.log('    run stop                    停止自动化测试');
        this.log('    reset                       发送重置信号到测试端');
        this.log('');
        this.log(' {green-fg}▸ 状态与配置{/green-fg}');
        this.log('    status                      查看各模块运行状态');
        this.log('    config [all]                查看配置（all=所有模块）');
        this.log('');
        this.log(' {green-fg}▸ 报告{/green-fg}');
        this.log('    report                      打开最新的标定报告');
        this.log('    report <sessionId>          打开指定标定报告');
        this.log('    report list                 列出所有标定报告');
        this.log('');
        this.log(' {green-fg}▸ 清理{/green-fg}');
        this.log('    clear logs                  清除所有日志文件');
        this.log('    clear reports               清除所有报告文件');
        this.log('    clear data [sessionId]      清除数据（指定ID或全部）');
        this.log('    clear all                   清除日志+报告+数据');
        this.log('');
        this.log(' {green-fg}▸ 其他{/green-fg}');
        this.log('    help                        显示此帮助');
        this.log('    exit / quit                 退出 CLI');
        this.log('');
        this.log(' {bold}═════════════════════════════════════════════════════════════════{/bold}');
        this.log('');
    }

    async cmdExit() {
        this.log('');
        this.log('👋 正在退出 NodeBench CLI...');
        try {
            await this.controller.exit();
        } catch (e) {
            process.exit(0);
        }
    }
}

module.exports = CliCommands;
