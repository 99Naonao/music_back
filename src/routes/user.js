/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware } = require('../middleware/auth');
const userService = require('../services/user-service');

const {
    sendError,
    sendSuccess,
    ErrorCode,
    logError,
    convertDbError,
    contentSecurity,
    blockIfContentUnsafe,
    blockIfHostedImageUnsafe
} = ctx;

router.post('/login', async (req, res) => {
    try {
        const result = await userService.login(req, req.body);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('用户登录', err, { wxCode: req.body && req.body.wxCode });
        sendError(res, ErrorCode.LOGIN_FAILED, err.message);
    }
});

router.get('/follow/stats', authMiddleware, (req, res) => {
    try {
        const result = userService.getFollowStats(req.user.id);
        sendSuccess(res, result.data);
    } catch (err) {
        logError('关注统计', err, { userId: req.user.id });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.get('/follow/list', authMiddleware, (req, res) => {
    try {
        const result = userService.getFollowList(req.user.id, req.query);
        sendSuccess(res, result.data);
    } catch (err) {
        logError('关注列表', err, { userId: req.user.id, type: req.query.type });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.get('/profile', authMiddleware, (req, res) => {
    try {
        const result = userService.getProfile(req.user.wx_openid);
        if (!result.ok) {
            return sendError(res, result.error);
        }
        sendSuccess(res, result.data);
    } catch (err) {
        logError('获取用户资料', err);
        sendError(res, convertDbError(err), err.message);
    }
});

router.put('/profile', authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const openid = req.user.wx_openid;

    try {
        if (req.body && req.body.nickname !== undefined) {
            const nick = String(req.body.nickname).trim();
            if (
                await blockIfContentUnsafe(res, openid, [
                    { content: nick, scene: contentSecurity.SCENE.PROFILE, field: 'nickname' }
                ])
            ) {
                return;
            }
        }

        const result = userService.prepareProfileUpdate(openid, req.body);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        if (
            result.avatarForCheck &&
            (await blockIfHostedImageUnsafe(res, result.avatarForCheck, req, 'avatarUrl'))
        ) {
            return;
        }

        userService.commitProfileUpdate(openid, result.updates);
        sendSuccess(res, null, result.message);
    } catch (err) {
        logError('更新用户资料', err, { userId, body: req.body });
        sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/account', authMiddleware, (req, res) => {
    const uid = req.user.id;
    try {
        const result = userService.deleteAccount(uid);
        sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('注销用户', err, { uid });
        sendError(res, ErrorCode.ACCOUNT_DELETE_FAILED, err.message);
    }
});

router.get('/:openid/follow-status', authMiddleware, (req, res) => {
    try {
        const result = userService.getFollowStatus(req.user.id, req.params.openid);
        if (!result.ok) {
            return sendError(res, result.error);
        }
        sendSuccess(res, result.data);
    } catch (err) {
        logError('关注状态', err, { openid: req.params.openid });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.post('/follow', authMiddleware, (req, res) => {
    const { openid } = req.body || {};
    try {
        const result = userService.followUser(req.user, openid);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('关注用户', err, { follower: req.user.id, openid });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.delete('/follow/:openid', authMiddleware, (req, res) => {
    try {
        const result = userService.unfollowUser(req.user.id, req.params.openid);
        if (!result.ok) {
            return sendError(res, result.error);
        }
        sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('取消关注', err, { follower: req.user.id, openid: req.params.openid });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

module.exports = router;
