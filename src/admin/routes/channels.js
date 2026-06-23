const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminChannelsService = require('../../services/admin-channels-service');
const { adminAuthMiddleware, requireRole, getClientIp } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, convertDbError } = ctx;
const db = getDb();

const canRead = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly', 'partner')];
const canWrite = [adminAuthMiddleware, requireRole('super', 'operator')];

function handleResult(res, result, okMessage) {
    if (!result.ok) {
        return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
    }
    if (result.data !== undefined) {
        return sendSuccess(res, result.data, okMessage || result.message || '操作成功');
    }
    return sendSuccess(res, { version: result.version }, result.message || okMessage || '操作成功');
}

router.get('/channels', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminChannelsService.listChannels(db, req.adminUser));
    } catch (err) {
        logError('Admin 渠道列表', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/channels', ...canWrite, (req, res) => {
    try {
        const result = adminChannelsService.createChannel(db, req.body || {}, req.adminUser, {
            ip: getClientIp(req)
        });
        if (!result.ok) return handleResult(res, result);
        return sendSuccess(res, result.data, '渠道已创建');
    } catch (err) {
        logError('Admin 创建渠道', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/channels/:id/hub', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminChannelsService.getChannelHub(db, req.params.id, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 渠道整合页', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/channels/:id/branding/copy', ...canWrite, (req, res) => {
    try {
        const result = adminChannelsService.copyBrandingFrom(
            db,
            req.params.id,
            req.body || {},
            req.adminUser,
            { ip: getClientIp(req) }
        );
        if (!result.ok) return handleResult(res, result);
        return sendSuccess(res, result.data, 'Branding 已复制');
    } catch (err) {
        logError('Admin 复制 branding', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.patch('/channels/batch-status', ...canWrite, (req, res) => {
    try {
        return handleResult(res, adminChannelsService.batchPatchStatus(db, req.body || {}, req.adminUser, {
            ip: getClientIp(req)
        }));
    } catch (err) {
        logError('Admin 批量渠道状态', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/channels/:id', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminChannelsService.getChannelDetail(db, req.params.id, req.adminUser));
    } catch (err) {
        logError('Admin 渠道详情', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.put('/channels/:id', ...canWrite, (req, res) => {
    try {
        const result = adminChannelsService.updateChannel(
            db,
            req.params.id,
            req.body || {},
            req.adminUser,
            { ip: getClientIp(req) }
        );
        if (!result.ok) return handleResult(res, result);
        return sendSuccess(res, result.data, '渠道已更新');
    } catch (err) {
        logError('Admin 更新渠道', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.patch('/channels/:id/status', ...canWrite, (req, res) => {
    try {
        const status = req.body && req.body.status;
        const result = adminChannelsService.patchChannelStatus(
            db,
            req.params.id,
            status,
            req.adminUser,
            { ip: getClientIp(req) }
        );
        if (!result.ok) return handleResult(res, result);
        return sendSuccess(res, result.data, '状态已更新');
    } catch (err) {
        logError('Admin 渠道状态', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.put('/channels/:id/branding', ...canWrite, (req, res) => {
    try {
        const result = adminChannelsService.updateBranding(
            db,
            req.params.id,
            req.body || {},
            req.adminUser,
            { ip: getClientIp(req) }
        );
        return handleResult(res, result, 'Branding 已保存');
    } catch (err) {
        logError('Admin 更新 branding', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/channels/:id/audit-log', ...canRead, (req, res) => {
    try {
        const limit = req.query && req.query.limit;
        return handleResult(
            res,
            adminChannelsService.listChannelAuditLogs(db, req.params.id, req.adminUser, limit)
        );
    } catch (err) {
        logError('Admin 渠道审计', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
