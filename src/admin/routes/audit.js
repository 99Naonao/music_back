const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminAuditService = require('../../services/admin-audit-service');
const { adminAuthMiddleware, requireRole } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, convertDbError } = ctx;
const db = getDb();

const canRead = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly')];

router.get('/audit-logs', ...canRead, (req, res) => {
    try {
        const result = adminAuditService.listAuditLogs(db, req.adminUser, req.query);
        if (!result.ok) {
            return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
        }
        return sendSuccess(res, result.data, '操作成功');
    } catch (err) {
        logError('Admin 审计日志', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
