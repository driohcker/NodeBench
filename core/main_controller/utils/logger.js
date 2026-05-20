const fs = require('fs');
const path = require('path');

class Logger {
    constructor(logDir) {
        this.logDir = logDir;
        this.ensureLogDir();
    }

    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    _formatLocalTimestamp(date = new Date()) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
               `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }

    getLogFilePath() {
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return path.join(this.logDir, `log_${date}.log`);
    }

    formatMessage(level, message, data = null) {
        const timestamp = this._formatLocalTimestamp();
        let logMessage = `[${timestamp}] [${level}] ${message}`;
        if (data) {
            logMessage += ` | Data: ${JSON.stringify(data)}`;
        }
        return logMessage;
    }

    writeLog(message) {
        const logFilePath = this.getLogFilePath();
        fs.appendFileSync(logFilePath, message + '\n', 'utf-8');
        console.log(message);
    }

    info(message, data = null) {
        const logMessage = this.formatMessage('INFO', message, data);
        this.writeLog(logMessage);
    }

    error(message, data = null) {
        const logMessage = this.formatMessage('ERROR', message, data);
        this.writeLog(logMessage);
    }

    warn(message, data = null) {
        const logMessage = this.formatMessage('WARN', message, data);
        this.writeLog(logMessage);
    }

    debug(message, data = null) {
        const logMessage = this.formatMessage('DEBUG', message, data);
        this.writeLog(logMessage);
    }
}

module.exports = Logger;
