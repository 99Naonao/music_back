const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminStatsService = require('../../services/admin-stats-service');
const { adminAuthMiddleware, requireRole } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, convertDbError } = ctx;
const db = getDb();

const canRead = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly', 'partner')];

function handleResult(res, result) {
    if (!result.ok) {
        return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
    }
    return sendSuccess(res, result.data, '操作成功');
}

router.get('/stats/overview', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminStatsService.getOverview(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 看板 overview', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/stats/timeseries', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminStatsService.getTimeseries(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 看板 timeseries', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/stats/channels-ranking', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminStatsService.getChannelsRanking(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 看板 ranking', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/stats/channel-options', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminStatsService.listChannelOptions(db, req.adminUser));
    } catch (err) {
        logError('Admin 看板 channel-options', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/stats/channel/:id', ...canRead, (req, res) => {
    try {
        return handleResult(
            res,
            adminStatsService.getChannelDetail(db, req.adminUser, req.params.id, req.query)
        );
    } catch (err) {
        logError('Admin 渠道看板', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
