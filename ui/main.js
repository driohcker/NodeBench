require('../core/main_controller/utils/fixEncoding');
const { app, BrowserWindow } = require('electron');
const state = require('./main-process/state');
const { initializeServices } = require('./main-process/services');
const { createWindow } = require('./main-process/window');
const { setupIpcHandlers } = require('./main-process/ipc');

// ─── 应用生命周期 ───
app.whenReady().then(async () => {
    await initializeServices();
    setupIpcHandlers();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (!state.isMac) {
        app.quit();
    }
});

// 优雅退出：尝试停止正在运行的测试和服务
app.on('before-quit', async () => {
    try {
        const testCmd = await state.services.test.getCommand();
        const status = await testCmd.controller.getTestStatus();
        if (status.isRunning) {
            await testCmd.controller.stopTest();
        }
    } catch (e) {
        // 忽略退出时的错误
    }
    try {
        const monitorCmd = await state.services.monitor.getCommand();
        await monitorCmd.controller.stopMonitor();
    } catch (e) {
        // 忽略退出时的错误
    }
});
