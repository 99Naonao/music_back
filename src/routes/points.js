/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { authMiddleware, optionalAuthMiddleware } = require('../middleware/auth');

const {
    getDb,
    sendError,
    sendSuccess,
    successResponse,
    errorResponse,
    ErrorCode,
    logError,
    logWarn,
    logInfo,
    convertDbError,
    formatConsoleTimestampCn,
    uuidv4,
    axios,
    crypto,
    path,
    fs,
    contentSecurity,
    shopApi,
    wxMiniApps,
    channelService,
    cardTemplates,
    musicAudioStore,
    mediaSecStore,
    uploadDir,
    libraryAudioDir,
    upload,
    blockIfContentUnsafe,
    blockIfImagesUnsafe,
    blockIfHostedImageUnsafe,
    scheduleAudioMediaCheck,
    verifyWechatMsgSignature,
    getApiBaseUrl,
    buildPublicUploadUrl,
    getUploadPublicPathForFilename,
    buildPublicAudioUploadUrl,
    migrateLegacyCoverUrlToMusicCover,
    normalizePublicCoverUrl,
    sanitizePlayerCoverUrlForClient,
    sanitizeCardShareImageForClient,
    sanitizeCommunityImagesForClient,
    isOurHostedUploadUrl,
    resolveReferenceAudioProbeTarget,
    resolveHostedUploadToDisk,
    normalizeLibraryAudioUrl,
    resolveLibraryCoverRel,
    toAbsoluteCoverUrl,
    generateMusic,
    checkGenerationStatus,
    isMinimaxMockAllowed,
    generateBlessing,
    generateBlessingOffline,
    mixEffects,
    mixFinalAudio,
    probeAudioDurationSec,
    assertReferenceAudioDurationSec,
    AUDIO_DIR,
    MALL_PRODUCTS_DATA,
    getMallProductByIdFromStore,
    mallImageUrl,
    exposeQrcodeIfEnabled,
    exposeQrcodeListIfEnabled,
    getPromoCampaignsForScene,
    getMianjiaProducts,
    POINTS_TYPE,
    bedAccessToken,
    persistShopTokenFromPayload,
    requireShopToken,
    callShopWithAutoRefresh,
    recordPointsLedger,
    getOrInitPoints
} = ctx;
const db = getDb();

router.get('/:openid', authMiddleware, (req, res) => {
    const { openid } = req.params;

    if (!openid) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '用户openid不能为空');
    }
    if (openid !== req.user.wx_openid) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权查看其他用户的积分');
    }

    try {
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
        if (!user) {
            return sendError(res, ErrorCode.USER_NOT_FOUND);
        }
        const pointsData = getOrInitPoints(user.id);
        sendSuccess(res, {
            points: pointsData.points,
            totalPoints: pointsData.total_points
        });
    } catch (err) {
        logError('获取用户积分', err, { openid });
        sendError(res, ErrorCode.POINTS_OPERATION_FAILED, err.message);
    }
});

router.post('/add', authMiddleware, (req, res) => {
    const { points, type, description } = req.body;
    const openid = req.user.wx_openid;

    if (!points || isNaN(Number(points)) || Number(points) <= 0) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '积分数量必须是大于0的数字');
    }
    if (!type) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '积分类型不能为空');
    }

    const pointsNum = Number(points);

    try {
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
        if (!user) {
            return sendError(res, ErrorCode.USER_NOT_FOUND);
        }

        getOrInitPoints(user.id);

        db.prepare("UPDATE user_points SET points = points + ?, total_points = total_points + ?, updated_at = datetime('now', 'localtime') WHERE user_id = ?")
            .run(pointsNum, pointsNum, user.id);

        const historyId = uuidv4();
        db.prepare('INSERT INTO points_history (id, user_id, points, type, description) VALUES (?, ?, ?, ?, ?)')
            .run(historyId, user.id, pointsNum, type, description || '');

        const updated = db.prepare('SELECT points, total_points FROM user_points WHERE user_id = ?').get(user.id);
        sendSuccess(res, {
            currentPoints: updated.points,
            addedPoints: pointsNum
        }, '积分添加成功');
    } catch (err) {
        logError('增加积分', err, { openid, points, type });
        sendError(res, ErrorCode.POINTS_ADD_FAILED, err.message);
    }
});

router.post('/deduct', authMiddleware, (req, res) => {
    const { points, type, description } = req.body;
    const openid = req.user.wx_openid;

    if (!points || isNaN(Number(points)) || Number(points) <= 0) {
        return sendError(res, ErrorCode.INVALID_PARAMS, '积分数量必须是大于0的数字');
    }
    if (!type) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '积分类型不能为空');
    }

    const pointsNum = Number(points);

    try {
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
        if (!user) {
            return sendError(res, ErrorCode.USER_NOT_FOUND);
        }

        getOrInitPoints(user.id);

        const current = db.prepare('SELECT points FROM user_points WHERE user_id = ?').get(user.id);
        if (!current || current.points < pointsNum) {
            return sendError(res, ErrorCode.INSUFFICIENT_POINTS);
        }

        db.prepare("UPDATE user_points SET points = points - ?, updated_at = datetime('now', 'localtime') WHERE user_id = ?")
            .run(pointsNum, user.id);

        const historyId = uuidv4();
        db.prepare('INSERT INTO points_history (id, user_id, points, type, description) VALUES (?, ?, ?, ?, ?)')
            .run(historyId, user.id, -pointsNum, type, description || '');

        const updated = db.prepare('SELECT points FROM user_points WHERE user_id = ?').get(user.id);
        sendSuccess(res, {
            currentPoints: updated.points,
            deductedPoints: pointsNum
        }, '积分扣除成功');
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

    const kindRaw = (kindQuery != null ? String(kindQuery) : 'all').toLowerCase();
    let kind = 'all';
    if (kindRaw === 'income' || kindRaw === 'expense') {
        kind = kindRaw;
    } else if (kindRaw !== 'all' && kindRaw !== '') {
        return sendError(res, ErrorCode.INVALID_PARAMS, 'kind 须为 all、income 或 expense');
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);

    if (isNaN(pageNum) || pageNum < 1) {
        return sendError(res, ErrorCode.PAGE_PARAM_ERROR, 'page参数必须是大于0的数字');
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        return sendError(res, ErrorCode.PAGE_PARAM_ERROR, 'limit参数必须在1-100之间');
    }

    const offset = (pageNum - 1) * limitNum;

    let pointsCond = '';
    if (kind === 'income') {
        pointsCond = ' AND points > 0';
    } else if (kind === 'expense') {
        pointsCond = ' AND points < 0';
    }

    try {
        const user = db.prepare('SELECT id FROM users WHERE wx_openid = ?').get(openid);
        if (!user) {
            return sendError(res, ErrorCode.USER_NOT_FOUND);
        }

        const list = db.prepare(`
            SELECT * FROM points_history
            WHERE user_id = ?${pointsCond}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(user.id, limitNum, offset);

        const countRow = db
            .prepare(`SELECT COUNT(*) as total FROM points_history WHERE user_id = ?${pointsCond}`)
            .get(user.id);

        const sums = db
            .prepare(
                `SELECT
                    COALESCE(SUM(CASE WHEN points > 0 THEN points ELSE 0 END), 0) AS totalIncome,
                    COALESCE(SUM(CASE WHEN points < 0 THEN -points ELSE 0 END), 0) AS totalExpense
                FROM points_history WHERE user_id = ?`
            )
            .get(user.id);

        sendSuccess(res, {
            list,
            total: countRow.total,
            page: pageNum,
            limit: limitNum,
            kind,
            summary: {
                totalIncome: sums.totalIncome,
                totalExpense: sums.totalExpense
            }
        });
        logInfo('积分明细', '查询成功', {
            openid,
            userId: user.id,
            kind,
            page: pageNum,
            limit: limitNum,
            total: countRow.total,
            listCount: list.length,
            totalIncome: sums.totalIncome,
            totalExpense: sums.totalExpense
        });
    } catch (err) {
        logError('获取积分记录', err, { openid, page, limit });
        sendError(res, ErrorCode.POINTS_OPERATION_FAILED, err.message);
    }
});

router.get('/config', (req, res) => {
    sendSuccess(res, POINTS_TYPE);
});


module.exports = router;
