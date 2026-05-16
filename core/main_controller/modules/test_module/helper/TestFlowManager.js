const fs = require('fs');
const path = require('path');

/**
 * TestFlowManager - 测试流程管理器
 * 负责生成 sessionId、session2Id，管理测试目录结构
 */
class TestFlowManager {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.sessionId = null;
        this.session2IdMap = new Map(); // target -> session2Id
        this.currentTarget = null;
        this.currentSession2Id = null;
    }

    /**
     * 生成新的测试流程 sessionId
     */
    generateSessionId() {
        this.sessionId = Date.now().toString();
        this.session2IdMap.clear();
        this.currentTarget = null;
        this.currentSession2Id = null;
        this.logger.info(`[TestFlowManager] 生成测试流程 sessionId: ${this.sessionId}`);
        return this.sessionId;
    }

    /**
     * 为指定测试目标生成 session2Id
     */
    generateSession2Id(target) {
        const session2Id = Date.now().toString();
        this.session2IdMap.set(target, session2Id);
        this.currentTarget = target;
        this.currentSession2Id = session2Id;
        this.logger.info(`[TestFlowManager] 生成子流程 session2Id: ${session2Id}, 目标: ${target}`);
        return session2Id;
    }

    /**
     * 创建测试输出目录
     */
    createOutputDirs(sessionId, session2Id) {
        const baseDir = path.join(process.cwd(), this.config.dataOutputDir || 'data/test');
        const sessionDir = path.join(baseDir, sessionId);
        const session2Dir = path.join(sessionDir, session2Id);
        
        fs.mkdirSync(session2Dir, { recursive: true });
        
        return { sessionDir, session2Dir };
    }

    /**
     * 获取当前测试流程信息
     */
    getCurrentFlowInfo() {
        return {
            sessionId: this.sessionId,
            currentTarget: this.currentTarget,
            currentSession2Id: this.currentSession2Id,
            session2IdMap: Object.fromEntries(this.session2IdMap)
        };
    }

    reset() {
        this.sessionId = null;
        this.session2IdMap.clear();
        this.currentTarget = null;
        this.currentSession2Id = null;
    }
}

module.exports = TestFlowManager;
