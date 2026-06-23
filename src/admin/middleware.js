const { ErrorCode, sendError } = require('../error-codes');
const adminAuthService = require('../services/admin-auth-service');

function parseCookies(req) {
    const raw = req.headers.cookie || '';
    const out = {};
    raw.split(';').forEach((part) => {
        const i = part.indexOf('=');
        if (i < 0) return;
        const key = part.slice(0, i).trim();
        const val = part.slice(i + 1).trim();
        if (!key) return;
        try {
            out[key] = decodeURIComponent(val);
        } catch (e) {
            out[key] = val;
        }
    });
    return out;
}

function getClientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
    return req.ip || req.connection?.remoteAddress || '';
}

function buildSessionCookie(sessionId, maxAgeSec) {
    const isSecure =
        process.env.NODE_ENV === 'production' || process.env.ADMIN_COOKIE_SECURE === '1';
    const parts = [
        `${adminAuthService.SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
        'Path=/',
        'HttpOnly',
        `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
        'SameSite=Strict'
    ];
    if (isSecure) parts.push('Secure');
    return parts.join('; ');
}

function clearSessionCookie() {
    const isSecure =
        process.env.NODE_ENV === 'production' || process.env.ADMIN_COOKIE_SECURE === '1';
    const parts = [
        `${adminAuthService.SESSION_COOKIE}=`,
        'Path=/',
        'HttpOnly',
        'Max-Age=0',
        'SameSite=Strict'
    ];
    if (isSecure) parts.push('Secure');
    return parts.join('; ');
}

function readSessionId(req) {
    const cookies = parseCookies(req);
    return cookies[adminAuthService.SESSION_COOKIE] || '';
}

function adminAuthMiddleware(req, res, next) {
    const sessionId = readSessionId(req);
    const found = adminAuthService.findValidSession(sessionId);
    if (!found || !found.adminUser) {
        return sendError(res, ErrorCode.UNAUTHORIZED, '请先登录运营后台');
    }
    req.adminSessionId = found.sessionId;
    req.adminUser = found.adminUser;
    return next();
}

function requireRole(...roles) {
    const allowed = new Set(roles);
    return (req, res, next) => {
        const user = req.adminUser;
        if (!user || !allowed.has(user.role)) {
            return sendError(res, ErrorCode.FORBIDDEN, '当前账号无权执行此操作');
        }
        return next();
    };
}

module.exports = {
    parseCookies,
    getClientIp,
    buildSessionCookie,
    clearSessionCookie,
    readSessionId,
    adminAuthMiddleware,
    requireRole
};
