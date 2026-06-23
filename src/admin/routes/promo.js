const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminPromoService = require('../../services/admin-promo-service');
const { adminAuthMiddleware, requireRole } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, convertDbError } = ctx;
const db = getDb();

const canRead = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly')];
const canWrite = [adminAuthMiddleware, requireRole('super', 'operator')];

function handleResult(res, result) {
    if (!result.ok) {
        return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
    }
    if (result.data !== undefined) {
        return sendSuccess(res, result.data, result.message || '操作成功');
    }
    return sendSuccess(res, null, result.message || '操作成功');
}

router.get('/promo/campaigns', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminPromoService.listCampaigns(db, req.adminUser));
    } catch (err) {
        logError('Admin promo 列表', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/promo/campaigns/:id', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminPromoService.getCampaign(db, req.adminUser, req.params.id));
    } catch (err) {
        logError('Admin promo 详情', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/promo/campaigns', ...canWrite, (req, res) => {
    try {
        return handleResult(res, adminPromoService.upsertCampaign(db, req.adminUser, null, req.body || {}));
    } catch (err) {
        logError('Admin promo 创建', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.put('/promo/campaigns/:id', ...canWrite, (req, res) => {
    try {
        return handleResult(res, adminPromoService.upsertCampaign(db, req.adminUser, req.params.id, req.body || {}));
    } catch (err) {
        logError('Admin promo 更新', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.patch('/promo/campaigns/:id/status', ...canWrite, (req, res) => {
    try {
        return handleResult(res, adminPromoService.patchCampaignStatus(db, req.adminUser, req.params.id, req.body || {}));
    } catch (err) {
        logError('Admin promo 状态', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/promo/meta', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminPromoService.getMeta());
    } catch (err) {
        logError('Admin promo meta', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/promo/simulate', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminPromoService.simulatePreview(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin promo 模拟', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/promo/campaigns/:id/stats', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminPromoService.getCampaignStats(db, req.adminUser, req.params.id, req.query));
    } catch (err) {
        logError('Admin promo 统计', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
