/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');
const dailyTasks = require('../services/daily-tasks-service');

const {
    sendError,
    sendSuccess,
    ErrorCode,
    logError,
    shopApi,
    requireShopToken,
    callShopWithAutoRefresh
} = ctx;

router.get('/daily', optionalAuthMiddleware, (req, res) => {
    try {
        const userId = req.user && req.user.id ? req.user.id : null;
        const result = dailyTasks.getDailyTasks(userId);
        sendSuccess(res, result.data);
    } catch (err) {
        logError('每日任务状态', err);
        sendError(res, ErrorCode.POINTS_OPERATION_FAILED, err.message);
    }
});

router.post('/daily/claim', authMiddleware, async (req, res) => {
    const { taskKey } = req.body || {};
    const userId = req.user.id;
    const mode = (process.env.TASK_POINTS_MODE || 'shop').toLowerCase();

    if (mode === 'local') {
        try {
            const prep = dailyTasks.prepareDailyClaim(userId, taskKey);
            if (!prep.ok) {
                return sendError(res, prep.error, prep.message);
            }
            if (prep.alreadyClaimed) {
                return sendSuccess(res, prep.data, '今日该任务已完成');
            }
            const result = dailyTasks.claimDailyTaskLocal(userId, prep.taskKey, prep.claimDate, prep.points);
            return sendSuccess(res, result.data, '领取成功');
        } catch (err) {
            logError('每日任务本地积分', err);
            return sendError(res, ErrorCode.POINTS_ADD_FAILED, err.message);
        }
    }

    const st = requireShopToken(req, res);
    if (!st) return;

    try {
        const result = await dailyTasks.claimDailyTaskViaShop(
            req.user,
            st,
            taskKey,
            shopApi,
            callShopWithAutoRefresh
        );
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        return sendSuccess(res, result.data, result.message);
    } catch (err) {
        logError('每日任务商城积分', err);
        return sendError(res, ErrorCode.MALL_API_ERROR, err.message || '商城接口异常');
    }
});

module.exports = router;
