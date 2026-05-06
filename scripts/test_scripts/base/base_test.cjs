const fs = require('fs');
const path = require('path');

class BaseTest {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;

    this.testSessionId = Date.now();

    this.logDir = null;
    this.scriptDir = null;
    this.outputDir = null;

    this.metricsPath = null;
    this.summaryPath = null;
  }

  buildPath(step){
    // 确保日志目录存在
    if (!fs.existsSync(this.config.logDir)) {
        fs.mkdirSync(this.config.logDir, { recursive: true });
    }
    // 日志地址
    this.logDir = path.join(process.cwd(), this.config.logDir || 'logs/test');
    fs.mkdirSync(this.logDir, { recursive: true });
    // k6测试脚本目录地址
    this.scriptDir = path.join(process.cwd(), this.config.scriptDir, 'base');
    fs.mkdirSync(this.scriptDir, { recursive: true });
    // 测试数据输出目录
    this.outputDir = path.join(this.logDir, `test_session_${this.testSessionId}`);
    fs.mkdirSync(this.outputDir, { recursive: true });
    // 测试数据输出地址(metrics.json、summary.json)
    this.metricsPath = path.join(this.outputDir, `metrics_${step}.json`);
    this.summaryPath = path.join(this.outputDir, `summary_${step}.json`);
  }

  // 2.1. 默认测试参数
  buildK6Args(options) {
    // 测试会话ID
    this.testSessionId = options.testSessionId || Date.now();

    // 步次(单次测试默认为0)
    const step = options.step || 0;
    
    // 首先构建初始化路径
    this.buildPath(step);

    // ========开始构建k6命令行参数========

    const args = ['run'];

    // VUs
    if (options.vus) {
        args.push('--vus', options.vus.toString());
    } else {
        this.logger.warn('未指定VUs');
        return;
    }
    // 测试时间
    if (options.duration) {
        args.push('--duration', options.duration);
    }
    // 迭代次数
    if (options.iterations) {
        args.push('--iterations', options.iterations.toString());
        // TODO: 需要添加vus和iterations比较机制
    }

    // 导出日志
    args.push('--out', `json=${this.metricsPath}`);
    // 导出摘要
    args.push('--summary-export', this.summaryPath);

    // 执行k6测试脚本
    if (options.script){
        // xxx_test.js
        args.push(path.join(this.scriptDir, `${options.script}_test.js`));
    }else {
        this.logger.error('未指定测试脚本，无法执行测试');
        return;
    }

    return args;
  }

  // 2.2. 默认k6环境
  buildK6Env(options) {
    let stages;

    if (Array.isArray(options.stages)) {
      stages = options.stages; // 用户已自定义
    } else {
      this.logger.error('未指定测试阶段，无法执行测试');
      return;
    }


    const env = {
      K6_STAGES: JSON.stringify(stages), // k6 脚本里用 JSON.parse(__ENV.K6_STAGES)
    };

    this.logger.info('buildK6Env 完成，已写入 K6_STAGES');
    return env;
  }


  // 2.3. 自动构建测试阶段
  buildStages(options) {
    if (!options.startVus || !options.endVus || !options.stepCount || !options.stepDuration) {
      this.logger.error('buildStages 缺少必要参数：startVus / endVus / stepCount / stepDuration');
      return null;
    }
    const stages = [];
    const delta = Math.max(0, options.endVus - options.startVus);
    for (let i = 0; i <= options.stepCount; i++) {
      const ratio = options.stepCount === 0 ? 0 : i / options.stepCount;
      const target = Math.round(options.startVus + delta * ratio);
      stages.push({ duration: options.stepDuration, target });
    }
    this.logger.info(`自动构建 stages 完成：共 ${stages.length} 步`);
    return stages;
  }

  /**
   * 重新整理 summary.json 字段顺序：root_group → metrics → 其他
   * 在子类每步 k6 执行完后调用即可
   * @param {string} summaryPath
   */
  fixSummaryFieldOrder(summaryPath) {
    try {
      const raw = fs.readFileSync(summaryPath, 'utf-8');
      const obj = JSON.parse(raw);
      // 重建有序对象
      const ordered = {
        root_group: obj.root_group,
        metrics: obj.metrics
      };
      // 其余字段按原顺序追加
      Object.keys(obj).forEach(k => {
        if (k !== 'root_group' && k !== 'metrics') {
          ordered[k] = obj[k];
        }
      });
      fs.writeFileSync(summaryPath, JSON.stringify(ordered, null, 2));
      this.logger.info(`summary 字段顺序已固定: ${summaryPath}`);
    } catch (e) {
      this.logger.warn(`整理 summary 字段顺序失败: ${e.message}`);
    }
  }

  getPaths(){
    return {
        logDir: this.logDir,
        scriptDir: this.scriptDir,
        outputDir: this.outputDir,
        metricsPath: this.metricsPath,
        summaryPath: this.summaryPath,
    }
  }

}

module.exports = BaseTest;