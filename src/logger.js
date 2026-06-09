/**
 * 按天切割文件日志（宝塔 / pm2 友好）
 * - app-YYYY-MM-DD.log     全量
 * - error-YYYY-MM-DD.log   仅 ERROR
 * 文件名按 Asia/Shanghai 自然日切换，无需 winston
 */
const fs = require('fs');
const path = require('path');

function formatConsoleTimestampCn(d = new Date()) {
    const base = d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${base}.${ms}`;
}

function shanghaiDateKey(d = new Date()) {
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

/**
 * 业务按天日志目录。
 * - LOG_DIR 指向项目 logs 根目录时，实际写入 LOG_DIR/log（与宝塔/pm2 根目录固定日志区分）
 * - LOG_DIR 已以 /log 结尾则不再套一层
 * - LOG_FLAT=1 时直接写 LOG_DIR（兼容旧部署）
 */
function resolveLogDir() {
    const flat = process.env.LOG_FLAT === '1';
    const raw = process.env.LOG_DIR;
    let base;
    if (raw && String(raw).trim()) {
        base = path.resolve(String(raw).trim());
    } else if (process.env.DB_PATH && String(process.env.DB_PATH).trim()) {
        base = path.join(path.dirname(path.resolve(process.env.DB_PATH.trim())), 'logs');
    } else {
        base = path.join(__dirname, '../logs');
    }
    if (flat) {
        return base;
    }
    const baseName = path.basename(base).toLowerCase();
    if (baseName === 'log') {
        return base;
    }
    return path.join(base, 'log');
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function pruneOldLogs(logDir, retainDays) {
    const days = Number(retainDays);
    if (!Number.isFinite(days) || days < 1) return;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let names = [];
    try {
        names = fs.readdirSync(logDir);
    } catch (e) {
        return;
    }
    names.forEach((name) => {
        if (!/^(app|error)-\d{4}-\d{2}-\d{2}\.log$/.test(name)) return;
        const full = path.join(logDir, name);
        try {
            const st = fs.statSync(full);
            if (st.mtimeMs < cutoff) {
                fs.unlinkSync(full);
            }
        } catch (e) {
            /* ignore */
        }
    });
}

function normalizeExtra(extraInfo) {
    if (extraInfo == null) return {};
    if (extraInfo instanceof Error) {
        return {
            message: extraInfo.message,
            stack: extraInfo.stack
        };
    }
    if (typeof extraInfo !== 'object') {
        return { detail: String(extraInfo) };
    }
    const out = { ...extraInfo };
    if (out.message != null && out.stack != null) {
        return out;
    }
    return out;
}

class DailyFileLogger {
    constructor(options) {
        this.logDir = options.logDir;
        this.retainDays = options.retainDays;
        this.consoleEnabled = options.consoleEnabled !== false;
        this.fileLogEnabled = true;
        try {
            ensureDir(this.logDir);
            pruneOldLogs(this.logDir, this.retainDays);
            const probeFile = path.join(this.logDir, `app-${shanghaiDateKey()}.log`);
            fs.appendFileSync(
                probeFile,
                `${JSON.stringify({
                    time: formatConsoleTimestampCn(),
                    level: 'INFO',
                    context: 'logger',
                    message: 'logger started',
                    logDir: this.logDir
                })}\n`,
                { encoding: 'utf8' }
            );
        } catch (e) {
            this.fileLogEnabled = false;
            console.error(
                `[${formatConsoleTimestampCn()}] [ERROR] [logger] 无法写入日志目录`,
                { logDir: this.logDir, error: e.message }
            );
        }
        const bootMsg = `[${formatConsoleTimestampCn()}] [INFO] [logger] 日志目录 fileLog=${this.fileLogEnabled}`;
        console.log(bootMsg, { logDir: this.logDir, retainDays: this.retainDays });
    }

    appendLine(filePath, line) {
        if (!this.fileLogEnabled) return;
        try {
            fs.appendFileSync(filePath, line, { encoding: 'utf8' });
        } catch (e) {
            this.fileLogEnabled = false;
            console.error(
                `[${formatConsoleTimestampCn()}] [ERROR] [logger] 写日志失败`,
                { filePath, error: e.message }
            );
        }
    }

    write(level, context, message, extraInfo = {}) {
        const ts = formatConsoleTimestampCn();
        const payload = {
            time: ts,
            level,
            context: context || 'app',
            message: message != null ? String(message) : '',
            ...normalizeExtra(extraInfo)
        };
        const line = `${JSON.stringify(payload)}\n`;
        const dateKey = shanghaiDateKey();
        const appFile = path.join(this.logDir, `app-${dateKey}.log`);

        this.appendLine(appFile, line);

        if (level === 'ERROR') {
            const errFile = path.join(this.logDir, `error-${dateKey}.log`);
            this.appendLine(errFile, line);
        }

        if (!this.consoleEnabled) return;

        const tag = `[${ts}] [${level}] [${context}]`;
        const consolePayload = {
            message: payload.message,
            ...normalizeExtra(extraInfo)
        };
        if (level === 'ERROR') {
            console.error(tag, consolePayload);
        } else if (level === 'WARN') {
            console.warn(tag, consolePayload);
        } else {
            console.log(tag, consolePayload);
        }
    }

    info(context, message, extra) {
        this.write('INFO', context, message, extra);
    }

    warn(context, message, extra) {
        this.write('WARN', context, message, extra);
    }

    error(context, message, extra) {
        this.write('ERROR', context, message, extra);
    }
}

let _instance = null;

function createLoggerFromEnv() {
    const retainRaw = process.env.LOG_RETAIN_DAYS;
    const retainDays =
        retainRaw != null && String(retainRaw).trim() !== ''
            ? Number(retainRaw)
            : 30;
    const consoleEnabled = process.env.LOG_CONSOLE !== '0';
    return new DailyFileLogger({
        logDir: resolveLogDir(),
        retainDays: Number.isFinite(retainDays) ? retainDays : 30,
        consoleEnabled
    });
}

function getLogger() {
    if (!_instance) {
        _instance = createLoggerFromEnv();
    }
    return _instance;
}

module.exports = {
    getLogger,
    formatConsoleTimestampCn,
    resolveLogDir,
    shanghaiDateKey
};
