/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware } = require('../middleware/auth');
const libraryService = require('../services/library-service');

const { sendError, sendSuccess, ErrorCode, logError, logInfo, convertDbError } = ctx;

router.post('/play-history', authMiddleware, (req, res) => {
    const userId = req.user.id;
    try {
        const result = libraryService.recordPlayHistory(userId, req.body, req);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, '已记录');
    } catch (err) {
        logError('上报播放记录', err, { userId, musicId: req.body && req.body.musicId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.get('/play-history', authMiddleware, (req, res) => {
    const userId = req.user.id;
    try {
        const result = libraryService.getPlayHistory(userId, req.query.limit);
        sendSuccess(res, result.data);
    } catch (err) {
        logError('获取播放记录', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.delete('/play-history', authMiddleware, (req, res) => {
    const userId = req.user.id;
    try {
        libraryService.clearPlayHistory(userId);
        sendSuccess(res, null, '已清空');
    } catch (err) {
        logError('清空播放记录', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.get('/favorites/count', authMiddleware, (req, res) => {
    try {
        const result = libraryService.getFavoritesCount(req.user.id);
        sendSuccess(res, result.data);
    } catch (err) {
        logError('获取收藏数量', err, { userId: req.user.id });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/favorites', authMiddleware, (req, res) => {
    try {
        const result = libraryService.getFavorites(req.user.id, req.query.limit);
        sendSuccess(res, result.data);
    } catch (err) {
        logError('获取收藏列表', err, { userId: req.user.id });
        sendError(res, convertDbError(err), err.message);
    }
});

router.post('/favorites/:musicId', authMiddleware, (req, res) => {
    try {
        const result = libraryService.addFavorite(req.user.id, req.params.musicId);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, '已收藏');
    } catch (err) {
        logError('添加收藏', err, { userId: req.user.id, musicId: req.params.musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/favorites/:musicId', authMiddleware, (req, res) => {
    try {
        const result = libraryService.removeFavorite(req.user.id, req.params.musicId);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, '已取消收藏');
    } catch (err) {
        logError('取消收藏', err, { userId: req.user.id, musicId: req.params.musicId });
        sendError(res, convertDbError(err), err.message);
    }
});

router.get('/notifications/unread-count', authMiddleware, (req, res) => {
    const userId = req.user.id;
    try {
        const result = libraryService.getUnreadNotificationCount(userId);
        sendSuccess(res, result.data);
        logInfo('未读通知数', '查询成功', {
            userId,
            openid: req.user.wx_openid,
            count: result.data.count
        });
    } catch (err) {
        logError('获取未读通知数', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.get('/notifications', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    try {
        const result = libraryService.getNotifications(userId, page, limit);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data);
        logInfo('通知列表', '查询成功', {
            userId,
            openid: req.user.wx_openid,
            page: result.data.page,
            limit: result.data.limit,
            total: result.data.total,
            unread: result.data.unread,
            listCount: result.data.list.length
        });
    } catch (err) {
        logError('获取通知列表', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.put('/notifications/read-all', authMiddleware, (req, res) => {
    const userId = req.user.id;
    try {
        const result = libraryService.markAllNotificationsRead(userId);
        sendSuccess(res, result.data, '全部标记为已读');
        logInfo('通知', '全部已读', { userId, unreadCount: result.data.unreadCount });
    } catch (err) {
        logError('标记全部已读', err, { userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

router.put('/notifications/:id/read', authMiddleware, (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;
    try {
        const result = libraryService.markNotificationRead(userId, id);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, '已标记为已读');
        logInfo('通知', '单条已读', { userId, notifId: id, unreadCount: result.data.unreadCount });
    } catch (err) {
        logError('标记通知已读', err, { notifId: id, userId });
        sendError(res, ErrorCode.DB_QUERY_ERROR, err.message);
    }
});

module.exports = router;
