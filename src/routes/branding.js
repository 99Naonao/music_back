/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const brandingService = require('../services/branding-service');

const {
    getDb,
    sendError,
    sendSuccess,
    ErrorCode,
    logError,
    convertDbError,
    channelService,
    getPromoCampaignsForScene
} = ctx;
const db = getDb();

router.get('/branding', (req, res) => {
    try {
        const channelRaw = req.query && (req.query.channel || req.query.channelId);
        const payload = brandingService.getBranding(db, channelService, channelRaw);
        return sendSuccess(res, payload, '操作成功');
    } catch (err) {
        logError('渠道 branding', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/channel-theme-presets', (req, res) => {
    try {
        const result = brandingService.listChannelThemePresets(channelService);
        return sendSuccess(res, result, '操作成功');
    } catch (err) {
        logError('渠道主题预设', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/user/channel-bind', authMiddleware, (req, res) => {
    try {
        const channelRaw = (req.body && (req.body.channel || req.body.channelId)) || '';
        const source = (req.body && req.body.source) || 'client';
        const result = brandingService.bindUserChannel(db, channelService, req.user.id, channelRaw, source);
        return sendSuccess(res, result, '渠道已绑定');
    } catch (err) {
        if (err && err.code === 'CHANNEL_INVALID') {
            return sendError(res, ErrorCode.INVALID_PARAMS, err.message);
        }
        logError('渠道绑定', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/promo/active', (req, res) => {
    const scene = req.query && req.query.scene ? String(req.query.scene) : '';
    const channelRaw = req.query && (req.query.channel || req.query.channelId);
    const result = brandingService.getActivePromos(getPromoCampaignsForScene, channelService, scene, channelRaw);
    return sendSuccess(res, result, '操作成功');
});

router.get('/home/banners', (req, res) => {
    try {
        const adminContentService = require('../services/admin-content-service');
        const channelRaw = req.query && (req.query.channel || req.query.channelId);
        const result = adminContentService.getActiveBannersForChannel(db, channelRaw);
        return sendSuccess(res, result, '操作成功');
    } catch (err) {
        logError('首页 Banner', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.post('/promo/event', (req, res) => {
    brandingService.recordPromoEvent(db, req.body || {});
    return sendSuccess(res, null, '操作成功');
});

/** 小程序冷启动 DAU 埋点（可选登录；需 visitorKey 或登录用户） */
router.post('/event/launch', optionalAuthMiddleware, (req, res) => {
    try {
        const result = brandingService.recordAppLaunch(db, req, req.body || {});
        if (!result.ok) {
            return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '缺少 visitorKey');
        }
        return sendSuccess(res, { channelId: result.channelId, statDate: result.statDate }, '已记录');
    } catch (err) {
        logError('启动埋点', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
