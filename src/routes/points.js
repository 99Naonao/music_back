/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware } = require('../middleware/auth');
const pointsLedger = require('../services/points-ledger-service');

const { sendError, sendSuccess, ErrorCode, logError, logInfo, POINTS_TYPE } = ctx;

router.get('/config', (req, res) => {
    sendSuccess(res, POINTS_TYPE);
});

router.post('/add', authMiddleware, (req, res) => {
    const { points, type, description } = req.body;
    const openid = req.user.wx_openid;
    try {
        const result = pointsLedger.addPoints(openid, points, type, description);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, '积分添加成功');
    } catch (err) {
        logError('增加积分', err, { openid, points, type });
        sendError(res, ErrorCode.POINTS_ADD_FAILED, err.message);
    }
});

router.post('/deduct', authMiddleware, (req, res) => {
    const { points, type, description } = req.body;
    const openid = req.user.wx_openid;
    try {
        const result = pointsLedger.deductPoints(openid, points, type, description);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data, '积分扣除成功');
    } catch (err) {
        logError('扣除积分', err, { openid, points, type });
        sendError(res, ErrorCode.POINTS_DEDUCT_FAILED, err.message);
    }
});

router.get('/:openid/history', authMiddleware, (req, res) => {
    const { openid } = req.params;
    const { page = 1, limit = 20, kind: kindQuery } = req.query;

    if (!openid) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '用户openid不能为空');
    }
    if (openid !== req.user.wx_openid) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权查看其他用户的积分记录');
    }

    try {
        const result = pointsLedger.getPointsHistory(openid, page, limit, kindQuery);
        if (!result.ok) {
            return sendError(res, result.error, result.message);
        }
        sendSuccess(res, result.data);
        logInfo('积分明细', '查询成功', {
            openid,
            userId: result.meta.userId,
            kind: result.data.kind,
            page: result.data.page,
            limit: result.data.limit,
            total: result.data.total,
            listCount: result.data.list.length,
            totalIncome: result.data.summary.totalIncome,
            totalExpense: result.data.summary.totalExpense
        });
    } catch (err) {
        logError('获取积分记录', err, { openid, page, limit });
        sendError(res, ErrorCode.POINTS_OPERATION_FAILED, err.message);
    }
});

router.get('/:openid', authMiddleware, (req, res) => {
    const { openid } = req.params;

    if (!openid) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '用户openid不能为空');
    }
    if (openid !== req.user.wx_openid) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权查看其他用户的积分');
    }

    try {
        const result = pointsLedger.getPointsByOpenid(openid);
        if (!result.ok) {
            return sendError(res, result.error);
        }
        sendSuccess(res, result.data);
    } catch (err) {
        logError('获取用户积分', err, { openid });
        sendError(res, ErrorCode.POINTS_OPERATION_FAILED, err.message);
    }
});

module.exports = router;
