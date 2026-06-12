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

function cnTodayDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${d}`;
}

const DAILY_TASK_KEYS = new Set(['sign_in', 'create_music', 'share_work']);
const DAILY_TASK_POINTS = { sign_in: 1, create_music: 10, share_work: 3 };
const DAILY_TASK_LABELS = { sign_in: '每日签到', create_music: '创作音乐', share_work: '分享作品' };

function hasDailyClaim(userId, taskKey, claimDate) {
    const row = db
        .prepare(
            `SELECT 1 AS ok FROM daily_task_claims WHERE user_id = ? AND task_key = ? AND claim_date = ?`
        )
        .get(userId, taskKey, claimDate);
    return !!(row && row.ok);
}

router.get('/daily', authMiddleware, (req, res) => {
    try {
        const claimDate = cnTodayDate();
        const userId = req.user.id;
        const rows = db
            .prepare(`SELECT task_key FROM daily_task_claims WHERE user_id = ? AND claim_date = ?`)
            .all(userId, claimDate);
        const done = new Set(rows.map((r) => r.task_key));
        const tasks = [
            {
                taskKey: 'sign_in',
                icon: '签到',
                name: '每日签到',
                desc: '每日签到一次',
                points: DAILY_TASK_POINTS.sign_in,
                completed: done.has('sign_in')
            },
            {
                taskKey: 'create_music',
                icon: '音乐',
                name: '创作音乐',
                desc: '今日完成一首助眠音乐生成',
                points: DAILY_TASK_POINTS.create_music,
                completed: done.has('create_music')
            },
            {
                taskKey: 'share_work',
                icon: '分享',
                name: '分享作品',
                desc: '今日向好友转发分享贺卡',
                points: DAILY_TASK_POINTS.share_work,
                completed: done.has('share_work')
            }
        ];
        sendSuccess(res, { date: claimDate, tasks });
    } catch (err) {
        logError('每日任务状态', err);
        sendError(res, ErrorCode.POINTS_OPERATION_FAILED, err.message);
    }
});

/** POST 领取单个每日任务积分（服务端校验次数；默认走星鹿发放接口） */
router.post('/daily/claim', authMiddleware, async (req, res) => {
    const { taskKey } = req.body || {};
    if (!taskKey || !DAILY_TASK_KEYS.has(taskKey)) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, 'taskKey 须为 sign_in | create_music | share_work');
    }
    const points = DAILY_TASK_POINTS[taskKey];
    const userId = req.user.id;
    const claimDate = cnTodayDate();

    if (hasDailyClaim(userId, taskKey, claimDate)) {
        return sendSuccess(
            res,
            { taskKey, points: 0, claimDate, alreadyClaimed: true },
            '今日该任务已完成'
        );
    }

    const mode = (process.env.TASK_POINTS_MODE || 'shop').toLowerCase();

    if (mode === 'local') {
        try {
            getOrInitPoints(userId);
            db.prepare(
                `UPDATE user_points SET points = points + ?, total_points = total_points + ?, updated_at = datetime('now', 'localtime') WHERE user_id = ?`
            ).run(points, points, userId);
            const historyId = uuidv4();
            db.prepare(
                `INSERT INTO points_history (id, user_id, points, type, description) VALUES (?, ?, ?, ?, ?)`
            ).run(historyId, userId, points, `daily_${taskKey}`, `每日任务 ${claimDate}`);
            db.prepare(
                `INSERT INTO daily_task_claims (user_id, task_key, claim_date, points) VALUES (?, ?, ?, ?)`
            ).run(userId, taskKey, claimDate, points);
            const updated = db.prepare('SELECT points FROM user_points WHERE user_id = ?').get(userId);
            return sendSuccess(
                res,
                { taskKey, points, claimDate, channel: 'local', currentPoints: updated.points },
                '领取成功'
            );
        } catch (err) {
            logError('每日任务本地积分', err);
            return sendError(res, ErrorCode.POINTS_ADD_FAILED, err.message);
        }
    }

    const st = requireShopToken(req, res);
    if (!st) return;

    try {
        const { data } = await callShopWithAutoRefresh(
            req.user,
            st,
            (tok) => shopApi.thirdGrantIntegral(tok, points),
            '商城发放积分'
        );
        if (!shopApi.isShopApiSuccess(data)) {
            return sendError(
                res,
                ErrorCode.MALL_API_ERROR,
                (data && (data.msg || data.message)) || '商城发放积分失败'
            );
        }
        db.prepare(`INSERT INTO daily_task_claims (user_id, task_key, claim_date, points) VALUES (?, ?, ?, ?)`).run(
            userId,
            taskKey,
            claimDate,
            points
        );
        recordPointsLedger(
            userId,
            points,
            `daily_${taskKey}`,
            DAILY_TASK_LABELS[taskKey] || taskKey
        );
        return sendSuccess(res, { taskKey, points, claimDate, channel: 'shop' }, (data && data.msg) || '领取成功');
    } catch (err) {
        logError('每日任务商城积分', err);
        return sendError(res, ErrorCode.MALL_API_ERROR, err.message || '商城接口异常');
    }
});

module.exports = router;
