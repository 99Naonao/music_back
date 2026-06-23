const express = require('express');
const router = express.Router();
const ctx = require('../../utils/app-context');
const adminCommunityService = require('../../services/admin-community-service');
const { adminAuthMiddleware, requireRole, getClientIp } = require('../middleware');

const { getDb, sendError, sendSuccess, ErrorCode, logError, logInfo, convertDbError } = ctx;
const db = getDb();

const canRead = [adminAuthMiddleware, requireRole('super', 'operator', 'readonly')];
const canWrite = [adminAuthMiddleware, requireRole('super', 'operator')];

function handleResult(res, result) {
    if (!result.ok) {
        return sendError(res, result.error || ErrorCode.INVALID_PARAMS, result.message);
    }
    return sendSuccess(res, result.data, result.message || '操作成功');
}

router.get('/community/posts', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminCommunityService.searchPosts(db, req.adminUser, req.query));
    } catch (err) {
        logError('Admin 社区查帖', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/community/posts/:id', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminCommunityService.getPostDetail(db, req.adminUser, req.params.id));
    } catch (err) {
        logError('Admin 社区帖子详情', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.get('/community/users/:openid/risk', ...canRead, (req, res) => {
    try {
        return handleResult(res, adminCommunityService.getUserRisk(db, req.adminUser, req.params.openid));
    } catch (err) {
        logError('Admin 社区用户风控', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/community/posts/:id', ...canWrite, (req, res) => {
    try {
        const result = adminCommunityService.deletePost(db, req.adminUser, req.params.id);
        if (result.ok) {
            logInfo('Admin 删帖', '已删除', { postId: req.params.id, admin: req.adminUser.username, ip: getClientIp(req) });
        }
        return handleResult(res, result);
    } catch (err) {
        logError('Admin 删帖', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

router.delete('/community/posts/:postId/comments/:commentId', ...canWrite, (req, res) => {
    try {
        const result = adminCommunityService.deleteComment(
            db,
            req.adminUser,
            req.params.postId,
            req.params.commentId
        );
        return handleResult(res, result);
    } catch (err) {
        logError('Admin 删评论', err);
        return sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
