# NodeBench — 单机性能标定工具

NodeBench 是一款基于 Node.js 的**单机性能标定与拐点探测平台**，能够对单台服务器进行自动化压力测试、实时性能监控、拐点识别与报告生成。项目采用模块化架构，支持命令行交互（CLI）和可视化桌面应用（Electron）两种使用方式。

---

## 一、核心能力

- **四类基准压测**：CPU（计算密集型）、内存（分配密集型）、磁盘（读写密集型）、IO（网络密集型）。
- **步进式负载测试**：基于 k6 引擎，从 1 VU 起步，按阶段逐步提升并发，精细探测性能拐点。
- **自动化拐点分析**：内置双拐点算法，自动识别**最优拐点**（性价比最高）与**最大拐点**（系统瓶颈）。
- **集群模式被测服务**：基于 Express + Node.js `cluster` 模块，自动利用多核 CPU，支持 Worker 故障恢复。
- **一键自动化标定**：主控端自动编排「启动服务 → 压测 → 监控 → 分析 → 生成报告」全流程。
- **配置热重载**：开发调试时修改配置文件无需重启进程。
- **动态脚本扩展**：测试方法、压测脚本、分析策略均支持运行时热插拔加载。

---

## 二、技术栈

| 层级 | 技术/工具 | 说明 |
|------|----------|------|
| 运行时 | Node.js (≥16) | 项目核心运行时，内置 `cluster` 支持多进程 |
| 被测服务 | Express.js | 提供 HTTP 测试接口与健康检查 |
| 压测引擎 | k6 | Grafana 开源压测工具，二进制内置于 `bin/k6` |
| 桌面 UI | Electron | 跨平台桌面应用界面（基础框架已搭建） |
| 配置管理 | `config` + 自研 ConfigManager | 支持多环境配置与热重载 |
| 日志系统 | 自研 Logger | 按日期分文件，同时输出到控制台与日志文件 |
| 进程管理 | `child_process` / `cluster` | 模块间通过子进程与集群模式协作 |
| CLI TUI | `blessed` | 命令行模式下的终端界面，分离日志区、状态栏与输入区 |

---

## 三、项目目录结构

```
NodeBench/
├── bin/                          # 二进制工具
│   ├── k6/                       # k6 压测引擎（Windows/Linux 可执行文件）
│   └── node/                     # 独立 Node.js 运行时
├── cli/                          # 命令行入口（基于 blessed 的 TUI）
├── config/                       # 多环境配置文件
│   ├── default.json              # 默认基础配置
│   ├── development.json          # 开发环境（默认环境）
│   ├── production.json
│   └── test.json
├── core/
│   └── main_controller/          # 核心主控模块
│       ├── index.js              # 主控入口
│       ├── controller/main.js    # 主控制器：统一管理 server/test/monitor/analyzer 四大子模块
│       ├── command/              # 命令行交互层（命令定义、解析、控制台）
│       ├── service/              # 子模块服务代理（启动/停止/命令转发）
│       ├── utils/                # 通用工具（ConfigManager / Logger / Banner）
│       └── modules/
│           ├── service_module/   # 被测服务管理模块
│           │   └── module/
│           │       └── express_service/   # Express 被测服务（集群/单机模式）
│           ├── test_module/      # 测试执行模块
│           │   ├── helper/       # K6Driver / MetricsAnalyzer / SummaryAnalyzer
│           │   └── service/      # K6ScriptRunner / ResultProcessor
│           ├── monitor_module/   # 监控分析模块
│           │   └── service/      # StrategyService（分析策略加载与执行）
│           └── analyzer_module/  # 报告生成模块
│               └── helper/       # BenchmarkReportGenerator / StaticDataAdapter
├── scripts/
│   ├── analyze_strategy/         # 分析策略脚本
│   │   └── InflectionPointStrategy.js   # 拐点分析策略
│   ├── server_methods/           # 被测服务测试方法脚本
│   │   ├── cpu_method.js         # CPU 负载（斐波那契计算）
│   │   ├── memory_method.js      # 内存分配测试
│   │   ├── disk_method.js        # 磁盘读写测试
│   │   └── io_method.js          # IO 操作测试
│   └── test_scripts/             # k6 压测脚本
│       ├── base/
│       │   ├── base_test.cjs     # 测试基类
│       │   └── cpu_test.js
│       └── stepped_load_test.js  # 步进式负载测试（核心脚本）
├── ui/                           # Electron 桌面应用
│   ├── main.js                   # Electron 主进程入口
│   ├── main-process/             # IPC 处理、窗口管理、服务初始化
│   ├── view/                     # HTML 页面
│   ├── js/                       # Preload / Renderer 脚本
│   └── css/
├── data/                         # 测试数据与结果存储
├── logs/                         # 日志目录（按模块分子目录）
├── reports/                      # 分析报告输出目录（HTML）
└── docs/                         # 项目文档
```

---

## 四、核心架构

### 4.1 模块架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         主控模块 (Main Controller)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │   Service    │  │    Test      │  │   Monitor    │  │  Analyzer │ │
│  │   Module     │  │   Module     │  │   Module     │  │  Module   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
└─────────┼─────────────────┼─────────────────┼────────────────┼───────┘
          │                 │                 │                │
          ▼                 ▼                 ▼                ▼
   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐  ┌─────────────┐
   │ Express 被测 │   │ k6 压测引擎 │   │ 拐点分析策略 │  │ HTML 标定   │
   │ 服务(集群)   │   │ 步进式负载  │   │ 性能报告生成 │  │ 报告生成    │
   └─────────────┘   └─────────────┘   └─────────────┘  └─────────────┘
```

### 4.2 各模块职责

| 模块 | 职责 | 关键组件 |
|------|------|----------|
| **主控模块** | 统一入口，提供交互式命令行控制台（`main>` 提示符），调度四大子模块生命周期 | `MainController`, `CommandConsole` |
| **Service Module** | 启动/停止 Express 被测服务，支持 Cluster/Single 模式，管理 Worker 进程 | `ExpressService`, `MethodService` |
| **Test Module** | 封装 k6 子进程，执行步进式压测，收集 metrics/summary 数据 | `K6Driver`, `K6ScriptRunnerService`, `MetricsAnalyzer` |
| **Monitor Module** | 实时收集/分析测试数据，执行拐点分析策略 | `MonitorService`, `StrategyService` |
| **Analyzer Module** | 基于历史数据生成结构化的 HTML 标定报告 | `AnalyzerService`, `BenchmarkReportGenerator` |

---

## 五、标准工作流程

### 5.1 手动分步流程

```
1. 启动主控模块      →  npm run main
   └─ 显示 Banner，进入命令行交互

2. 启动被测服务      →  main> server start
   └─ Express 集群服务启动（默认 16 个 Worker，端口 10000）

3. 执行压力测试      →  main> test start
   └─ 加载 stepped_load_test.js，构建步进式 Stages
   └─ 从 1 VU 逐步提升至 maxVUs，共 N 步
   └─ 每步调用 k6 执行，输出 metrics_*.json / summary_*.json

4. 分析测试结果      →  main> result <sessionId>
   └─ MetricsAnalyzer 合并指标，按阶段计算平均延迟、P95、RPS

5. 执行拐点分析      →  monitor> analyze <sessionId>
   └─ 计算最优拐点与最大拐点，输出结构化报告
```

### 5.2 一键自动化流程

```bash
main> runall          # 一键执行：启动服务 + 压测
main> auto            # 一键自动化标定（完整流程：服务→压测→监控→分析→报告）
```

自动化流程由 `MainController.runAutoTest()` 编排：
1. **启动被测服务**并等待就绪
2. **初始化测试流程**：生成全局 `sessionId` 与各目标的 `session2Id`
3. **逐个目标执行子流程**（支持环境隔离：非首个目标时自动重启服务）
4. **循环重试机制**：未检测到拐点时自动提升 `maxVUs` 重新压测
5. **生成标定报告**：调用 Analyzer Module 生成最终 HTML 报告

---

## 六、快速开始

### 6.1 环境要求

- Node.js ≥ 16.0.0
- Windows / Linux（k6 二进制已内置）

### 6.2 安装依赖

```bash
npm install
```

### 6.3 运行方式

```bash

# 命令行 TUI 模式（基于 blessed 的终端界面，推荐）
npm run cli

# 单独启动各模块（用于调试）
npm run main       # 主控端模块
npm run server     # 被测服务模块
npm run test       # 测试执行模块
npm run monitor    # 监控分析模块
npm run analyzer   # 报告生成模块

# 桌面应用模式（Electron）
npm run ui

# 打包
npm run dist       # 打包 Electron 桌面应用
npm run dist:cli   # 打包 CLI 可执行程序
npm run dist:all   # 全部打包
```

---

## 七、配置体系

项目采用 `config` 库 + 自研 `ConfigManager` 双层配置体系，支持热重载：

| 配置文件 | 用途 |
|---------|------|
| `default.json` | 默认基础配置 |
| `development.json` | 开发环境（当前默认环境） |
| `production.json` | 生产环境配置 |
| `test.json` | 测试环境配置 |
| `local.json` | 本地覆盖配置（`.gitignore` 忽略，不提交） |

核心配置项示例：

```json
{
  "server": {
    "serverUrl": "http://localhost:10000",
    "mode": "cluster",
    "workers": 16
  },
  "test": {
    "initVUs": 1,
    "maxVUs": 400,
    "duration": "6s",
    "iterations": 30,
    "testTargets": ["cpu", "memory", "disk", "io"]
  },
  "monitor": {
    "analysisStrategy": "InflectionPointStrategy.js"
  }
}
```

---

## 八、扩展指南

### 8.1 新增被测服务测试方法

1. 在 `scripts/server_methods/` 下新建 `<name>_method.js`
2. 导出 `execute(params)` 函数
3. 在 `route_def.js` 中注册路由（如需 HTTP 访问）

### 8.2 新增 k6 压测脚本

1. 在 `scripts/test_scripts/` 下新建测试脚本类
2. 继承 `BaseTest`，提供 `run()` 方法
3. 在配置中指定 `testScript` 为新建脚本文件名

### 8.3 新增分析策略

1. 在 `scripts/analyze_strategy/` 下新建策略类
2. 实现 `constructor(config, logger)` 和 `run(sessionId)` 方法
3. 在配置中指定 `analysisStrategy` 为新建策略文件名

---

## 九、项目特点

1. **模块化架构**：主控、服务、测试、监控、分析五大模块解耦，可独立运行也可统一调度。
2. **集群模式被测服务**：利用 Node.js `cluster` 模块充分利用多核 CPU，Worker 故障自动恢复。
3. **步进式负载测试**：精细化分阶段施压，更准确地探测性能拐点。
4. **自动化拐点分析**：内置算法自动识别最优性能点与系统瓶颈点。
5. **配置热重载**：开发调试时无需重启进程即可更新配置。
6. **动态脚本加载**：测试方法、测试脚本、分析策略均支持热插拔式扩展。
7. **完整日志追踪**：每个模块独立日志目录，按日期分文件，同时输出控制台。

---

## 十、相关文档

| 文档 | 说明 |
|------|------|
| `docs/PROJECT_OVERVIEW.md` | 详细项目概述报告（含类图、时序图、待完善事项） |
| `docs/测试流程概述.md` | 测试流程详细说明 |
| `docs/架构优化.md` / `docs/新架构.md` | 架构设计与优化方案 |

---

> **版本**：v1.0.0  
> **License**：项目内部使用
