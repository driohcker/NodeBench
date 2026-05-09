const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload 脚本
 * 通过 contextBridge 向渲染进程暴露安全的 API，避免直接暴露 Node.js 能力
 */
contextBridge.exposeInMainWorld('electronAPI', {
    // ─── Server Module ───
    serverStart: () => ipcRenderer.invoke('server:start'),
    serverStop: () => ipcRenderer.invoke('server:stop'),
    serverStatus: () => ipcRenderer.invoke('server:status'),
    serverConfig: () => ipcRenderer.invoke('server:config'),
    serverMethods: () => ipcRenderer.invoke('server:methods'),
    serverReadMethod: (methodName) => ipcRenderer.invoke('server:readMethod', methodName),
    serverSaveMethod: (methodName, content) => ipcRenderer.invoke('server:saveMethod', methodName, content),
    serverDeleteMethod: (methodName) => ipcRenderer.invoke('server:deleteMethod', methodName),

    // ─── Test Module ───
    testStart: (overrides) => ipcRenderer.invoke('test:start', overrides),
    testStop: () => ipcRenderer.invoke('test:stop'),
    testReset: () => ipcRenderer.invoke('test:reset'),
    testStatus: () => ipcRenderer.invoke('test:status'),
    testMetrics: () => ipcRenderer.invoke('test:metrics'),

    // ─── Auto Test Orchestration ───
    autoStart: (options) => ipcRenderer.invoke('auto:start', options),
    autoStop: () => ipcRenderer.invoke('auto:stop'),

    // ─── Analyzer Module ───
    analyzerAnalyze: (sessionId, strategy) => ipcRenderer.invoke('analyzer:analyze', sessionId, strategy),
    analyzerBenchmark: (sessionId) => ipcRenderer.invoke('analyzer:benchmark', sessionId),
    analyzerTranscode: (sessionId, format) => ipcRenderer.invoke('analyzer:transcode', sessionId, format),
    analyzerStrategies: () => ipcRenderer.invoke('analyzer:strategies'),

    // ─── Monitor Module ───
    monitorStart: (sessionId, session2Id, source, options) => ipcRenderer.invoke('monitor:start', sessionId, session2Id, source, options),
    monitorStop: () => ipcRenderer.invoke('monitor:stop'),
    monitorStatus: () => ipcRenderer.invoke('monitor:status'),
    monitorMetrics: () => ipcRenderer.invoke('monitor:metrics'),
    monitorReport: () => ipcRenderer.invoke('monitor:report'),
    shellOpenPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),

    // ─── Reports ───
    reportsList: () => ipcRenderer.invoke('reports:list'),
    reportsOpen: (filePath) => ipcRenderer.invoke('reports:open', filePath),
    reportsDelete: (filePath) => ipcRenderer.invoke('reports:delete', filePath),
    reportsConvertToPdf: (filePath) => ipcRenderer.invoke('reports:convertToPdf', filePath),
    reportsConvertToDocx: (filePath) => ipcRenderer.invoke('reports:convertToDocx', filePath),

    // ─── Config & Data ───
    configGet: () => ipcRenderer.invoke('config:get'),
    configSet: (changes) => ipcRenderer.invoke('config:set', changes),
    configReset: () => ipcRenderer.invoke('config:reset'),
    configStats: () => ipcRenderer.invoke('config:stats'),
    dataSessions: () => ipcRenderer.invoke('data:sessions'),
    dataReadResult: (sessionId) => ipcRenderer.invoke('data:readResult', sessionId),

    // ─── Logs ───
    logsRead: (moduleName, tailLines, fileName) => ipcRenderer.invoke('logs:read', moduleName, tailLines, fileName),
    logsList: (moduleName) => ipcRenderer.invoke('logs:list', moduleName),
    logsDelete: (moduleName, fileName) => ipcRenderer.invoke('logs:delete', moduleName, fileName),

    // ─── System ───
    systemStats: () => ipcRenderer.invoke('system:stats'),

    // ─── Versions ───
    versions: {
        node: () => process.versions.node,
        chrome: () => process.versions.chrome,
        electron: () => process.versions.electron,
    }
});
