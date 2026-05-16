/**
 * BaseDetector - 突变点检测器基类
 * 纯算法实现，接收一维数据流，识别突变点。
 * 子类只需实现 feed、isChangePointDetected、reset 方法。
 */
class BaseDetector {
    constructor(config = {}) {
        this.config = config;
    }

    /**
     * 喂入一个数据点
     * @param {number} value 
     * @returns {boolean} 是否在此数据点处检测到突变点
     */
    feed(value) {
        throw new Error('子类必须实现 feed 方法');
    }

    /**
     * 当前是否检测到突变点
     */
    isChangePointDetected() {
        throw new Error('子类必须实现 isChangePointDetected 方法');
    }

    /**
     * 获取突变点信息
     */
    getChangePointInfo() {
        return null;
    }

    /**
     * 重置检测器状态
     */
    reset() {
        throw new Error('子类必须实现 reset 方法');
    }
}

module.exports = BaseDetector;
