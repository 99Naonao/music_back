/**
 * 全站 HTTP 请求日志（在 express.json 之后挂载）
 * - /api/* 必记：方法、路径、HTTP 状态、耗时、业务 code（从 res.json body 提取）
 * - 静态资源 /uploads、/images 默认跳过（设 REQUEST_LOG_STATIC=1 可开启）
 */
const SKIP_PREFIXES = ['/uploads', '/images'];

function shouldSkipStatic(req) {
    if (process.env.REQUEST_LOG_STATIC === '1') return false;
    const p = req.path || '';
    return SKIP_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`));
}

function getClientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) {
        const first = String(xf).split(',')[0].trim();
        if (first) return first;
    }
    return req.ip || req.socket?.remoteAddress || '';
}

function briefAuth(req) {
    const auth = req.headers.authorization;
    if (!auth || !String(auth).startsWith('Bearer ')) return '';
    const token = String(auth).slice(7).trim();
    if (!token) return '';
    if (token.length <= 12) return `${token.slice(0, 4)}…`;
    return `${token.slice(0, 8)}…`;
}

function safeQuery(req) {
    const q = req.query;
    if (!q || typeof q !== 'object' || !Object.keys(q).length) return '';
    try {
        const s = JSON.stringify(q);
        return s.length > 200 ? `${s.slice(0, 200)}…` : s;
    } catch (e) {
        return '';
    }
}

/**
 * @param {{ logInfo: Function, logWarn: Function, logError: Function }} loggers
 */
function createRequestLogger(loggers) {
    const { logInfo, logWarn, logError } = loggers;

    return function requestLogger(req, res, next) {
        if (shouldSkipStatic(req)) {
            return next();
        }

        const start = Date.now();
        const path = req.path || String(req.url || '').split('?')[0];
        const isApi = path.startsWith('/api/');

        const origJson = res.json.bind(res);
        res.json = function jsonWithBizCapture(body) {
            if (body && typeof body === 'object' && body.code !== undefined) {
                res.locals.bizCode = body.code;
                if (body.message != null) {
                    res.locals.bizMessage = String(body.message).slice(0, 120);
                }
            }
            return origJson(body);
        };

        res.on('finish', () => {
            const ms = Date.now() - start;
            const status = res.statusCode;
            const bizCode =
                res.locals.bizCode !== undefined ? res.locals.bizCode : null;
            const bizMessage = res.locals.bizMessage || '';

            const entry = {
                method: req.method,
                path,
                status,
                ms,
                ip: getClientIp(req)
            };

            if (isApi) {
                entry.auth = briefAuth(req) || undefined;
                if (bizCode !== null) entry.bizCode = bizCode;
                if (bizMessage) entry.bizMessage = bizMessage;
                const q = safeQuery(req);
                if (q) entry.query = q;
            }

            const bizFail = bizCode !== null && bizCode !== 0;
            const httpFail = status >= 500;
            const httpWarn = status >= 400 && status < 500;

            if (httpFail) {
                logError('HTTP', `${req.method} ${path} ${status} ${ms}ms`, entry);
            } else if (httpWarn || bizFail) {
                logWarn('HTTP', `${req.method} ${path} ${status} ${ms}ms`, entry);
            } else if (isApi || process.env.REQUEST_LOG_ALL === '1') {
                logInfo('HTTP', `${req.method} ${path} ${status} ${ms}ms`, entry);
            }
        });

        next();
    };
}

module.exports = { createRequestLogger };
