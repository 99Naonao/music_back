const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminContentService = require('../../services/admin-content-service');
const adminCardService = require('../../services/admin-card-service');
const { adminAuthMiddleware, requireRole } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, convertDbError } = ctx;
const db = getDb();

const canRead = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly')];
const canWrite = [adminAuthMiddleware, requireRole('super', 'operator')];

function handleResult(res, result, okMsg) {
    if (!result.ok) {
        return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
    }
    if (result.data !== undefined) {
        return sendSuccess(res, result.data, okMsg || result.message || '操作成功');
    }
    return sendSuccess(res, null, result.message || okMsg || '操作成功');
}

router.get('/content/library', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminContentService.listSystemTracks(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 曲库列表', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.patch('/content/library/:id', ...canWrite, (req, res) => {
    try {
        return handleResult(
            res,
            adminContentService.patchSystemTrack(db, req.adminUser, req.params.id, req.body || {})
        );
    } catch (err) {
        logError('Admin 曲库更新', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/content/banners', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminContentService.listBanners(db, req.adminUser));
    } catch (err) {
        logError('Admin Banner 列表', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/content/banners', ...canWrite, (req, res) => {
    try {
        return handleResult(res, adminContentService.upsertBanner(db, req.adminUser, null, req.body || {}));
    } catch (err) {
        logError('Admin Banner 创建', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.put('/content/banners/:id', ...canWrite, (req, res) => {
    try {
        return handleResult(
            res,
            adminContentService.upsertBanner(db, req.adminUser, req.params.id, req.body || {})
        );
    } catch (err) {
        logError('Admin Banner 更新', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/content/banners/:id', ...canWrite, (req, res) => {
    try {
        return handleResult(res, adminContentService.deleteBanner(db, req.adminUser, req.params.id));
    } catch (err) {
        logError('Admin Banner 删除', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/content/card-templates', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminCardService.listTemplatesAdmin(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 贺卡模板', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.patch('/content/card-templates/:id', ...canWrite, (req, res) => {
    try {
        return handleResult(
            res,
            adminCardService.patchTemplate(db, req.adminUser, req.params.id, req.body || {})
        );
    } catch (err) {
        logError('Admin 贺卡模板更新', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.patch('/content/card-categories/:id', ...canWrite, (req, res) => {
    try {
        return handleResult(
            res,
            adminCardService.patchCategory(db, req.adminUser, req.params.id, req.body || {})
        );
    } catch (err) {
        logError('Admin 贺卡分类更新', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/content/card-templates/sync-info', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminCardService.getSyncInfo(db, req.adminUser));
    } catch (err) {
        logError('Admin 贺卡同步信息', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/content/card-templates/sync', ...canWrite, (req, res) => {
    try {
        return handleResult(res, adminCardService.runSyncFromManifest(db, req.adminUser));
    } catch (err) {
        logError('Admin 贺卡同步', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
