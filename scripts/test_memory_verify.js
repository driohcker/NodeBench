#!/usr/bin/env node
/**
 * Memory 测试验证脚本
 * 直接调用 MainController.runAutoTest() 运行 memory 测试
 */

const Config = require('../core/main_controller/utils/config');
const Logger = require('../core/main_controller/utils/logger');
const MainController = require('../core/main_controller/controller/main');

async function run() {
    const config = Config;
    const testConfig = config.getTestConfig();
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('           Memory 安全饱和度策略验证测试');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('测试目标:', testConfig.testTargets.join(', '));
    console.log('MaxVUs:', testConfig.maxVUs);
    console.log('Duration:', testConfig.duration);
    console.log('');
    
    const logger = new Logger(config.getMainConfig().logDir);
    const controller = new MainController(config, logger);
    
    const startTime = Date.now();
    
    try {
        const result = await controller.runAutoTest();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('');
        console.log('✅ 测试完成！耗时:', elapsed + 's');
        console.log('Session ID:', result.sessionId);
    } catch (err) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log('');
        console.error('❌ 测试失败 (耗时:', elapsed + 's):', err.message);
    } finally {
        // 确保所有子进程被清理
        setTimeout(() => process.exit(0), 3000);
    }
}

run();
