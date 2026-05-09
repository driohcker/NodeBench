/**
 * Browser API bridge - replaces Electron's ipcRenderer with HTTP fetch calls
 * Injected into index.html when running in browser mode
 */

const API_BASE = '';

async function apiCall(endpoint, body) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    return res.json();
}

window.electronAPI = {
    // Server Module
    serverStart: () => apiCall('/api/server/start'),
    serverStop: () => apiCall('/api/server/stop'),
    serverStatus: () => apiCall('/api/server/status'),
    serverConfig: () => apiCall('/api/server/config'),
    serverMethods: () => apiCall('/api/server/methods'),
    serverReadMethod: (methodName) => apiCall('/api/server/readMethod', { methodName }),
    serverSaveMethod: (methodName, content) => apiCall('/api/server/saveMethod', { methodName, content }),
    serverDeleteMethod: (methodName) => apiCall('/api/server/deleteMethod', { methodName }),

    // Test Module
    testStart: (overrides) => apiCall('/api/test/start', { overrides }),
    testStop: () => apiCall('/api/test/stop'),
    testReset: () => apiCall('/api/test/reset'),
    testStatus: () => apiCall('/api/test/status'),
    testMetrics: () => apiCall('/api/test/metrics'),

    // Auto Test
    autoStart: (options) => apiCall('/api/auto/start', options),
    autoStop: () => apiCall('/api/auto/stop'),

    // Analyzer Module
    analyzerAnalyze: (sessionId, strategy) => apiCall('/api/analyzer/analyze', { sessionId, strategy }),
    analyzerBenchmark: (sessionId) => apiCall('/api/analyzer/benchmark', { sessionId }),
    analyzerTranscode: (sessionId, format) => apiCall('/api/analyzer/transcode', { sessionId, format }),
    analyzerStrategies: () => apiCall('/api/analyzer/strategies'),

    // Monitor Module
    monitorStart: (sessionId, session2Id, source, options) => apiCall('/api/monitor/start', { sessionId, session2Id, source, options }),
    monitorStop: () => apiCall('/api/monitor/stop'),
    monitorStatus: () => apiCall('/api/monitor/status'),
    monitorMetrics: () => apiCall('/api/monitor/metrics'),
    monitorReport: () => apiCall('/api/monitor/report'),

    // Shell
    shellOpenPath: (filePath) => apiCall('/api/shell/openPath', { filePath }),

    // Reports
    reportsList: () => apiCall('/api/reports/list'),
    reportsOpen: (filePath) => apiCall('/api/shell/openPath', { filePath }),
    reportsDelete: (filePath) => apiCall('/api/reports/delete', { filePath }),
    reportsConvertToPdf: (filePath) => Promise.resolve({ success: false, error: 'Not supported in browser mode' }),
    reportsConvertToDocx: (filePath) => Promise.resolve({ success: false, error: 'Not supported in browser mode' }),

    // Config & Data
    configGet: () => apiCall('/api/config/get'),
    configSet: (changes) => apiCall('/api/config/set', changes),
    configReset: () => apiCall('/api/config/reset'),
    configStats: () => apiCall('/api/config/stats'),
    dataSessions: () => apiCall('/api/data/sessions'),
    dataReadResult: (sessionId) => apiCall('/api/data/readResult', { sessionId }),

    // Logs
    logsRead: (moduleName, tailLines, fileName) => apiCall('/api/logs/read', { moduleName, tailLines, fileName }),
    logsList: (moduleName) => apiCall('/api/logs/list', { moduleName }),
    logsDelete: (moduleName, fileName) => apiCall('/api/logs/delete', { moduleName, fileName }),

    // System
    systemStats: () => apiCall('/api/system/stats'),
    systemStopAll: () => apiCall('/api/system/stopAll'),

    // Versions (mocked)
    versions: {
        node: () => 'browser',
        chrome: () => navigator.userAgent,
        electron: () => 'browser-mode'
    }
};
