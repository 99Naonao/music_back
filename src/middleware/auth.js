const { ErrorCode, sendError } = require('../error-codes');
const { getDb } = require('../bootstrap/database');

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return sendError(res, ErrorCode.UNAUTHORIZED, '缺少有效的认证凭证');
    }
    const token = authHeader.slice(7);
    const user = getDb().prepare(
        'SELECT id, wx_openid, nickname, shop_token, shop_sn FROM users WHERE wx_openid = ?'
    ).get(token);
    if (!user) {
        return sendError(res, ErrorCode.UNAUTHORIZED, '登录已过期，请重新登录');
    }
    req.user = user;
    next();
}

function optionalAuthMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const user = getDb().prepare(
            'SELECT id, wx_openid, nickname, shop_token, shop_sn FROM users WHERE wx_openid = ?'
        ).get(token);
        if (user) req.user = user;
    }
    next();
}

module.exports = { authMiddleware, optionalAuthMiddleware };
