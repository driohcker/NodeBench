/**
 * Windows 控制台 UTF-8 编码修复
 * 在 Windows 上将控制台代码页切换为 UTF-8 (65001)，以支持中文正常显示
 */
if (process.platform === 'win32') {
    try {
        const { execSync } = require('child_process');
        execSync('chcp 65001', { stdio: 'ignore' });
    } catch (e) {
        // 忽略错误（如在不支持 chcp 的环境中）
    }
}
