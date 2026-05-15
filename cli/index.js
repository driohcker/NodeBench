#!/usr/bin/env node

/**
 * NodeBench CLI 命令交互入口
 *
 * 提供简洁的命令封装，将复杂的内部命令转换为简单命令：
 *   start, stop, restart, on, off, run, reset, status, config,
 *   clear logs/reports/data/all, help, exit/quit
 *
 * 使用 blessed 实现输入输出分离的终端 UI：
 *   - 上部: 系统日志输出区（可滚动）
 *   - 中部: 实时状态栏
 *   - 底部: 命令输入区
 *
 * 启动方式:
 *   node cli/index.js
 *   或添加 npm script: "cli": "node cli/index.js"
 */

require('../core/main_controller/utils/fixEncoding');

const CliApp = require('./app');

async function main() {
    const app = new CliApp();

    // 处理异常退出
    process.on('SIGINT', async () => {
        console.log('\n正在退出...');
        app.destroy();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        app.destroy();
        process.exit(0);
    });

    process.on('uncaughtException', (err) => {
        console.error('未捕获的异常:', err.message);
        app.destroy();
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        console.error('未处理的 Promise 拒绝:', reason);
    });

    try {
        await app.start();
    } catch (err) {
        console.error('CLI 启动失败:', err.message);
        app.destroy();
        process.exit(1);
    }
}

main();
