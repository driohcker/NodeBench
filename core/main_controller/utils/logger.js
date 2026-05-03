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

    getLogFilePath() {
        const date = new Date().toISOString().split('T')[0];
        return path.join(this.logDir, `log_${date}.log`);
    }

    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
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
