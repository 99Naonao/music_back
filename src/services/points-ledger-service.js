const { v4: uuidv4 } = require('uuid');
const pointsRepo = require('../repositories/points');
const { ErrorCode } = require('../error-codes');

function getOrInitPoints(userId) {
    const row = pointsRepo.getUserPointsRow(userId);
    if (!row) {
        return pointsRepo.initUserPoints(userId);
    }
    return row;
}

function recordPointsLedger(userId, signedPoints, type, description) {
    pointsRepo.insertPointsHistory(uuidv4(), userId, signedPoints, type, description);
}

function getPointsByOpenid(openid) {
    const userId = pointsRepo.findUserIdByOpenid(openid);
    if (!userId) {
        return { ok: false, error: ErrorCode.USER_NOT_FOUND };
    }
    const pointsData = getOrInitPoints(userId);
    return {
        ok: true,
        data: { points: pointsData.points, totalPoints: pointsData.total_points }
    };
}

function addPoints(openid, points, type, description) {
    if (!points || isNaN(Number(points)) || Number(points) <= 0) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '积分数量必须是大于0的数字' };
    }
    if (!type) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '积分类型不能为空' };
    }
    const userId = pointsRepo.findUserIdByOpenid(openid);
    if (!userId) {
        return { ok: false, error: ErrorCode.USER_NOT_FOUND };
    }
    const pointsNum = Number(points);
    getOrInitPoints(userId);
    pointsRepo.addPointsBalance(userId, pointsNum);
    pointsRepo.insertPointsHistory(uuidv4(), userId, pointsNum, type, description || '');
    const updated = pointsRepo.getUserPointsRow(userId);
    return {
        ok: true,
        data: { currentPoints: updated.points, addedPoints: pointsNum }
    };
}

function deductPoints(openid, points, type, description) {
    if (!points || isNaN(Number(points)) || Number(points) <= 0) {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: '积分数量必须是大于0的数字' };
    }
    if (!type) {
        return { ok: false, error: ErrorCode.MISSING_REQUIRED_PARAM, message: '积分类型不能为空' };
    }
    const userId = pointsRepo.findUserIdByOpenid(openid);
    if (!userId) {
        return { ok: false, error: ErrorCode.USER_NOT_FOUND };
    }
    const pointsNum = Number(points);
    getOrInitPoints(userId);
    const current = pointsRepo.getUserPointsRow(userId);
    if (!current || current.points < pointsNum) {
        return { ok: false, error: ErrorCode.INSUFFICIENT_POINTS };
    }
    pointsRepo.deductPointsBalance(userId, pointsNum);
    pointsRepo.insertPointsHistory(uuidv4(), userId, -pointsNum, type, description || '');
    const updated = pointsRepo.getUserPointsRow(userId);
    return {
        ok: true,
        data: { currentPoints: updated.points, deductedPoints: pointsNum }
    };
}

function getPointsHistory(openid, page, limit, kind) {
    const kindRaw = (kind != null ? String(kind) : 'all').toLowerCase();
    let kindNorm = 'all';
    if (kindRaw === 'income' || kindRaw === 'expense') {
        kindNorm = kindRaw;
    } else if (kindRaw !== 'all' && kindRaw !== '') {
        return { ok: false, error: ErrorCode.INVALID_PARAMS, message: 'kind 须为 all、income 或 expense' };
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    if (isNaN(pageNum) || pageNum < 1) {
        return { ok: false, error: ErrorCode.PAGE_PARAM_ERROR, message: 'page参数必须是大于0的数字' };
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return { ok: false, error: ErrorCode.PAGE_PARAM_ERROR, message: 'limit参数必须在1-100之间' };
    }

    const userId = pointsRepo.findUserIdByOpenid(openid);
    if (!userId) {
        return { ok: false, error: ErrorCode.USER_NOT_FOUND };
    }

    let pointsCond = '';
    if (kindNorm === 'income') pointsCond = ' AND points > 0';
    else if (kindNorm === 'expense') pointsCond = ' AND points < 0';

    const offset = (pageNum - 1) * limitNum;
    const { list, total, summary } = pointsRepo.listPointsHistory(
        userId,
        limitNum,
        offset,
        pointsCond
    );

    return {
        ok: true,
        data: {
            list,
            total,
            page: pageNum,
            limit: limitNum,
            kind: kindNorm,
            summary: {
                totalIncome: summary.totalIncome,
                totalExpense: summary.totalExpense
            }
        },
        meta: { userId, openid }
    };
}

module.exports = {
    getOrInitPoints,
    recordPointsLedger,
    getPointsByOpenid,
    addPoints,
    deductPoints,
    getPointsHistory
};
