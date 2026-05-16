#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const modulePath = process.argv[2];
if (!modulePath) {
    console.error('Usage: node run.js <module-path>');
    process.exit(1);
}

// 统一使用项目自带的 Node.js
const nodePath = process.platform === 'win32'
    ? path.join('bin', 'node', 'node.exe')
    : path.join('bin', 'node', 'node');

// Linux/macOS: 自动确保自带二进制有执行权限
if (process.platform !== 'win32') {
    const bins = [
        path.join('bin', 'node', 'node'),
        path.join('bin', 'k6', 'k6')
    ];
    for (const bin of bins) {
        try {
            if (fs.existsSync(bin)) {
                fs.chmodSync(bin, 0o755);
            }
        } catch (e) {
            // 忽略权限修改失败
        }
    }
}

const result = spawnSync(nodePath, [modulePath], {
    stdio: 'inherit',
    cwd: process.cwd()
});

process.exit(result.status != null ? result.status : 0);
