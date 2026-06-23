const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminFeedbackService = require('../../services/admin-feedback-service');
const { adminAuthMiddleware, requireRole } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, convertDbError } = ctx;
const db = getDb();

const canRead = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly')];

function handleResult(res, result) {
    if (!result.ok) {
        return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
    }
    return sendSuccess(res, result.data, '操作成功');
}

router.get('/feedback', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminFeedbackService.listFeedback(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 反馈列表', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

const canWrite = [adminAuthMiddleware, requireRole('super', 'operator')];

router.patch('/feedback/:id', ...canWrite, (req, res) => {
    try {
        const result = adminFeedbackService.updateFeedback(
            db,
            req.adminUser,
            req.params.id,
            req.body || {}
        );
        if (!result.ok) {
            return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
        }
        return sendSuccess(res, result.data, result.message || '操作成功');
    } catch (err) {
        logError('Admin 更新反馈', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
