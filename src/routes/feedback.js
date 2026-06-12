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

router.post('', optionalAuthMiddleware, async (req, res) => {
    const body = req.body || {};
    const feedbackType = String(body.type || body.feedbackType || '其他').trim().slice(0, 32);
    const content = String(body.content || '').trim();
    const contact = String(body.contact || '').trim().slice(0, 128);

    if (!content) {
        return sendError(res, ErrorCode.MISSING_REQUIRED_PARAM, '反馈内容不能为空');
    }
    if (content.length > 2000) {
        return sendError(res, ErrorCode.INVALID_FORMAT, '反馈内容不能超过2000字');
    }

    const feedbackOpenid = req.user ? req.user.wx_openid : null;
    if (
        await blockIfContentUnsafe(res, feedbackOpenid, [
            { content, scene: contentSecurity.SCENE.COMMENT, field: 'content' },
            { content: contact, scene: contentSecurity.SCENE.PROFILE, field: 'contact' }
        ])
    ) {
        return;
    }

    const id = uuidv4();
    let userId = null;
    let wxOpenid = '';
    let nickname = '';

    if (req.user) {
        userId = req.user.id;
        const u = db.prepare('SELECT wx_openid, nickname FROM users WHERE id = ?').get(userId);
        if (u) {
            wxOpenid = u.wx_openid || '';
            nickname = u.nickname || '';
        }
    }

    try {
        db.prepare(
            `INSERT INTO user_feedback (id, user_id, wx_openid, nickname, feedback_type, content, contact, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`
        ).run(id, userId, wxOpenid, nickname, feedbackType, content, contact || null);

        logInfo('意见反馈', '新提交', {
            id,
            userId,
            wxOpenid: wxOpenid ? wxOpenid.slice(0, 8) + '…' : '',
            feedbackType,
            contentPreview: content.slice(0, 80)
        });

        sendSuccess(res, { id }, '反馈已提交');
    } catch (err) {
        logError('保存意见反馈', err, { userId, feedbackType });
        sendError(res, convertDbError(err), err.message);
    }
});

/** 管理端查看反馈列表（需配置 FEEDBACK_ADMIN_SECRET，请求带 ?secret=） */
router.get('', (req, res) => {
    const secret = String(process.env.FEEDBACK_ADMIN_SECRET || '').trim();
    const given = String(req.query.secret || '').trim();
    if (!secret || given !== secret) {
        return sendError(res, ErrorCode.FORBIDDEN, '无权查看反馈列表');
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    try {
        const total = db.prepare('SELECT COUNT(*) AS c FROM user_feedback').get().c;
        const list = db
            .prepare(
                `SELECT id, user_id, wx_openid, nickname, feedback_type, content, contact, created_at
                 FROM user_feedback ORDER BY created_at DESC LIMIT ? OFFSET ?`
            )
            .all(limit, offset);
        sendSuccess(res, { list, total, page, limit });
    } catch (err) {
        logError('查询意见反馈', err);
        sendError(res, convertDbError(err), err.message);
    }
});

module.exports = router;
