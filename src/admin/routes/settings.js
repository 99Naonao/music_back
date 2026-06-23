const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminUsersService = require('../../services/admin-users-service');
const adminSystemService = require('../../services/admin-system-service');
const { adminAuthMiddleware, requireRole, getClientIp } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, convertDbError } = ctx;
const db = getDb();

const superOnly = [adminAuthMiddleware, requireRole('super')];
const anyAuth = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly', 'partner')];

function handleResult(res, result, okMessage) {
    if (!result.ok) {
        return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
    }
    if (result.data !== undefined) {
        return sendSuccess(res, result.data, okMessage || result.message || '操作成功');
    }
    return sendSuccess(res, null, result.message || okMessage || '操作成功');
}

router.get('/settings/health', ...anyAuth, (req, res) => {
    try {
        return handleResult(res, adminSystemService.getHealth(db, req.adminUser));
    } catch (err) {
        logError('Admin 健康检查', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/settings/password', ...anyAuth, (req, res) => {
    try {
        return handleResult(
            res,
            adminUsersService.changePassword(db, req.adminUser, req.body || {}, { ip: getClientIp(req) })
        );
    } catch (err) {
        logError('Admin 改密', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/settings/admins', ...superOnly, (req, res) => {
    try {
        return handleResult(res, adminUsersService.listAdmins(db, req.adminUser));
    } catch (err) {
        logError('Admin 用户列表', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/settings/admins', ...superOnly, (req, res) => {
    try {
        return handleResult(
            res,
            adminUsersService.createAdmin(db, req.adminUser, req.body || {}, { ip: getClientIp(req) }),
            '管理员已创建'
        );
    } catch (err) {
        logError('Admin 创建用户', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.patch('/settings/admins/:id', ...superOnly, (req, res) => {
    try {
        return handleResult(
            res,
            adminUsersService.patchAdmin(db, req.adminUser, req.params.id, req.body || {}, {
                ip: getClientIp(req)
            })
        );
    } catch (err) {
        logError('Admin 更新用户', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
