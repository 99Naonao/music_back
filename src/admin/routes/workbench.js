const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminWorkbenchService = require('../../services/admin-workbench-service');
const { adminAuthMiddleware, requireRole } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, convertDbError } = ctx;
const db = getDb();

const canRead = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly', 'partner')];

router.get('/workbench', ...canRead, (req, res) => {
    try {
        const result = adminWorkbenchService.getWorkbench(db, req.adminUser);
        if (!result.ok) {
            return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
        }
        return sendSuccess(res, result.data, '操作成功');
    } catch (err) {
        logError('Admin 工作台', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
