const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const PROJECT_ROOT = path.resolve(__dirname, '..');

const COMMON_DIRS = ['core', 'scripts', 'config'];
const COMMON_FILES = ['package.json'];

const WIN_BINS = ['bin/node/node.exe', 'bin/k6/k6.exe', 'bin/fio.exe'];
const LINUX_BINS = ['bin/node/node', 'bin/k6/k6'];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest, options = {}) {
    const { exclude = [] } = options;
    ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (exclude.some(pattern => {
            if (typeof pattern === 'string') return entry.name === pattern;
            if (pattern instanceof RegExp) return pattern.test(entry.name);
            return false;
        })) continue;

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath, options);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function createStartScript(platform, tempDir) {
    if (platform === 'win') {
        const bat = `@echo off
chcp 65001 >nul 2>nul
echo ===========================================
echo    NodeBench CLI - Windows
echo ===========================================
echo.
echo 可用命令:
echo   start.bat main      - 启动主控端
echo   start.bat server    - 启动被测服务
echo   start.bat test      - 启动测试端
echo   start.bat monitor   - 启动监控端
echo   start.bat analyzer  - 启动分析端
echo.
echo ===========================================

if "%~1"=="" (
    echo 正在启动主控端...
    .\\bin\\node\\node.exe core\\main_controller\\index.js
) else if "%~1"=="main" (
    .\\bin\\node\\node.exe core\\main_controller\\index.js
) else if "%~1"=="server" (
    .\\bin\\node\\node.exe core\\main_controller\\modules\\service_module\\index.js
) else if "%~1"=="test" (
    .\\bin\\node\\node.exe core\\main_controller\\modules\\test_module\\index.js
) else if "%~1"=="monitor" (
    .\\bin\\node\\node.exe core\\main_controller\\modules\\monitor_module\\index.js
) else if "%~1"=="analyzer" (
    .\\bin\\node\\node.exe core\\main_controller\\modules\\analyzer_module\\index.js
) else (
    echo 未知命令: %~1
    echo 使用方式: start.bat [main^|server^|test^|monitor^|analyzer]
)
`;
        fs.writeFileSync(path.join(tempDir, 'start.bat'), bat);
    } else {
        const sh = `#!/bin/bash

echo "==========================================="
echo "   NodeBench CLI - Linux"
echo "==========================================="
echo ""
echo "可用命令:"
echo "  ./start.sh main      - 启动主控端"
echo "  ./start.sh server    - 启动被测服务"
echo "  ./start.sh test      - 启动测试端"
echo "  ./start.sh monitor   - 启动监控端"
echo "  ./start.sh analyzer  - 启动分析端"
echo ""
echo "==========================================="

MODULE="\${1:-main}"

case "$MODULE" in
    main)
        ./bin/node/node core/main_controller/index.js
        ;;
    server)
        ./bin/node/node core/main_controller/modules/service_module/index.js
        ;;
    test)
        ./bin/node/node core/main_controller/modules/test_module/index.js
        ;;
    monitor)
        ./bin/node/node core/main_controller/modules/monitor_module/index.js
        ;;
    analyzer)
        ./bin/node/node core/main_controller/modules/analyzer_module/index.js
        ;;
    *)
        echo "未知命令: $MODULE"
        echo "使用方式: ./start.sh [main|server|test|monitor|analyzer]"
        exit 1
        ;;
esac
`;
        const shPath = path.join(tempDir, 'start.sh');
        fs.writeFileSync(shPath, sh);
        fs.chmodSync(shPath, 0o755);
    }
}

function packWindows() {
    const tempDir = path.join(DIST_DIR, 'cli-win-temp');
    cleanDir(tempDir);

    for (const dir of COMMON_DIRS) {
        copyDir(path.join(PROJECT_ROOT, dir), path.join(tempDir, dir));
    }
    for (const file of COMMON_FILES) {
        fs.copyFileSync(path.join(PROJECT_ROOT, file), path.join(tempDir, file));
    }

    for (const bin of WIN_BINS) {
        const src = path.join(PROJECT_ROOT, bin);
        if (!fs.existsSync(src)) {
            console.warn(`警告: 未找到 Windows 二进制文件 ${bin}，跳过`);
            continue;
        }
        const dest = path.join(tempDir, bin);
        ensureDir(path.dirname(dest));
        fs.copyFileSync(src, dest);
    }

    const prodNodeModules = path.join(DIST_DIR, 'win-unpacked', 'resources', 'app', 'node_modules');
    if (!fs.existsSync(prodNodeModules)) {
        throw new Error('未找到生产依赖的 node_modules，请先运行 npm run dist');
    }
    copyDir(prodNodeModules, path.join(tempDir, 'node_modules'));

    createStartScript('win', tempDir);

    fs.writeFileSync(path.join(tempDir, 'README.txt'), `NodeBench CLI - Windows 版
========================
无需安装 Node.js，直接运行 start.bat 即可启动。

使用方式:
  start.bat          启动主控端
  start.bat main     启动主控端
  start.bat server   启动被测服务
  start.bat test     启动测试端
  start.bat monitor  启动监控端
  start.bat analyzer 启动分析端
`);

    const zipPath = path.join(DIST_DIR, 'NodeBench-cli-win-x64.zip');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    execSync(
        `powershell -Command "Compress-Archive -Path '${tempDir}\\*' -DestinationPath '${zipPath}'"`,
        { stdio: 'inherit' }
    );

    console.log(`Windows CLI 包已生成: ${zipPath}`);
    cleanDir(tempDir);
}

function packLinux() {
    const tempDir = path.join(DIST_DIR, 'cli-linux-temp');
    cleanDir(tempDir);

    for (const dir of COMMON_DIRS) {
        copyDir(path.join(PROJECT_ROOT, dir), path.join(tempDir, dir));
    }
    for (const file of COMMON_FILES) {
        fs.copyFileSync(path.join(PROJECT_ROOT, file), path.join(tempDir, file));
    }

    for (const bin of LINUX_BINS) {
        const src = path.join(PROJECT_ROOT, bin);
        if (!fs.existsSync(src)) {
            console.warn(`警告: 未找到 Linux 二进制文件 ${bin}，跳过`);
            continue;
        }
        const dest = path.join(tempDir, bin);
        ensureDir(path.dirname(dest));
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o755);
    }

    const prodNodeModules = path.join(DIST_DIR, 'win-unpacked', 'resources', 'app', 'node_modules');
    if (!fs.existsSync(prodNodeModules)) {
        throw new Error('未找到生产依赖的 node_modules，请先运行 npm run dist');
    }
    copyDir(prodNodeModules, path.join(tempDir, 'node_modules'));

    createStartScript('linux', tempDir);

    fs.writeFileSync(path.join(tempDir, 'README.txt'), `NodeBench CLI - Linux 版
========================
无需安装 Node.js，直接运行 ./start.sh 即可启动。

使用方式:
  ./start.sh          启动主控端
  ./start.sh main     启动主控端
  ./start.sh server   启动被测服务
  ./start.sh test     启动测试端
  ./start.sh monitor  启动监控端
  ./start.sh analyzer 启动分析端
`);

    const tarPath = path.join(DIST_DIR, 'NodeBench-cli-linux-x64.tar.gz');
    if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);

    execSync(`tar -czf "NodeBench-cli-linux-x64.tar.gz" -C "cli-linux-temp" .`, { cwd: DIST_DIR, stdio: 'inherit' });

    console.log(`Linux CLI 包已生成: ${tarPath}`);
    cleanDir(tempDir);
}

(async () => {
    ensureDir(DIST_DIR);

    if (!fs.existsSync(path.join(DIST_DIR, 'win-unpacked', 'resources', 'app', 'node_modules'))) {
        console.error('错误: 未找到生产依赖的 node_modules。请先运行 npm run dist 生成 Electron 包。');
        process.exit(1);
    }

    console.log('正在打包 Windows CLI...');
    packWindows();

    console.log('正在打包 Linux CLI...');
    packLinux();

    console.log('\n全部完成!');
    console.log('产物位置:');
    console.log(`  ${path.join(DIST_DIR, 'NodeBench-cli-win-x64.zip')}`);
    console.log(`  ${path.join(DIST_DIR, 'NodeBench-cli-linux-x64.tar.gz')}`);
})();
