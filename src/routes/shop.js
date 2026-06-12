/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware } = require('../middleware/auth');
const shopProxy = require('../services/shop-proxy-service');
const pointsLedger = require('../services/points-ledger-service');

const {
    sendError,
    sendSuccess,
    ErrorCode,
    logError,
    contentSecurity,
    shopApi,
    requireShopToken,
    blockIfContentUnsafe,
    blockIfHostedImageUnsafe
} = ctx;

router.get('/centre', authMiddleware, async (req, res) => {
    const st = requireShopToken(req, res);
    if (!st) return;
    try {
        const result = await shopProxy.getUserCentre(req.user, st);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        return sendSuccess(res, result.data);
    } catch (err) {
        logError('商城个人中心', err, { openid: req.user && req.user.wx_openid });
        return sendError(res, ErrorCode.MALL_API_ERROR, err.message);
    }
});

router.post('/setInfo', authMiddleware, async (req, res) => {
    const st = requireShopToken(req, res);
    if (!st) return;
    const { field, value } = req.body || {};
    if (!field || String(field).trim() === '') {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'field 不能为空');
    }
    if (String(field).trim().toLowerCase() === 'avatar' && !shopApi.isPersistedAvatarUrl(value)) {
        return sendError(
            res,
            ErrorCode.INVALID_PARAMS,
            '头像须为已上传的 http(s) 地址，请勿提交微信临时路径'
        );
    }
    const fieldLower = String(field).trim().toLowerCase();
    if (fieldLower === 'avatar' && shopApi.isPersistedAvatarUrl(value)) {
        const av = shopApi.normalizeHostedUploadUrl(String(value).trim());
        if (await blockIfHostedImageUnsafe(res, av, req, 'avatar')) {
            return;
        }
    }
    if (fieldLower === 'nickname' && value != null && String(value).trim()) {
        if (
            await blockIfContentUnsafe(res, req.user.wx_openid, [
                { content: String(value).trim(), scene: contentSecurity.SCENE.PROFILE, field: 'nickname' }
            ])
        ) {
            return;
        }
    }
    try {
        const result = await shopProxy.setUserInfo(req.user, st, field, value);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        return sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('商城修改资料', err);
        return sendError(res, ErrorCode.MALL_API_ERROR, err.message);
    }
});

router.post('/thirdDeduct', authMiddleware, async (req, res) => {
    const st = requireShopToken(req, res);
    if (!st) return;
    const { deduct_user_integral, association_sn } = req.body || {};
    const n = Number(deduct_user_integral);
    if (!deduct_user_integral || Number.isNaN(n) || n <= 0) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'deduct_user_integral 须为大于 0 的数字');
    }
    const remark = (req.body && req.body.remark != null && String(req.body.remark).trim()) || '';
    try {
        const result = await shopProxy.thirdDeduct(req.user, st, n, association_sn, remark);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        if (result.ledger) {
            pointsLedger.recordPointsLedger(
                result.ledger.userId,
                result.ledger.points,
                result.ledger.type,
                result.ledger.description
            );
        }
        return sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('商城扣积分', err);
        return sendError(res, ErrorCode.MALL_API_ERROR, err.message);
    }
});

module.exports = router;
