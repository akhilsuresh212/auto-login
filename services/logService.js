const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function getTimestamp() {
    return new Date().toISOString();
}

function logStatus(message) {

    console.log(message)

    const line = `[${getTimestamp()}] ${message}\n`;
    const filePath = path.join(logsDir, 'login-status.log');
    fs.appendFileSync(filePath, line, { encoding: 'utf8' });
}

function logError(message, error) {
    let line = `[${getTimestamp()}] ${message}`;

    if (error) {
        const extra = error.stack || error.message || String(error);
        line += ` | ${extra}`;
    }

    line += '\n';

    const filePath = path.join(logsDir, 'login-error.log');
    fs.appendFileSync(filePath, line, { encoding: 'utf8' });
}

module.exports = { logStatus, logError };
