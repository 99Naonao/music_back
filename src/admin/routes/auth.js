const express = require('express');
const router = express.Router();
const { sendError, sendSuccess, ErrorCode, logError } = require('../../error-codes');
const adminAuthService = require('../../services/admin-auth-service');
const {
    adminAuthMiddleware,
    buildSessionCookie,
    clearSessionCookie,
    getClientIp
} = require('../middleware');

router.post('/login', (req, res) => {
    try {
        const username = req.body && req.body.username;
        const password = req.body && req.body.password;
        if (!username || !password) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '请输入用户名和密码');
        }

        const result = adminAuthService.login(username, password, {
            ip: getClientIp(req),
            userAgent: req.headers['user-agent']
        });

        if (!result.ok) {
            return sendError(res, ErrorCode.UNAUTHORIZED, '用户名或密码错误');
        }

        res.setHeader('Set-Cookie', buildSessionCookie(result.sessionId, result.maxAgeSec));
        return sendSuccess(
            res,
            {
                user: result.user,
                expiresIn: result.maxAgeSec
            },
            '登录成功'
        );
    } catch (err) {
        logError('Admin 登录', err);
        return sendError(res, ErrorCode.INTERNAL_ERROR, err.message);
    }
});

router.post('/logout', adminAuthMiddleware, (req, res) => {
    try {
        adminAuthService.logout(req.adminSessionId, { ip: getClientIp(req) });
        res.setHeader('Set-Cookie', clearSessionCookie());
        return sendSuccess(res, null, '已退出登录');
    } catch (err) {
        logError('Admin 登出', err);
        return sendError(res, ErrorCode.INTERNAL_ERROR, err.message);
    }
});

router.get('/me', adminAuthMiddleware, (req, res) => {
    return sendSuccess(res, { user: req.adminUser }, '操作成功');
});

module.exports = router;
