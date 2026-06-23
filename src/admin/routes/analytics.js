const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminAnalyticsService = require('../../services/admin-analytics-service');
const { adminAuthMiddleware, requireRole } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, convertDbError } = ctx;
const db = getDb();

const canRead = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly', 'partner')];

function handleResult(res, result) {
    if (!result.ok) {
        return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
    }
    return sendSuccess(res, result.data, result.message || '操作成功');
}

router.get('/analytics/funnel', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminAnalyticsService.getFunnel(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 漏斗', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/analytics/retention', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminAnalyticsService.getRetention(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 留存', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
